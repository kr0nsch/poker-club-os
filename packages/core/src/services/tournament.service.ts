// Tournament configuration and queries. Live mutations go through the
// command executor; this service handles creation, configuration and reads.

import { randomUUID } from "node:crypto";
import {
  devices,
  houseRulesProfiles,
  operationalActions,
  organizations,
  players,
  seatMovements,
  tournamentResults,
  tournamentClockStates,
  tournamentStructures,
  tournamentTemplates,
  tournaments,
  users,
  venues,
  type Executor,
} from "@pcos/db";
import {
  analyzeBalance,
  createCryptoRng,
  isLive,
  planInitialSeating,
  planTableBreak,
  recommendBalanceMoves,
  recommendTableBreak,
  tablesNeeded,
  undoability,
} from "@pcos/domain";
import {
  CreateFromTemplateInput,
  TDA_2026_STYLE,
  TournamentCreateInput,
  TournamentListQuery,
  TournamentUpdateInput,
  topic,
  type HouseRulesConfig,
  type OperationalActionView,
  type ResultView,
  type TournamentStatus,
} from "@pcos/types";
import { and, asc, desc, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import { assertResourceAccess, can, requireOrganization, requirePermission, type Actor } from "../actor.js";
import { writeAudit } from "../audit.js";
import type { CoreDeps } from "../deps.js";
import { AppError, conflict, notFound, validation } from "../errors.js";
import { publishEvents } from "../events.js";
import { registrationCounts, loadSeatingState, toDetailView, toSummaryView, type TournamentRow } from "../tournaments/repo.js";
import { buildPublicSnapshot, buildSnapshot } from "../tournaments/snapshot.js";
import type { StructureService } from "./structure.service.js";

const LIVE_EDITABLE = new Set(["name", "description", "maxPlayers", "expectedPlayers", "lateRegistrationPolicy", "reentryPolicy", "rebuyPolicy", "addonPolicy", "publicVisibility", "seasonId", "seriesId"]);
const CLOSED_EDITABLE = new Set(["name", "description", "seasonId", "seriesId", "publicVisibility"]);

function slugify(name: string) {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/[\s_]+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 50) || "tournament"
  );
}

export class TournamentService {
  constructor(
    private readonly deps: CoreDeps,
    private readonly structures: StructureService,
  ) {}

  async row(actor: Actor, id: string, db: Executor = this.deps.db): Promise<TournamentRow> {
    const orgId = requireOrganization(actor);
    const [t] = await db.select().from(tournaments).where(and(eq(tournaments.id, id), eq(tournaments.organizationId, orgId)));
    if (!t) throw notFound("tournament");
    assertResourceAccess(actor, t.organizationId, t.venueId);
    return t;
  }

  private async uniqueSlug(db: Executor, orgId: string, base: string) {
    let slug = base;
    for (let i = 2; i < 200; i++) {
      const [exists] = await db.select({ id: tournaments.id }).from(tournaments).where(and(eq(tournaments.organizationId, orgId), eq(tournaments.slug, slug)));
      if (!exists) return slug;
      slug = `${base}-${i}`;
    }
    return `${base}-${randomUUID().slice(0, 6)}`;
  }

  async create(actor: Actor, raw: unknown) {
    requirePermission(actor, "tournament.create");
    const orgId = requireOrganization(actor);
    const input = TournamentCreateInput.parse(raw);
    const [venue] = await this.deps.db.select().from(venues).where(and(eq(venues.id, input.venueId), eq(venues.organizationId, orgId)));
    if (!venue) throw notFound("venue");
    assertResourceAccess(actor, orgId, venue.id);

    const now = this.deps.now();
    return this.deps.db.transaction(async (tx) => {
      let houseRules: HouseRulesConfig = { ...TDA_2026_STYLE };
      let houseRulesProfileId = input.houseRulesProfileId ?? null;
      if (houseRulesProfileId) {
        const [p] = await tx.select().from(houseRulesProfiles).where(and(eq(houseRulesProfiles.id, houseRulesProfileId), eq(houseRulesProfiles.organizationId, orgId)));
        if (!p) throw notFound("house rules profile");
        houseRules = p.config as HouseRulesConfig;
      } else {
        const def = await this.structures.defaultHouseRules(orgId, tx);
        if (def) {
          houseRules = def.config as HouseRulesConfig;
          houseRulesProfileId = def.id;
        }
      }
      const id = randomUUID();
      const snapshot = await this.structures.snapshotForTournament(tx, orgId, input.structureId, id);
      const slug = await this.uniqueSlug(tx, orgId, input.slug ?? `${slugify(input.name)}-${input.startAt.slice(0, 10)}`);
      const [t] = await tx
        .insert(tournaments)
        .values({
          id,
          organizationId: orgId,
          venueId: venue.id,
          seriesId: input.seriesId ?? null,
          seasonId: input.seasonId ?? null,
          templateId: input.templateId ?? null,
          structureId: snapshot.id,
          houseRulesProfileId,
          houseRules,
          name: input.name,
          slug,
          description: input.description ?? null,
          gameType: input.gameType,
          format: input.format,
          startAt: new Date(input.startAt),
          registrationOpenAt: input.registrationOpenAt ? new Date(input.registrationOpenAt) : null,
          registrationCloseAt: input.registrationCloseAt ? new Date(input.registrationCloseAt) : null,
          maxPlayers: input.maxPlayers ?? null,
          expectedPlayers: input.expectedPlayers ?? null,
          startingStack: input.startingStack,
          tableSize: input.tableSize,
          buyIn: input.buyIn ?? null,
          lateRegistrationPolicy: input.lateRegistrationPolicy,
          reentryPolicy: input.format === "REENTRY" ? { ...input.reentryPolicy, enabled: true } : input.reentryPolicy,
          rebuyPolicy: input.format === "REBUY" ? { ...input.rebuyPolicy, enabled: true } : input.rebuyPolicy,
          addonPolicy: input.addonPolicy,
          bountyPolicy: input.format === "BOUNTY" || input.format === "PROGRESSIVE_KO" ? { ...input.bountyPolicy, enabled: true } : input.bountyPolicy,
          publicVisibility: input.publicVisibility,
          createdBy: actor.userId,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      await tx.insert(tournamentClockStates).values({ tournamentId: id });
      await writeAudit(tx, actor, this.deps.edgeNodeId, { organizationId: orgId, venueId: venue.id, tournamentId: id, entityType: "tournament", entityId: id, action: "TOURNAMENT_CREATED", after: input }, now);
      await publishEvents(
        tx,
        { organizationId: orgId, venueId: venue.id, edgeNodeId: this.deps.edgeNodeId },
        [
          {
            name: "tournament.updated",
            topics: [topic.venue(venue.id), topic.organization(orgId)],
            audience: "staff",
            data: { tournamentId: id, created: true, name: input.name },
            tournamentVersion: 0,
            aggregateType: "tournament",
            aggregateId: id,
            syncable: false,
          },
          { name: "tournament.created", topics: [], audience: "staff", data: toDetailView(t!, 0), aggregateType: "tournament", aggregateId: id, entityVersion: 0, realtime: false },
        ],
        now,
      );
      return toDetailView(t!, 0);
    });
  }

  async createFromTemplate(actor: Actor, templateId: string, raw: unknown) {
    const orgId = requireOrganization(actor);
    const input = CreateFromTemplateInput.parse(raw);
    const [tpl] = await this.deps.db.select().from(tournamentTemplates).where(and(eq(tournamentTemplates.id, templateId), eq(tournamentTemplates.organizationId, orgId)));
    if (!tpl) throw notFound("template");
    const config = tpl.config as Record<string, unknown>;
    return this.create(actor, {
      ...config,
      name: input.name ?? tpl.name,
      venueId: input.venueId,
      startAt: input.startAt,
      structureId: tpl.structureId,
      templateId: tpl.id,
      houseRulesProfileId: tpl.houseRulesProfileId,
      seasonId: input.seasonId ?? null,
      seriesId: input.seriesId ?? null,
    });
  }

  async update(actor: Actor, id: string, raw: unknown) {
    requirePermission(actor, "tournament.edit");
    const input = TournamentUpdateInput.parse(raw);
    const { expectedVersion, ...changes } = input;
    const orgId = requireOrganization(actor);
    const now = this.deps.now();
    return this.deps.db.transaction(async (tx) => {
      const [t] = await tx.select().from(tournaments).where(and(eq(tournaments.id, id), eq(tournaments.organizationId, orgId))).for("update");
      if (!t) throw notFound("tournament");
      assertResourceAccess(actor, t.organizationId, t.venueId);
      if (t.version !== expectedVersion) throw conflict(`tournament changed (version ${t.version})`, t.version);
      const status = t.status as TournamentStatus;
      const started = isLive(status) || status === "SEATING";
      const closed = ["FINISHED", "FINALIZED", "CANCELLED"].includes(status);
      const keys = Object.keys(changes).filter((k) => (changes as Record<string, unknown>)[k] !== undefined);
      const allowed = closed ? CLOSED_EDITABLE : started ? LIVE_EDITABLE : null;
      if (allowed) {
        const blocked = keys.filter((k) => !allowed.has(k));
        if (blocked.length > 0) throw new AppError("INVALID_STATE", `cannot change ${blocked.join(", ")} while the tournament is ${status}`);
      }
      const patch: Partial<TournamentRow> = {};
      for (const k of keys) {
        const v = (changes as Record<string, unknown>)[k];
        if (k === "startAt" || k === "registrationOpenAt" || k === "registrationCloseAt") (patch as Record<string, unknown>)[k] = v ? new Date(v as string) : null;
        else if (k !== "structureId") (patch as Record<string, unknown>)[k] = v;
      }
      if (changes.slug && changes.slug !== t.slug) {
        const [clash] = await tx.select({ id: tournaments.id }).from(tournaments).where(and(eq(tournaments.organizationId, orgId), eq(tournaments.slug, changes.slug)));
        if (clash) throw new AppError("DUPLICATE", "slug already in use");
      }
      if (changes.structureId) {
        const [current] = await tx.select().from(tournamentStructures).where(eq(tournamentStructures.id, t.structureId));
        if (changes.structureId !== t.structureId && current?.ownerTournamentId === t.id) {
          const snapshot = await this.structures.snapshotForTournament(tx, orgId, changes.structureId, t.id);
          patch.structureId = snapshot.id;
          await tx.update(tournamentClockStates).set({ currentLevelIndex: 0, currentLevelId: null }).where(eq(tournamentClockStates.tournamentId, t.id));
        }
      }
      const [updated] = await tx
        .update(tournaments)
        .set({ ...patch, version: t.version + 1, updatedAt: now })
        .where(eq(tournaments.id, id))
        .returning();
      await tx.insert(operationalActions).values({
        organizationId: t.organizationId,
        venueId: t.venueId,
        tournamentId: t.id,
        type: "UPDATE_CONFIGURATION",
        clientOperationId: randomUUID(),
        requestHash: "config",
        payload: changes,
        affectedKeys: ["tournament:config"],
        summary: `Configuration changed: ${keys.join(", ")}`,
        resultVersion: t.version + 1,
        actorId: actor.userId,
        deviceId: actor.deviceId,
        edgeNodeId: this.deps.edgeNodeId,
        createdAt: now,
      });
      await writeAudit(tx, actor, this.deps.edgeNodeId, { organizationId: orgId, venueId: t.venueId, tournamentId: id, entityType: "tournament", entityId: id, action: "TOURNAMENT_UPDATED", before: toDetailView(t, 0), after: changes }, now);
      await publishEvents(
        tx,
        { organizationId: orgId, venueId: t.venueId, edgeNodeId: this.deps.edgeNodeId },
        [
          {
            name: "tournament.updated",
            topics: [topic.tournament(id), topic.venue(t.venueId)],
            audience: "public",
            data: { tournamentId: id, changes: Object.fromEntries(keys.filter((k) => ["name", "startAt", "publicVisibility", "maxPlayers"].includes(k)).map((k) => [k, (changes as Record<string, unknown>)[k]])), configChanged: true },
            tournamentVersion: t.version + 1,
            aggregateType: "tournament",
            aggregateId: id,
            syncable: false,
          },
          { name: "tournament.configured", topics: [], audience: "staff", data: { id, changes, version: t.version + 1 }, aggregateType: "tournament", aggregateId: id, entityVersion: t.version + 1, realtime: false },
        ],
        now,
      );
      return toDetailView(updated!, 0);
    });
  }

  async list(actor: Actor, raw: unknown) {
    requirePermission(actor, "tournament.read");
    const orgId = requireOrganization(actor);
    const q = TournamentListQuery.parse(raw);
    const conds = [eq(tournaments.organizationId, orgId)];
    if (q.venueId) conds.push(eq(tournaments.venueId, q.venueId));
    if (q.status) conds.push(inArray(tournaments.status, q.status.split(",")));
    if (q.from) conds.push(gte(tournaments.startAt, new Date(q.from)));
    if (q.to) conds.push(lte(tournaments.startAt, new Date(q.to)));
    const p = actor.principal;
    if (p.kind === "staff" && p.venueIds) conds.push(inArray(tournaments.venueId, [...p.venueIds]));
    const rows = await this.deps.db.select().from(tournaments).where(and(...conds)).orderBy(desc(tournaments.startAt)).limit(q.limit).offset(q.offset);
    const counts = await registrationCounts(this.deps.db, rows.map((r) => r.id));
    return rows.map((t) => toSummaryView(t, counts.get(t.id) ?? 0));
  }

  async get(actor: Actor, id: string) {
    requirePermission(actor, "tournament.read");
    const t = await this.row(actor, id);
    const counts = await registrationCounts(this.deps.db, [t.id]);
    return toDetailView(t, counts.get(t.id) ?? 0);
  }

  async snapshot(actor: Actor, id: string) {
    requirePermission(actor, "tournament.read");
    const t = await this.row(actor, id);
    const snap = await buildSnapshot(this.deps.db, t, this.deps.now());
    // Dealers and other roles without registration access do not see the desk data.
    if (!can(actor, "registration.read")) snap.registrations = snap.registrations.map((r) => ({ ...r, checkInCode: null, memberNumber: null }));
    return snap;
  }

  // --- public (players on venue Wi-Fi, TV displays) ---------------------------------------------

  async publicRow(idOrSlug: string, orgSlug?: string) {
    const isId = /^[0-9a-f-]{36}$/i.test(idOrSlug);
    const rows = await this.deps.db
      .select({ t: tournaments })
      .from(tournaments)
      .innerJoin(organizations, eq(organizations.id, tournaments.organizationId))
      .where(
        and(
          isId ? eq(tournaments.id, idOrSlug) : eq(tournaments.slug, idOrSlug),
          orgSlug ? eq(organizations.slug, orgSlug) : undefined,
          eq(tournaments.published, true),
          sql`${tournaments.publicVisibility} <> 'PRIVATE'`,
        ),
      )
      .limit(2);
    if (rows.length !== 1) throw notFound("tournament");
    return rows[0]!.t;
  }

  async publicLive(idOrSlug: string, viewer: { playerId: string | null; orgSlug?: string }) {
    const t = await this.publicRow(idOrSlug, viewer.orgSlug);
    return buildPublicSnapshot(this.deps.db, t, this.deps.now(), { playerId: viewer.playerId });
  }

  /** Public schedule: published, listed tournaments that are upcoming or running. */
  async publicList(orgSlug: string, opts: { includePast?: boolean } = {}) {
    const [org] = await this.deps.db.select().from(organizations).where(eq(organizations.slug, orgSlug));
    if (!org) throw notFound("organization");
    const rows = await this.deps.db
      .select({ t: tournaments, venueName: venues.name })
      .from(tournaments)
      .innerJoin(venues, eq(venues.id, tournaments.venueId))
      .where(
        and(
          eq(tournaments.organizationId, org.id),
          eq(tournaments.published, true),
          eq(tournaments.publicVisibility, "PUBLIC"),
          opts.includePast
            ? undefined
            : or(inArray(tournaments.status, ["SCHEDULED", "REGISTRATION_OPEN", "SEATING", "RUNNING", "BREAK", "PAUSED", "HAND_FOR_HAND"]), gte(tournaments.startAt, new Date(this.deps.now().getTime() - 12 * 3600_000))),
        ),
      )
      .orderBy(asc(tournaments.startAt))
      .limit(100);
    const counts = await registrationCounts(this.deps.db, rows.map((r) => r.t.id));
    return {
      organization: { id: org.id, name: org.name, slug: org.slug },
      tournaments: rows.map((r) => ({
        ...toSummaryView(r.t, counts.get(r.t.id) ?? 0),
        venueName: r.venueName,
        description: r.t.description,
        startingStack: r.t.startingStack,
        lateRegistrationClosed: r.t.lateRegistrationClosed,
      })),
    };
  }

  // --- history ----------------------------------------------------------------------------------

  async actions(actor: Actor, id: string, limit = 100): Promise<OperationalActionView[]> {
    requirePermission(actor, "tournament.read");
    await this.row(actor, id);
    const rows = await this.deps.db
      .select({ a: operationalActions, actorName: users.displayName, deviceName: devices.name })
      .from(operationalActions)
      .leftJoin(users, eq(users.id, operationalActions.actorId))
      .leftJoin(devices, and(eq(devices.deviceId, operationalActions.deviceId), eq(devices.organizationId, operationalActions.organizationId)))
      .where(eq(operationalActions.tournamentId, id))
      .orderBy(desc(operationalActions.resultVersion), desc(operationalActions.createdAt))
      .limit(Math.min(limit, 500));
    return rows.map(({ a, actorName, deviceName }) => ({
      id: a.id,
      type: a.type,
      actorName: actorName ?? (a.actorId ? null : "system"),
      deviceName,
      summary: a.summary,
      createdAt: a.createdAt.toISOString(),
      resultVersion: a.resultVersion,
      undoable: undoability({ type: a.type as never, compensatedByActionId: a.compensatedByActionId, compensatesActionId: a.compensatesActionId }).undoable,
      compensatedByActionId: a.compensatedByActionId,
      compensatesActionId: a.compensatesActionId,
    }));
  }

  /** Standings for staff: provisional after FINISH, final after FINALIZE (spec §66). */
  async results(actor: Actor, id: string): Promise<ResultView[]> {
    requirePermission(actor, "results.read");
    await this.row(actor, id);
    const rows = await this.deps.db
      .select({ r: tournamentResults, name: players.displayName })
      .from(tournamentResults)
      .innerJoin(players, eq(players.id, tournamentResults.playerId))
      .where(eq(tournamentResults.tournamentId, id))
      .orderBy(asc(tournamentResults.position));
    return rows.map(({ r, name }) => ({
      playerId: r.playerId,
      playerName: name,
      position: r.position,
      entries: r.entries,
      points: typeof r.points === "number" ? r.points : null,
      prizeAmount: r.prizeAmount,
      status: r.status as ResultView["status"],
      revision: r.revision,
    }));
  }

  async movements(actor: Actor, id: string) {
    requirePermission(actor, "tournament.read");
    await this.row(actor, id);
    return this.deps.db.select().from(seatMovements).where(eq(seatMovements.tournamentId, id)).orderBy(desc(seatMovements.createdAt)).limit(500);
  }

  // --- previews (read-only; applying uses STRICT-versioned commands) --------------------------------

  async seatingPreview(actor: Actor, id: string) {
    requirePermission(actor, "seat.assign");
    const t = await this.row(actor, id);
    const snapshot = await buildSnapshot(this.deps.db, t, this.deps.now());
    const unseated = snapshot.entries.filter((e) => e.status === "ACTIVE" && e.tableId == null).map((e) => e.id);
    const state = await loadSeatingState(this.deps.db, id);
    const usable = state.seating.filter((x) => x.status === "OPEN" || x.status === "ACTIVE");
    const seated = state.assignments.length;
    const needed = tablesNeeded(seated + unseated.length, t.tableSize);
    const plan = planInitialSeating({ tables: state.seating, entryIds: unseated, rng: createCryptoRng(), random: (t.houseRules as HouseRulesConfig).randomInitialSeating });
    return {
      basedOnVersion: t.version,
      unseated: unseated.length,
      tables: usable.length,
      tablesNeeded: needed,
      additionalTablesNeeded: Math.max(0, needed - usable.length, plan.additionalTablesNeeded),
      moves: plan.moves,
    };
  }

  async balancePreview(actor: Actor, id: string) {
    requirePermission(actor, "seat.move");
    const t = await this.row(actor, id);
    const rules = t.houseRules as HouseRulesConfig;
    const state = await loadSeatingState(this.deps.db, id);
    const analysis = analyzeBalance(state.seating, rules.maxTableImbalance, rules.severeImbalanceThreshold);
    const moves = analysis.balanced ? [] : recommendBalanceMoves(state.seating, { maxImbalance: rules.maxTableImbalance, playerSelection: rules.balancePlayerSelection, rng: createCryptoRng() });
    const names = new Map(state.assignments.map((a) => [a.entryId, a.playerName]));
    const tableNo = new Map(state.tables.map((x) => [x.id, x.tableNumber]));
    return {
      basedOnVersion: t.version,
      analysis,
      haltPlay: analysis.severe && rules.haltPlayOnSevereImbalance,
      moves: moves.map((m) => ({ ...m, playerName: names.get(m.entryId) ?? "?", fromTableNumber: m.fromTableId ? tableNo.get(m.fromTableId) : null, toTableNumber: tableNo.get(m.toTableId) })),
      tableBreak: recommendTableBreak(state.seating, rules.tableBreakStrategy, rules.finalTableSize),
    };
  }

  async breakPreview(actor: Actor, id: string, tableId?: string) {
    requirePermission(actor, "table.break");
    const t = await this.row(actor, id);
    const rules = t.houseRules as HouseRulesConfig;
    const state = await loadSeatingState(this.deps.db, id);
    const rec = recommendTableBreak(state.seating, rules.tableBreakStrategy, rules.finalTableSize);
    const target = tableId ?? rec.tableId;
    if (!target) return { basedOnVersion: t.version, recommendation: rec, tableId: null, moves: [] };
    if (!state.tables.some((x) => x.id === target)) throw validation("unknown table");
    const moves = planTableBreak(state.seating, target, createCryptoRng());
    const names = new Map(state.assignments.map((a) => [a.entryId, a.playerName]));
    const tableNo = new Map(state.tables.map((x) => [x.id, x.tableNumber]));
    return {
      basedOnVersion: t.version,
      recommendation: rec,
      tableId: target,
      tableNumber: tableNo.get(target),
      moves: moves.map((m) => ({ ...m, playerName: names.get(m.entryId) ?? "?", fromTableNumber: tableNo.get(m.fromTableId!), toTableNumber: tableNo.get(m.toTableId) })),
    };
  }
}
