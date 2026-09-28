// Edge → cloud synchronisation (spec §7-8). Optional and never on the
// critical path: the edge keeps working indefinitely without it, and
// unsynchronised operations are never discarded.

import { outboxEvents, players, syncConflicts, syncCursors, tournaments, type Executor } from "@pcos/db";
import { advanceCursor, decideInbound, takeBatch, type InboundChange } from "@pcos/domain";
import { SyncConflictResolveInput } from "@pcos/types";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { requireOrganization, requirePermission, type Actor } from "../actor.js";
import { writeAudit } from "../audit.js";
import type { CoreDeps } from "../deps.js";
import { AppError, notFound } from "../errors.js";
import type { EdgeService } from "./edge.service.js";

const PUSH = "cloud-push";
const PULL = "cloud-pull";

export interface CloudChange extends InboundChange {
  organizationId: string;
  payload: Record<string, unknown>;
}

export class SyncService {
  constructor(
    private readonly deps: CoreDeps,
    private readonly edge: EdgeService,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  get enabled() {
    return this.deps.config.CLOUD_SYNC_ENABLED && !!this.deps.config.CLOUD_API_URL && !!this.deps.config.CLOUD_SYNC_TOKEN;
  }

  private headers() {
    return { authorization: `Bearer ${this.deps.config.CLOUD_SYNC_TOKEN}`, "content-type": "application/json", "x-edge-node": this.deps.edgeNodeId };
  }

  private async setCursor(consumer: string, patch: Partial<typeof syncCursors.$inferInsert>) {
    await this.deps.db
      .insert(syncCursors)
      .values({ consumer, position: 0, ...patch })
      .onConflictDoUpdate({ target: syncCursors.consumer, set: { ...patch, updatedAt: this.deps.now() } });
  }

  /** Push one batch of pending events. Returns the number acknowledged. */
  async pushOnce(): Promise<{ sent: number; acked: number; error?: string }> {
    if (!this.enabled) return { sent: 0, acked: 0 };
    const pending = await this.deps.db
      .select()
      .from(outboxEvents)
      .where(and(eq(outboxEvents.syncable, true), inArray(outboxEvents.syncStatus, ["PENDING", "FAILED"])))
      .orderBy(asc(outboxEvents.seq))
      .limit(500);
    if (pending.length === 0) return { sent: 0, acked: 0 };
    const batch = takeBatch(
      pending.map((e) => ({ ...e, sizeBytes: Buffer.byteLength(JSON.stringify(e.payload)) + 300 })),
      200,
      512 * 1024,
    );
    const body = {
      nodeId: this.deps.edgeNodeId,
      events: batch.map((e) => ({
        eventId: e.eventId,
        seq: e.seq,
        organizationId: e.organizationId,
        venueId: e.venueId,
        aggregateType: e.aggregateType,
        aggregateId: e.aggregateId,
        eventType: e.eventType,
        entityVersion: e.entityVersion,
        payload: e.payload,
        occurredAt: e.occurredAt.toISOString(),
      })),
    };
    let acked: Set<string>;
    try {
      const res = await this.fetchImpl(`${this.deps.config.CLOUD_API_URL!.replace(/\/$/, "")}/v1/edge/events`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`cloud responded HTTP ${res.status}`);
      const json = (await res.json()) as { acked?: string[] };
      acked = new Set(json.acked ?? []);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      await this.deps.db
        .update(outboxEvents)
        .set({ syncStatus: "FAILED", syncAttempts: sql`${outboxEvents.syncAttempts} + 1`, lastError: error.slice(0, 300) })
        .where(inArray(outboxEvents.seq, batch.map((b) => b.seq)));
      await this.setCursor(PUSH, { lastError: error.slice(0, 300) });
      return { sent: batch.length, acked: 0, error };
    }
    const now = this.deps.now();
    const ackedSeqs = batch.filter((b) => acked.has(b.eventId)).map((b) => b.seq);
    if (ackedSeqs.length > 0) {
      await this.deps.db.update(outboxEvents).set({ syncStatus: "SYNCED", syncedAt: now, lastError: null }).where(inArray(outboxEvents.seq, ackedSeqs));
    }
    const [cursor] = await this.deps.db.select().from(syncCursors).where(eq(syncCursors.consumer, PUSH));
    const position = advanceCursor(cursor?.position ?? 0, batch.map((b) => b.seq), new Set(ackedSeqs));
    await this.setCursor(PUSH, { position, lastError: ackedSeqs.length === batch.length ? null : "partial acknowledgement" });
    if (ackedSeqs.length > 0) await this.edge.markCloudSync();
    return { sent: batch.length, acked: ackedSeqs.length };
  }

  /** Pull configuration changes from the cloud and apply the non-conflicting ones. */
  async pullOnce(): Promise<{ applied: number; conflicts: number; skipped: number; error?: string }> {
    if (!this.enabled) return { applied: 0, conflicts: 0, skipped: 0 };
    const [cursor] = await this.deps.db.select().from(syncCursors).where(eq(syncCursors.consumer, PULL));
    let data: { changes: CloudChange[]; nextCursor: string | null };
    try {
      const url = new URL(`${this.deps.config.CLOUD_API_URL!.replace(/\/$/, "")}/v1/edge/changes`);
      if (cursor?.token) url.searchParams.set("cursor", cursor.token);
      const res = await this.fetchImpl(url, { headers: this.headers(), signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`cloud responded HTTP ${res.status}`);
      data = (await res.json()) as typeof data;
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      await this.setCursor(PULL, { lastError: error.slice(0, 300) });
      return { applied: 0, conflicts: 0, skipped: 0, error };
    }
    let applied = 0;
    let conflicts = 0;
    let skipped = 0;
    for (const change of data.changes ?? []) {
      const r = await this.applyChange(change);
      if (r === "APPLY") applied++;
      else if (r === "CONFLICT" || r === "REJECT") conflicts++;
      else skipped++;
    }
    await this.setCursor(PULL, { token: data.nextCursor ?? cursor?.token ?? null, lastError: null });
    return { applied, conflicts, skipped };
  }

  private async lastSyncedVersion(aggregateType: string, aggregateId: string) {
    const [row] = await this.deps.db
      .select({ v: sql<number | null>`max(${outboxEvents.entityVersion})` })
      .from(outboxEvents)
      .where(and(eq(outboxEvents.aggregateType, aggregateType), eq(outboxEvents.aggregateId, aggregateId), eq(outboxEvents.syncStatus, "SYNCED")));
    return row?.v ?? null;
  }

  private async applyChange(change: CloudChange): Promise<string> {
    return this.deps.db.transaction(async (tx) => {
      if (change.entityType === "player") {
        const [local] = await tx.select().from(players).where(eq(players.id, change.entityId)).for("update");
        const decision = decideInbound(
          change,
          { exists: !!local, version: local?.version ?? 0, lastSyncedVersion: local ? await this.lastSyncedVersion("player", local.id) : null, lockedByLiveOperation: false },
          this.deps.edgeNodeId,
        );
        if (decision.action === "APPLY") {
          const p = change.payload as Record<string, unknown>;
          const fields = Object.fromEntries(
            ["firstName", "lastName", "displayName", "nickname", "email", "phone", "memberNumber", "status", "marketingConsent"].filter((k) => k in p).map((k) => [k, p[k]]),
          );
          const version = Math.max((local?.version ?? 0) + 1, change.remoteVersion);
          if (local) {
            await tx.update(players).set({ ...fields, version, updatedAt: this.deps.now() }).where(eq(players.id, local.id));
          } else {
            await tx.insert(players).values({
              id: change.entityId,
              organizationId: change.organizationId,
              externalPublicId: String(p.externalPublicId ?? `P-${change.entityId.slice(0, 8).toUpperCase()}`),
              firstName: String(p.firstName ?? ""),
              lastName: String(p.lastName ?? ""),
              displayName: String(p.displayName ?? p.firstName ?? "Player"),
              source: "CLOUD",
              searchText: [p.firstName, p.lastName, p.displayName, p.email, p.phone].filter(Boolean).join(" ").toLowerCase(),
              ...fields,
              version,
            } as typeof players.$inferInsert);
          }
          // Record the new sync base without echoing it back to the cloud.
          await tx.insert(outboxEvents).values({
            organizationId: change.organizationId,
            edgeNodeId: change.originNodeId,
            aggregateType: "player",
            aggregateId: change.entityId,
            eventType: "player.updated",
            entityVersion: version,
            payload: change.payload,
            syncable: true,
            syncStatus: "SYNCED",
            syncedAt: this.deps.now(),
          });
        } else if (decision.action === "CONFLICT" || decision.action === "REJECT") {
          await this.recordConflict(tx, change, local ?? null, decision.reason);
        }
        return decision.action;
      }
      if (change.entityType === "tournament") {
        const [local] = await tx.select().from(tournaments).where(eq(tournaments.id, change.entityId)).for("update");
        const locked = !!local && !["DRAFT", "SCHEDULED"].includes(local.status);
        const decision = decideInbound(
          change,
          { exists: !!local, version: local?.version ?? 0, lastSyncedVersion: local ? await this.lastSyncedVersion("tournament", local.id) : null, lockedByLiveOperation: locked },
          this.deps.edgeNodeId,
        );
        if (decision.action === "APPLY" && local) {
          const p = change.payload as Record<string, unknown>;
          const fields = Object.fromEntries(["name", "description", "maxPlayers", "expectedPlayers"].filter((k) => k in p).map((k) => [k, p[k]]));
          if (typeof p.startAt === "string") (fields as Record<string, unknown>).startAt = new Date(p.startAt);
          await tx.update(tournaments).set({ ...fields, version: local.version + 1, updatedAt: this.deps.now() }).where(eq(tournaments.id, local.id));
        } else if (decision.action === "APPLY" && !local) {
          // Creating tournaments centrally requires structures on the edge; record for manual review.
          await this.recordConflict(tx, change, null, "remote tournament creation requires manual import");
          return "CONFLICT";
        } else if (decision.action === "CONFLICT" || decision.action === "REJECT") {
          await this.recordConflict(tx, change, local ?? null, decision.reason);
        }
        return decision.action;
      }
      await this.recordConflict(tx, change, null, `unsupported entity type ${change.entityType}`);
      return "CONFLICT";
    });
  }

  private async recordConflict(tx: Executor, change: CloudChange, local: { version: number } | null, reason: string) {
    await tx.insert(syncConflicts).values({
      organizationId: change.organizationId,
      entityType: change.entityType,
      entityId: change.entityId,
      localVersion: local?.version ?? null,
      remoteVersion: change.remoteVersion,
      localPayload: local as object | null,
      remotePayload: change.payload,
      reason,
    });
  }

  async status(actor: Actor) {
    requirePermission(actor, "edge.read");
    const orgId = requireOrganization(actor);
    const cursors = await this.deps.db.select().from(syncCursors);
    const [counts] = (
      await this.deps.db.execute<{ pending: number; failed: number; synced: number; oldest_pending: Date | null }>(sql`
        select count(*) filter (where sync_status = 'PENDING')::int as pending,
               count(*) filter (where sync_status = 'FAILED')::int as failed,
               count(*) filter (where sync_status = 'SYNCED')::int as synced,
               min(occurred_at) filter (where sync_status in ('PENDING','FAILED')) as oldest_pending
        from outbox_events where syncable and (organization_id = ${orgId} or organization_id is null)`)
    ).rows;
    const [openConflicts] = await this.deps.db
      .select({ n: sql<number>`count(*)::int` })
      .from(syncConflicts)
      .where(and(eq(syncConflicts.organizationId, orgId), isNull(syncConflicts.resolvedAt)));
    return { enabled: this.enabled, cloudUrl: this.deps.config.CLOUD_API_URL ?? null, counts, openConflicts: openConflicts?.n ?? 0, cursors };
  }

  async conflicts(actor: Actor) {
    requirePermission(actor, "sync.manage");
    const orgId = requireOrganization(actor);
    return this.deps.db.select().from(syncConflicts).where(eq(syncConflicts.organizationId, orgId)).orderBy(desc(syncConflicts.detectedAt)).limit(200);
  }

  async resolveConflict(actor: Actor, id: string, raw: unknown) {
    requirePermission(actor, "sync.manage");
    const orgId = requireOrganization(actor);
    const input = SyncConflictResolveInput.parse(raw);
    const [c] = await this.deps.db.select().from(syncConflicts).where(and(eq(syncConflicts.id, id), eq(syncConflicts.organizationId, orgId)));
    if (!c) throw notFound("conflict");
    if (c.resolvedAt) throw new AppError("INVALID_STATE", "conflict already resolved");
    const now = this.deps.now();
    await this.deps.db.transaction(async (tx) => {
      if (input.resolution === "ACCEPT_REMOTE" && c.entityType === "player" && c.remotePayload) {
        const p = c.remotePayload as Record<string, unknown>;
        const fields = Object.fromEntries(["firstName", "lastName", "displayName", "nickname", "email", "phone", "memberNumber"].filter((k) => k in p).map((k) => [k, p[k]]));
        const [local] = await tx.select().from(players).where(eq(players.id, c.entityId)).for("update");
        if (local) await tx.update(players).set({ ...fields, version: local.version + 1, updatedAt: now }).where(eq(players.id, local.id));
      }
      if (input.resolution === "KEEP_LOCAL") {
        // Re-send the latest local state so the cloud converges on the edge's version.
        const [latest] = await tx
          .select({ seq: outboxEvents.seq })
          .from(outboxEvents)
          .where(and(eq(outboxEvents.aggregateType, c.entityType), eq(outboxEvents.aggregateId, c.entityId), eq(outboxEvents.edgeNodeId, this.deps.edgeNodeId)))
          .orderBy(desc(outboxEvents.seq))
          .limit(1);
        if (latest) await tx.update(outboxEvents).set({ syncStatus: "PENDING" }).where(eq(outboxEvents.seq, latest.seq));
      }
      await tx.update(syncConflicts).set({ resolvedAt: now, resolution: input.resolution, resolvedBy: actor.userId, note: input.note ?? null }).where(eq(syncConflicts.id, id));
      await writeAudit(tx, actor, this.deps.edgeNodeId, { organizationId: orgId, entityType: "sync_conflict", entityId: id, action: "SYNC_CONFLICT_RESOLVED", after: input }, now);
    });
    return { ok: true };
  }
}
