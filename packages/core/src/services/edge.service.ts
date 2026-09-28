// Venue edge node state, health and diagnostics (spec §5, §17, §81-82).
// WAN loss is a DEGRADED state, never a failure of local operations.

import { statfs } from "node:fs/promises";
import os from "node:os";
import { backupRuns, outboxEvents, syncCursors, telegramIntegrations, venueEdgeNodes, venues } from "@pcos/db";
import type { EdgeStatusPayload } from "@pcos/types";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { requirePermission, type Actor } from "../actor.js";
import { redactedConfig } from "../config.js";
import type { CoreDeps } from "../deps.js";
import { publishEvents } from "../events.js";

export type ComponentState = "OK" | "DEGRADED" | "DOWN" | "DISABLED";
export interface ComponentHealth {
  name: string;
  state: ComponentState;
  detail?: string;
  latencyMs?: number;
}

export class EdgeService {
  private cached: { at: number; value: EdgeStatusPayload } | null = null;

  constructor(private readonly deps: CoreDeps) {}

  /** Register/refresh this node (called at start-up by API and worker). */
  async ensureNode(): Promise<void> {
    const now = this.deps.now();
    const [existing] = await this.deps.db.select().from(venueEdgeNodes).where(eq(venueEdgeNodes.nodeId, this.deps.edgeNodeId));
    if (existing) {
      await this.deps.db
        .update(venueEdgeNodes)
        .set({ lastSeenAt: now, softwareVersion: this.deps.config.SOFTWARE_VERSION, localAddress: this.localAddress(), version: existing.version + 1 })
        .where(eq(venueEdgeNodes.id, existing.id));
      return;
    }
    const venueId = this.deps.config.VENUE_ID;
    const [venue] = venueId
      ? await this.deps.db.select().from(venues).where(eq(venues.id, venueId))
      : await this.deps.db.select().from(venues).orderBy(venues.createdAt).limit(1);
    if (!venue) return; // setup not done yet
    await this.deps.db
      .insert(venueEdgeNodes)
      .values({
        organizationId: venue.organizationId,
        venueId: venue.id,
        nodeId: this.deps.edgeNodeId,
        name: `Edge ${this.deps.edgeNodeId}`,
        status: "ONLINE",
        softwareVersion: this.deps.config.SOFTWARE_VERSION,
        localAddress: this.localAddress(),
        lastSeenAt: now,
      })
      .onConflictDoNothing();
  }

  localAddress(): string | null {
    for (const list of Object.values(os.networkInterfaces())) {
      for (const a of list ?? []) if (a.family === "IPv4" && !a.internal) return a.address;
    }
    return null;
  }

  async node() {
    const [n] = await this.deps.db.select().from(venueEdgeNodes).where(eq(venueEdgeNodes.nodeId, this.deps.edgeNodeId));
    return n ?? null;
  }

  /** Current edge status (cached for 2 s; cheap enough for every WS welcome). */
  async status(force = false): Promise<EdgeStatusPayload> {
    const nowMs = this.deps.now().getTime();
    if (!force && this.cached && nowMs - this.cached.at < 2_000) return this.cached.value;
    const node = await this.node();
    const [pending] = await this.deps.db
      .select({ n: sql<number>`count(*)::int` })
      .from(outboxEvents)
      .where(and(eq(outboxEvents.syncable, true), inArray(outboxEvents.syncStatus, ["PENDING", "FAILED"])));
    const tg = node ? await this.deps.db.select().from(telegramIntegrations).where(eq(telegramIntegrations.organizationId, node.organizationId)) : [];
    const cloudEnabled = this.deps.config.CLOUD_SYNC_ENABLED;
    const wanOnline = node?.status === "ONLINE";
    const value: EdgeStatusPayload = {
      nodeId: this.deps.edgeNodeId,
      status: (node?.status as EdgeStatusPayload["status"]) ?? "ONLINE",
      wanOnline,
      lastWanSeenAt: node?.lastWanSeenAt?.toISOString() ?? null,
      telegram: tg[0] ? (tg[0].enabled ? tg[0].status : "DISABLED") : "DISABLED",
      cloudSync: { enabled: cloudEnabled, pending: cloudEnabled ? (pending?.n ?? 0) : 0, lastSyncAt: node?.lastCloudSyncAt?.toISOString() ?? null },
      serverTime: new Date(nowMs).toISOString(),
    };
    this.cached = { at: nowMs, value };
    return value;
  }

  /** Persist the WAN probe result; broadcast only on change (worker). */
  async setWanState(online: boolean): Promise<boolean> {
    const node = await this.node();
    if (!node) return false;
    const now = this.deps.now();
    const status = node.status === "MAINTENANCE" ? "MAINTENANCE" : online ? "ONLINE" : "DEGRADED";
    const changed = status !== node.status;
    await this.deps.db
      .update(venueEdgeNodes)
      .set({ status, lastSeenAt: now, ...(online ? { lastWanSeenAt: now } : {}) })
      .where(eq(venueEdgeNodes.id, node.id));
    if (changed) {
      this.cached = null;
      await this.broadcastStatus(node.organizationId, node.venueId);
    }
    return changed;
  }

  async markCloudSync(): Promise<void> {
    await this.deps.db.update(venueEdgeNodes).set({ lastCloudSyncAt: this.deps.now() }).where(eq(venueEdgeNodes.nodeId, this.deps.edgeNodeId));
    this.cached = null;
  }

  async broadcastStatus(organizationId?: string, venueId?: string) {
    const node = organizationId ? { organizationId, venueId: venueId ?? null } : await this.node();
    if (!node) return;
    const status = await this.status(true);
    await publishEvents(
      this.deps.db,
      { organizationId: node.organizationId, venueId: node.venueId ?? null, edgeNodeId: this.deps.edgeNodeId },
      [{ name: "edge.status.updated", topics: ["*"], audience: "public", data: status, aggregateType: "edge", aggregateId: this.deps.edgeNodeId, syncable: false }],
      this.deps.now(),
    );
  }

  // --- health ---------------------------------------------------------------------------------

  async components(extra: { websocketConnections?: number } = {}): Promise<ComponentHealth[]> {
    const out: ComponentHealth[] = [];
    const t0 = Date.now();
    try {
      await this.deps.db.execute(sql`select 1`);
      out.push({ name: "postgres", state: "OK", latencyMs: Date.now() - t0 });
    } catch (e) {
      out.push({ name: "postgres", state: "DOWN", detail: e instanceof Error ? e.message : String(e) });
      return out;
    }
    if (!this.deps.redis) out.push({ name: "redis", state: "DISABLED", detail: "not configured (in-process fallbacks active)" });
    else out.push({ name: "redis", state: this.deps.redis.healthy() ? "OK" : "DEGRADED", detail: this.deps.redis.healthy() ? undefined : "unreachable — using in-process fallbacks" });
    out.push({ name: "websocket", state: "OK", detail: `${extra.websocketConnections ?? 0} connections` });
    try {
      const fsStat = await statfs(this.deps.config.STORAGE_DIR).catch(() => statfs("."));
      const freeGb = (fsStat.bavail * fsStat.bsize) / 1024 ** 3;
      out.push({ name: "disk", state: freeGb < 2 ? "DEGRADED" : "OK", detail: `${freeGb.toFixed(1)} GB free` });
    } catch (e) {
      out.push({ name: "disk", state: "DEGRADED", detail: e instanceof Error ? e.message : String(e) });
    }
    const [lastBackup] = await this.deps.db.select().from(backupRuns).orderBy(desc(backupRuns.requestedAt)).limit(1);
    const [lastOk] = await this.deps.db.select().from(backupRuns).where(eq(backupRuns.status, "SUCCEEDED")).orderBy(desc(backupRuns.finishedAt)).limit(1);
    const ageH = lastOk?.finishedAt ? (Date.now() - lastOk.finishedAt.getTime()) / 3600_000 : null;
    const maxAge = Math.max(24, this.deps.config.BACKUP_SCHEDULE_HOURS * 2);
    out.push({
      name: "backup",
      state: lastBackup?.status === "FAILED" ? "DEGRADED" : ageH == null ? "DEGRADED" : ageH > maxAge ? "DEGRADED" : "OK",
      detail: lastOk?.finishedAt ? `last success ${lastOk.finishedAt.toISOString()}` : "no successful backup yet",
    });
    const status = await this.status(true);
    out.push({ name: "wan", state: status.wanOnline ? "OK" : "DEGRADED", detail: status.wanOnline ? "Internet reachable" : "Internet unavailable — local operations unaffected" });
    out.push({
      name: "telegram",
      state: status.telegram === "DISABLED" ? "DISABLED" : status.telegram === "ONLINE" ? "OK" : "DEGRADED",
      detail: status.telegram,
    });
    if (!status.cloudSync.enabled) out.push({ name: "cloud_sync", state: "DISABLED" });
    else {
      const [cursor] = await this.deps.db.select().from(syncCursors).where(eq(syncCursors.consumer, "cloud-push"));
      out.push({
        name: "cloud_sync",
        state: status.cloudSync.pending > 0 && !status.wanOnline ? "DEGRADED" : cursor?.lastError ? "DEGRADED" : "OK",
        detail: `${status.cloudSync.pending} pending${cursor?.lastError ? `, last error: ${cursor.lastError}` : ""}`,
      });
    }
    return out;
  }

  overall(components: ComponentHealth[]): "OK" | "DEGRADED" | "DOWN" {
    if (components.some((c) => c.name === "postgres" && c.state === "DOWN")) return "DOWN";
    return components.some((c) => c.state === "DEGRADED" || c.state === "DOWN") ? "DEGRADED" : "OK";
  }

  /** Copyable diagnostic bundle without secrets (spec §82). */
  async diagnostics(actor: Actor, extra: { websocketConnections: number; clients: unknown[] }) {
    requirePermission(actor, "edge.read");
    const components = await this.components({ websocketConnections: extra.websocketConnections });
    const node = await this.node();
    const [counts] = (
      await this.deps.db.execute<{ tournaments: number; players: number; outbox_pending: number; notifications_pending: number }>(sql`
        select (select count(*)::int from tournaments) as tournaments,
               (select count(*)::int from players) as players,
               (select count(*)::int from outbox_events where syncable and sync_status in ('PENDING','FAILED')) as outbox_pending,
               (select count(*)::int from notifications where status = 'PENDING') as notifications_pending`)
    ).rows;
    return {
      generatedAt: this.deps.now().toISOString(),
      edge: {
        nodeId: this.deps.edgeNodeId,
        name: node?.name ?? null,
        status: node?.status ?? null,
        hostname: os.hostname(),
        localHostname: this.deps.config.LOCAL_HOSTNAME ?? null,
        localAppUrl: this.deps.config.LOCAL_APP_URL ?? null,
        ip: this.localAddress(),
        lastWanSeenAt: node?.lastWanSeenAt ?? null,
        lastCloudSyncAt: node?.lastCloudSyncAt ?? null,
      },
      runtime: { node: process.version, platform: `${os.platform()} ${os.release()}`, uptimeSeconds: Math.round(process.uptime()), memoryRssMb: Math.round(process.memoryUsage().rss / 1048576) },
      components,
      overall: this.overall(components),
      counts,
      clients: extra.clients,
      config: redactedConfig(this.deps.config),
    };
  }
}
