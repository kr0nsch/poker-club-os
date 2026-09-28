// Command executor for live tournament operations (spec §63-65, §85-86).
//
//   validate → authorize → idempotency check → BEGIN
//   → lock tournament row (FOR UPDATE) → version check → clock materialisation
//   → handler (mutations) → REBASE conflict detection → version bump
//   → operational action + audit + outbox + pg_notify → COMMIT
//
// No external request is ever made inside the transaction. Notification
// transports (Telegram, email…) run later in the worker from the outbox.

import { randomUUID } from "node:crypto";
import {
  operationalActions,
  organizationSettings,
  tournamentClockStates,
  tournaments,
  type Db,
  type Tx,
} from "@pcos/db";
import {
  createCryptoRng,
  deriveClock,
  materialize,
  statusForLevel,
  type ClockAnchor,
  type Rng,
} from "@pcos/domain";
import {
  COMMAND_CONCURRENCY,
  COMMAND_PERMISSIONS,
  DEFAULT_FEATURE_FLAGS,
  TournamentCommand,
  topic,
  type CommandResult,
  type CommandType,
  type FeatureFlags,
  type HouseRulesConfig,
  type TournamentStatus,
} from "@pcos/types";
import { and, eq, gt, sql } from "drizzle-orm";
import { assertResourceAccess, can, requireOrganization, type Actor } from "../actor.js";
import { writeAudit, type AuditEntry } from "../audit.js";
import { requestHash } from "../crypto.js";
import { AppError, conflict, forbidden, notFound, pgErrorInfo, unauthenticated, validation } from "../errors.js";
import { publishEvents, type PendingEvent } from "../events.js";
import type { CommandContext, EmitInput } from "./context.js";
import { computeTournamentStats } from "./stats.js";
import {
  anchorFromRow,
  levelLikes,
  loadClockRow,
  loadLevels,
  lockTournament,
  rowFromAnchor,
  type TournamentRow,
} from "./repo.js";

export type Handler<T extends CommandType = CommandType> = (
  ctx: CommandContext,
  payload: Extract<TournamentCommand, { type: T }>["payload"],
) => Promise<unknown>;
export type HandlerMap = { [T in CommandType]: Handler<T> };

/** Commands a logged-in player may issue for themselves (self-service registration). */
const PLAYER_COMMANDS: ReadonlySet<CommandType> = new Set(["REGISTER_PLAYER", "CANCEL_REGISTRATION"]);

export interface ExecutorDeps {
  db: Db;
  edgeNodeId: string;
  now?: () => Date;
  rng?: () => Rng;
}

export class TournamentCommandExecutor {
  private readonly now: () => Date;
  private readonly rng: () => Rng;

  constructor(
    private readonly deps: ExecutorDeps,
    private readonly handlers: HandlerMap,
  ) {
    this.now = deps.now ?? (() => new Date());
    this.rng = deps.rng ?? (() => createCryptoRng());
  }

  async execute(tournamentId: string, raw: unknown, actor: Actor): Promise<CommandResult> {
    const parsed = TournamentCommand.safeParse(raw);
    if (!parsed.success) throw validation("invalid command", parsed.error.issues);
    const cmd = parsed.data as TournamentCommand;
    this.authorize(actor, cmd.type);

    const orgId = actor.principal.kind === "system" ? actor.principal.organizationId : requireOrganization(actor);
    const hash = requestHash({ tournamentId, type: cmd.type, payload: cmd.payload });

    const dup = await this.findDuplicate(this.deps.db, orgId, cmd.clientOperationId, hash);
    if (dup) return dup;

    try {
      return await this.deps.db.transaction(async (tx) => {
        const t = await lockTournament(tx, tournamentId, orgId);
        if (!t) throw notFound("tournament");
        assertResourceAccess(actor, t.organizationId, t.venueId);

        // Re-check under the lock: a concurrent retry may have committed meanwhile.
        const dupInTx = await this.findDuplicate(tx, t.organizationId, cmd.clientOperationId, hash);
        if (dupInTx) return dupInTx;

        if (cmd.expectedVersion > t.version) throw conflict("expected version is ahead of the server", t.version);
        if (COMMAND_CONCURRENCY[cmd.type] === "STRICT" && cmd.expectedVersion !== t.version) {
          throw conflict(`tournament changed (version ${t.version}, expected ${cmd.expectedVersion}); reload and retry`, t.version);
        }
        return await this.run(tx, t, cmd, actor, hash);
      });
    } catch (e) {
      // Unique violation on the idempotency key: a concurrent identical request won the race.
      if (pgErrorInfo(e).constraint === "op_actions_idempotency_uq") {
        const again = await this.findDuplicate(this.deps.db, orgId, cmd.clientOperationId, hash);
        if (again) return again;
      }
      throw AppError.from(e);
    }
  }

  /** Clock auto-advance materialisation, invoked by the ticker (spec §51). */
  async autoAdvance(tournamentId: string): Promise<boolean> {
    return this.deps.db.transaction(async (tx) => {
      const t = await lockTournament(tx, tournamentId, null);
      if (!t) return false;
      const levels = await loadLevels(tx, t.structureId);
      const clockRow = await loadClockRow(tx, tournamentId);
      const anchor = anchorFromRow(clockRow);
      const now = this.now();
      const next = materialize(anchor, levelLikes(levels), now.getTime());
      if (next === anchor) return false;
      const derived = deriveClock(next, levelLikes(levels), now.getTime());
      const newStatus = statusForLevel(t.status as TournamentStatus, derived.isBreak);
      const version = t.version + 1;
      await tx.update(tournaments).set({ status: newStatus, version, updatedAt: now }).where(eq(tournaments.id, t.id));
      const [clock] = await tx
        .update(tournamentClockStates)
        .set({ ...rowFromAnchor(next, levels), version: clockRow.version + 1, updatedAt: now })
        .where(eq(tournamentClockStates.tournamentId, t.id))
        .returning();
      const actionId = randomUUID();
      await tx.insert(operationalActions).values({
        id: actionId,
        organizationId: t.organizationId,
        venueId: t.venueId,
        tournamentId: t.id,
        type: "CLOCK_AUTO_ADVANCE",
        clientOperationId: randomUUID(),
        requestHash: "system",
        payload: { fromLevelIndex: anchor.levelIndex, toLevelIndex: next.levelIndex },
        result: null,
        affectedKeys: ["clock:auto"],
        summary: `Level ${derived.playLevelNumber}${derived.isBreak ? " break" : ""} started`,
        resultVersion: version,
        edgeNodeId: this.deps.edgeNodeId,
        createdAt: now,
      });
      const events: PendingEvent[] = [
        {
          name: "clock.updated",
          topics: [topic.tournament(t.id), topic.venue(t.venueId)],
          audience: "public",
          data: { tournamentId: t.id, clock: clockViewData(clock!), reason: "AUTO_ADVANCE" },
          tournamentVersion: version,
          aggregateType: "tournament",
          aggregateId: t.id,
        },
      ];
      if (newStatus !== t.status) {
        events.push({
          name: "tournament.updated",
          topics: [topic.tournament(t.id), topic.venue(t.venueId)],
          audience: "public",
          data: { tournamentId: t.id, changes: { status: newStatus } },
          tournamentVersion: version,
          aggregateType: "tournament",
          aggregateId: t.id,
        });
      }
      await publishEvents(tx, { organizationId: t.organizationId, venueId: t.venueId, edgeNodeId: this.deps.edgeNodeId }, events, now);
      return true;
    });
  }

  // -----------------------------------------------------------------------------

  private authorize(actor: Actor, type: CommandType) {
    const p = actor.principal;
    if (p.kind === "system") return;
    if (p.kind === "anonymous") throw unauthenticated();
    if (p.kind === "player") {
      if (!PLAYER_COMMANDS.has(type)) throw forbidden("players may only register or cancel their own registration");
      return; // ownership is checked by the handler
    }
    if (p.kind !== "staff") throw forbidden(`${p.kind} tokens cannot issue commands`);
    if (!can(actor, COMMAND_PERMISSIONS[type])) throw forbidden(`missing permission ${COMMAND_PERMISSIONS[type]}`);
  }

  private async findDuplicate(db: Db | Tx, orgId: string | null, clientOperationId: string, hash: string): Promise<CommandResult | null> {
    if (!orgId) return null;
    const [existing] = await db
      .select()
      .from(operationalActions)
      .where(and(eq(operationalActions.organizationId, orgId), eq(operationalActions.clientOperationId, clientOperationId)));
    if (!existing) return null;
    if (existing.requestHash !== hash) {
      throw new AppError("IDEMPOTENCY_MISMATCH", "clientOperationId was already used for a different request");
    }
    return { actionId: existing.id, tournamentVersion: existing.resultVersion, duplicate: true, result: existing.result };
  }

  private async run(tx: Tx, initial: TournamentRow, cmd: TournamentCommand, actor: Actor, hash: string): Promise<CommandResult> {
    const now = this.now();
    const nowMs = now.getTime();
    const actionId = randomUUID();
    const levels = await loadLevels(tx, initial.structureId);
    const lk = levelLikes(levels);
    const clockRow = await loadClockRow(tx, initial.id);
    const [settings] = await tx.select().from(organizationSettings).where(eq(organizationSettings.organizationId, initial.organizationId));
    const flags: FeatureFlags = { ...DEFAULT_FEATURE_FLAGS, ...((settings?.featureFlags ?? {}) as Partial<FeatureFlags>) };

    let tournament: TournamentRow = { ...initial };
    const tournamentPatch: Partial<TournamentRow> = {};
    const persistedAnchor = anchorFromRow(clockRow);
    let clock: ClockAnchor = materialize(persistedAnchor, lk, nowMs);
    const autoAdvanced = clock !== persistedAnchor;
    let clockChanged = autoAdvanced;
    const events: EmitInput[] = [];
    const audits: AuditEntry[] = [];
    const keys = new Set<string>();
    let summary: string = cmd.type;
    let stats = false;
    let compensatesActionId: string | null = null;

    if (autoAdvanced) {
      const d = deriveClock(clock, lk, nowMs);
      const s = statusForLevel(tournament.status as TournamentStatus, d.isBreak);
      if (s !== tournament.status) {
        tournament = { ...tournament, status: s };
        tournamentPatch.status = s;
      }
    }

    const ctx: CommandContext = {
      tx,
      now,
      nowMs,
      actor,
      actionId,
      edgeNodeId: this.deps.edgeNodeId,
      rng: this.rng(),
      flags,
      get tournament() {
        return tournament;
      },
      levels,
      houseRules: initial.houseRules as HouseRulesConfig,
      get clock() {
        return clock;
      },
      get derived() {
        return deriveClock(clock, lk, nowMs);
      },
      autoAdvanced,
      updateTournament(patch) {
        tournament = { ...tournament, ...patch };
        Object.assign(tournamentPatch, patch);
      },
      setClock(anchor) {
        clock = anchor;
        clockChanged = true;
        // Keep BREAK/RUNNING aligned with the level type while the tournament is live.
        const d = deriveClock(anchor, lk, nowMs);
        const s = statusForLevel(tournament.status as TournamentStatus, d.isBreak);
        if (s !== tournament.status) {
          tournament = { ...tournament, status: s };
          tournamentPatch.status = s;
        }
      },
      emit(e) {
        events.push(e);
      },
      audit(e) {
        audits.push({ ...e, organizationId: initial.organizationId, tournamentId: initial.id, venueId: initial.venueId });
      },
      touch(...k) {
        k.forEach((x) => keys.add(x));
      },
      summary(text) {
        summary = text;
      },
      statsChanged() {
        stats = true;
      },
      compensates(id) {
        compensatesActionId = id;
      },
      require(permission) {
        if (!can(actor, permission)) throw forbidden(`missing permission ${permission}`);
      },
      seatAudience() {
        return flags.publicSeatList ? "public" : "staff";
      },
    };

    const handler = this.handlers[cmd.type] as Handler;
    let result: unknown;
    try {
      result = await handler(ctx, cmd.payload as never);
    } catch (e) {
      // A stale command that no longer fits the current state is a concurrency
      // conflict from the client's point of view: reload and decide again (spec §94).
      const err = AppError.from(e);
      if (cmd.expectedVersion < initial.version && err.code === "INVALID_STATE") {
        throw new AppError("VERSION_CONFLICT", `state changed since version ${cmd.expectedVersion}: ${err.message}`, { currentVersion: initial.version });
      }
      throw e;
    }

    // Optimistic concurrency with rebase (spec §64, §94).
    if (cmd.expectedVersion < initial.version) {
      const touched = [...keys];
      if (touched.length === 0) touched.push("tournament");
      const overlapping = await tx
        .select({ id: operationalActions.id, type: operationalActions.type, summary: operationalActions.summary })
        .from(operationalActions)
        .where(
          and(
            eq(operationalActions.tournamentId, initial.id),
            gt(operationalActions.resultVersion, cmd.expectedVersion),
            sql`${operationalActions.affectedKeys} && ${sql`array[${sql.join(touched.map((k) => sql`${k}`), sql`, `)}]::text[]`}`,
          ),
        )
        .limit(1);
      if (overlapping[0]) {
        throw new AppError("VERSION_CONFLICT", `conflicting change since version ${cmd.expectedVersion}: ${overlapping[0].summary}`, {
          currentVersion: initial.version,
          details: { conflictingActionId: overlapping[0].id, type: overlapping[0].type },
        });
      }
    }

    const version = initial.version + 1;
    await tx
      .update(tournaments)
      .set({ ...tournamentPatch, version, updatedAt: now })
      .where(eq(tournaments.id, initial.id));

    const topicsBase = [topic.tournament(initial.id)];
    const pending: PendingEvent[] = [];

    if (clockChanged) {
      const [c] = await tx
        .update(tournamentClockStates)
        .set({ ...rowFromAnchor(clock, levels), version: clockRow.version + 1, updatedAt: now })
        .where(eq(tournamentClockStates.tournamentId, initial.id))
        .returning();
      pending.push({
        name: "clock.updated",
        topics: [...topicsBase, topic.venue(initial.venueId)],
        audience: "public",
        data: { tournamentId: initial.id, clock: clockViewData(c!), reason: cmd.type },
        tournamentVersion: version,
        aggregateType: "tournament",
        aggregateId: initial.id,
      });
    }

    const changedFields = Object.keys(tournamentPatch);
    if (changedFields.length > 0 || stats) {
      const data: Record<string, unknown> = { tournamentId: initial.id, changes: publicChanges(tournamentPatch) };
      if (stats) data.stats = await computeTournamentStats(tx, tournament, flags);
      pending.push({
        name: "tournament.updated",
        topics: [...topicsBase, topic.venue(initial.venueId)],
        audience: "public",
        data,
        tournamentVersion: version,
        aggregateType: "tournament",
        aggregateId: initial.id,
      });
    }

    for (const e of events) {
      pending.push({
        name: e.name,
        topics: [...topicsBase, ...(e.topics ?? [])],
        audience: e.audience ?? "staff",
        data: e.data,
        tournamentVersion: version,
        aggregateType: e.aggregateType ?? "tournament",
        aggregateId: e.aggregateId ?? initial.id,
        syncable: e.syncable,
      });
    }

    await tx.insert(operationalActions).values({
      id: actionId,
      organizationId: initial.organizationId,
      venueId: initial.venueId,
      tournamentId: initial.id,
      type: cmd.type,
      clientOperationId: cmd.clientOperationId,
      requestHash: hash,
      payload: cmd.payload as object,
      result: (result ?? null) as object | null,
      affectedKeys: [...keys],
      summary,
      resultVersion: version,
      compensatesActionId,
      actorId: actor.userId,
      deviceId: actor.deviceId,
      edgeNodeId: this.deps.edgeNodeId,
      createdAt: now,
    });
    if (compensatesActionId) {
      await tx.update(operationalActions).set({ compensatedByActionId: actionId }).where(eq(operationalActions.id, compensatesActionId));
    }

    await writeAudit(
      tx,
      actor,
      this.deps.edgeNodeId,
      [
        {
          organizationId: initial.organizationId,
          venueId: initial.venueId,
          tournamentId: initial.id,
          entityType: "tournament_command",
          entityId: actionId,
          action: cmd.type,
          after: { payload: cmd.payload, result, version },
          metadata: { clientOperationId: cmd.clientOperationId, expectedVersion: cmd.expectedVersion, summary },
        },
        ...audits,
      ],
      now,
    );

    await publishEvents(tx, { organizationId: initial.organizationId, venueId: initial.venueId, edgeNodeId: this.deps.edgeNodeId }, pending, now);

    return { actionId, tournamentVersion: version, duplicate: false, result };
  }
}

function clockViewData(c: typeof tournamentClockStates.$inferSelect) {
  return {
    status: c.clockStatus,
    levelIndex: c.currentLevelIndex,
    levelId: c.currentLevelId,
    startedAt: c.startedAt?.toISOString() ?? null,
    pausedAt: c.pausedAt?.toISOString() ?? null,
    remainingAtPauseMs: c.remainingAtPauseMs ?? null,
    version: c.version,
  };
}

const PUBLIC_FIELDS = new Set([
  "status",
  "name",
  "startAt",
  "published",
  "publicVisibility",
  "lateRegistrationClosed",
  "startedAt",
  "finishedAt",
  "finalizedAt",
  "cancelledAt",
  "pausedFromStatus",
]);

function publicChanges(patch: Partial<TournamentRow>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(patch)
      .filter(([k]) => PUBLIC_FIELDS.has(k))
      .map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v]),
  );
}
