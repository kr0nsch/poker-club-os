import { tournamentEntries, tournamentRegistrations, tournamentResults } from "@pcos/db";
import {
  assertTransition,
  computeStandings,
  finishClock,
  pauseClock,
  planInitialSeating,
  reopenClock,
  resumeClock,
  ruleViolation,
  startClock,
  statusAfterResume,
  tablesNeeded,
  validateStructure,
  type StandingEntry,
} from "@pcos/domain";
import type { EntryStatus, TournamentStatus } from "@pcos/types";
import { and, eq, inArray } from "drizzle-orm";
import type { CommandContext } from "../context.js";
import type { Handler } from "../executor.js";
import { addTables, applyMove } from "../ops.js";
import { levelLikes, loadSeatingState } from "../repo.js";
import { applyLeaguePoints } from "../results.js";

const status = (ctx: CommandContext) => ctx.tournament.status as TournamentStatus;

/** Seat every active entry that has no seat yet, creating tables as needed (random draw, spec §56). */
export async function drawSeating(ctx: CommandContext) {
  const activeRows = await ctx.tx
    .select({ id: tournamentEntries.id })
    .from(tournamentEntries)
    .where(and(eq(tournamentEntries.tournamentId, ctx.tournament.id), eq(tournamentEntries.status, "ACTIVE")))
    .orderBy(tournamentEntries.createdAt);
  const state0 = await loadSeatingState(ctx.tx, ctx.tournament.id);
  const seatedIds = new Set(state0.assignments.map((a) => a.entryId));
  const unseated = activeRows.map((r) => r.id).filter((id) => !seatedIds.has(id));
  if (unseated.length === 0) return { seated: 0, tablesCreated: 0, moves: [] as unknown[] };

  let state = state0;
  const seatedCount = state.assignments.length;
  const usable = state.tables.filter((t) => t.status === "OPEN" || t.status === "ACTIVE");
  const wanted = tablesNeeded(seatedCount + unseated.length, ctx.tournament.tableSize);
  let tablesCreated = 0;
  if (usable.length < wanted) {
    await addTables(ctx, wanted - usable.length);
    tablesCreated = wanted - usable.length;
    state = await loadSeatingState(ctx.tx, ctx.tournament.id);
  }
  let plan = planInitialSeating({ tables: state.seating, entryIds: unseated, rng: ctx.rng, random: ctx.houseRules.randomInitialSeating });
  if (plan.additionalTablesNeeded > 0) {
    // Locked seats reduced capacity; open more tables.
    await addTables(ctx, plan.additionalTablesNeeded);
    tablesCreated += plan.additionalTablesNeeded;
    state = await loadSeatingState(ctx.tx, ctx.tournament.id);
    plan = planInitialSeating({ tables: state.seating, entryIds: unseated, rng: ctx.rng, random: ctx.houseRules.randomInitialSeating });
  }
  const moves = [];
  for (const m of plan.moves) moves.push(await applyMove(ctx, m, state));
  ctx.touch("seating");
  return { seated: moves.length, tablesCreated, moves };
}

export const lifecycleHandlers = {
  PUBLISH: (async (ctx) => {
    const next = assertTransition(status(ctx), "PUBLISH");
    const issues = validateStructure(
      ctx.levels.map((l) => ({ type: l.type as "PLAY" | "BREAK", durationSeconds: l.durationSeconds, smallBlind: l.smallBlind, bigBlind: l.bigBlind })),
    );
    if (issues.length > 0) throw ruleViolation(`structure is invalid: ${issues.map((i) => `level ${i.index + 1}: ${i.message}`).join("; ")}`);
    ctx.updateTournament({ status: next, published: true });
    ctx.touch("tournament:lifecycle");
    ctx.summary("Tournament published");
    return { status: next };
  }) satisfies Handler<"PUBLISH">,

  UNPUBLISH: (async (ctx) => {
    const next = assertTransition(status(ctx), "UNPUBLISH");
    const regs = await ctx.tx
      .select({ id: tournamentRegistrations.id })
      .from(tournamentRegistrations)
      .where(and(eq(tournamentRegistrations.tournamentId, ctx.tournament.id), inArray(tournamentRegistrations.status, ["RESERVED", "REGISTERED", "WAITLISTED"])));
    if (regs.length > 0) throw ruleViolation(`${regs.length} registrations exist; cancel the tournament instead of unpublishing`);
    ctx.updateTournament({ status: next, published: false });
    ctx.touch("tournament:lifecycle");
    ctx.summary("Tournament unpublished");
    return { status: next };
  }) satisfies Handler<"UNPUBLISH">,

  OPEN_REGISTRATION: (async (ctx) => {
    const next = assertTransition(status(ctx), "OPEN_REGISTRATION");
    ctx.updateTournament({ status: next });
    ctx.touch("tournament:lifecycle");
    ctx.summary("Registration opened");
    return { status: next };
  }) satisfies Handler<"OPEN_REGISTRATION">,

  START_SEATING: (async (ctx, payload) => {
    const next = assertTransition(status(ctx), "START_SEATING");
    ctx.updateTournament({ status: next });
    const draw = payload.draw ? await drawSeating(ctx) : { seated: 0, tablesCreated: 0 };
    ctx.touch("tournament:lifecycle");
    ctx.summary(`Seating started (${draw.seated} players seated)`);
    return { status: next, seated: draw.seated, tablesCreated: draw.tablesCreated };
  }) satisfies Handler<"START_SEATING">,

  START_TOURNAMENT: (async (ctx) => {
    const next = assertTransition(status(ctx), "START_TOURNAMENT");
    if (ctx.levels.length === 0) throw ruleViolation("tournament structure has no levels");
    ctx.updateTournament({ status: next, startedAt: ctx.now, pausedFromStatus: null });
    const draw = await drawSeating(ctx);
    ctx.setClock(startClock(levelLikes(ctx.levels), ctx.nowMs));
    ctx.touch("tournament:lifecycle", "clock");
    ctx.summary("Tournament started");
    return { status: ctx.tournament.status, seated: draw.seated };
  }) satisfies Handler<"START_TOURNAMENT">,

  PAUSE_CLOCK: (async (ctx) => {
    const before = { clock: ctx.clock, status: status(ctx), pausedFromStatus: ctx.tournament.pausedFromStatus };
    const next = assertTransition(status(ctx), "PAUSE_CLOCK");
    ctx.updateTournament({ status: next, pausedFromStatus: status(ctx) });
    ctx.setClock(pauseClock(ctx.clock, levelLikes(ctx.levels), ctx.nowMs));
    ctx.touch("clock");
    ctx.summary("Clock paused");
    return { before };
  }) satisfies Handler<"PAUSE_CLOCK">,

  RESUME_CLOCK: (async (ctx) => {
    const before = { clock: ctx.clock, status: status(ctx), pausedFromStatus: ctx.tournament.pausedFromStatus };
    assertTransition(status(ctx), "RESUME_CLOCK");
    const resumed = resumeClock(ctx.clock, levelLikes(ctx.levels), ctx.nowMs);
    const isBreak = ctx.levels[resumed.levelIndex]?.type === "BREAK";
    ctx.updateTournament({ status: statusAfterResume(ctx.tournament.pausedFromStatus as TournamentStatus | null, isBreak), pausedFromStatus: null });
    ctx.setClock(resumed);
    ctx.touch("clock");
    ctx.summary("Clock resumed");
    return { before };
  }) satisfies Handler<"RESUME_CLOCK">,

  START_HAND_FOR_HAND: (async (ctx) => {
    const next = assertTransition(status(ctx), "START_HAND_FOR_HAND");
    ctx.updateTournament({ status: next });
    ctx.touch("tournament:hfh");
    ctx.summary("Hand-for-hand started");
    return { status: next };
  }) satisfies Handler<"START_HAND_FOR_HAND">,

  END_HAND_FOR_HAND: (async (ctx) => {
    if (status(ctx) === "PAUSED" && ctx.tournament.pausedFromStatus === "HAND_FOR_HAND") {
      ctx.updateTournament({ pausedFromStatus: "RUNNING" });
    } else {
      const next = assertTransition(status(ctx), "END_HAND_FOR_HAND");
      ctx.updateTournament({ status: ctx.derived.isBreak ? "BREAK" : next });
    }
    ctx.touch("tournament:hfh");
    ctx.summary("Hand-for-hand ended");
    return { status: ctx.tournament.status };
  }) satisfies Handler<"END_HAND_FOR_HAND">,

  CLOSE_LATE_REGISTRATION: (async (ctx) => {
    if (ctx.tournament.lateRegistrationClosed) throw ruleViolation("late registration is already closed");
    ctx.updateTournament({ lateRegistrationClosed: true });
    ctx.touch("tournament:latereg");
    ctx.summary("Late registration closed");
    return { lateRegistrationClosed: true };
  }) satisfies Handler<"CLOSE_LATE_REGISTRATION">,

  REOPEN_LATE_REGISTRATION: (async (ctx) => {
    if (!ctx.tournament.lateRegistrationClosed) throw ruleViolation("late registration is not closed");
    ctx.updateTournament({ lateRegistrationClosed: false });
    ctx.touch("tournament:latereg");
    ctx.summary("Late registration reopened");
    return { lateRegistrationClosed: false };
  }) satisfies Handler<"REOPEN_LATE_REGISTRATION">,

  FINISH_TOURNAMENT: (async (ctx, payload) => {
    const next = assertTransition(status(ctx), "FINISH_TOURNAMENT");
    const entries = await ctx.tx.select().from(tournamentEntries).where(eq(tournamentEntries.tournamentId, ctx.tournament.id));
    const standings = computeStandings(
      entries.map<StandingEntry>((e) => ({
        entryId: e.id,
        playerId: e.playerId,
        entryNumber: e.entryNumber,
        status: e.status as EntryStatus,
        eliminationSeq: e.eliminationSeq,
      })),
      { mode: "FINAL", finalOrder: payload.finalOrder },
    );
    const byEntry = new Map(entries.map((e) => [e.id, e]));
    const bountiesByPlayer = new Map<string, number>();
    for (const e of entries) {
      if (e.status !== "ELIMINATED" || !e.eliminatedByEntryId) continue;
      const hunter = byEntry.get(e.eliminatedByEntryId);
      if (hunter) bountiesByPlayer.set(hunter.playerId, (bountiesByPlayer.get(hunter.playerId) ?? 0) + 1);
    }
    await ctx.tx.delete(tournamentResults).where(eq(tournamentResults.tournamentId, ctx.tournament.id));
    if (standings.length > 0) {
      await ctx.tx.insert(tournamentResults).values(
        standings.map((s) => ({
          organizationId: ctx.tournament.organizationId,
          tournamentId: ctx.tournament.id,
          playerId: s.playerId,
          position: s.position!,
          entries: s.entries,
          bounties: bountiesByPlayer.get(s.playerId) ?? 0,
          status: "PROVISIONAL",
          createdAt: ctx.now,
          updatedAt: ctx.now,
        })),
      );
    }
    for (const s of standings.filter((x) => byEntry.get(x.lastEntryId)?.status === "ACTIVE")) {
      await ctx.tx.update(tournamentEntries).set({ finishPosition: s.position }).where(eq(tournamentEntries.id, s.lastEntryId));
    }
    ctx.updateTournament({ status: next, finishedAt: ctx.now, lateRegistrationClosed: true, pausedFromStatus: null });
    if (ctx.clock.status === "RUNNING" || ctx.clock.status === "PAUSED") ctx.setClock(finishClock(ctx.clock, levelLikes(ctx.levels), ctx.nowMs));
    ctx.emit({
      name: "result.updated",
      audience: "public",
      data: { tournamentId: ctx.tournament.id, status: "PROVISIONAL", top: standings.slice(0, 10).map((s) => ({ playerId: s.playerId, position: s.position })) },
    });
    ctx.touch("tournament:lifecycle", "results", "clock");
    ctx.summary(`Tournament finished (${standings.length} players ranked)`);
    return { status: next, ranked: standings.length };
  }) satisfies Handler<"FINISH_TOURNAMENT">,

  REOPEN_TOURNAMENT: (async (ctx, payload) => {
    const next = assertTransition(status(ctx), "REOPEN_TOURNAMENT");
    await ctx.tx.delete(tournamentResults).where(eq(tournamentResults.tournamentId, ctx.tournament.id));
    await ctx.tx
      .update(tournamentEntries)
      .set({ finishPosition: null })
      .where(and(eq(tournamentEntries.tournamentId, ctx.tournament.id), eq(tournamentEntries.status, "ACTIVE")));
    ctx.updateTournament({ status: next, pausedFromStatus: "RUNNING", finishedAt: null });
    if (ctx.clock.status === "FINISHED") ctx.setClock(reopenClock(ctx.clock, levelLikes(ctx.levels), ctx.nowMs));
    ctx.audit({ entityType: "tournament", entityId: ctx.tournament.id, action: "REOPEN", metadata: { reason: payload.reason } });
    ctx.touch("tournament:lifecycle", "results", "clock");
    ctx.summary(`Tournament reopened: ${payload.reason}`);
    return { status: next };
  }) satisfies Handler<"REOPEN_TOURNAMENT">,

  FINALIZE_RESULTS: (async (ctx) => {
    const next = assertTransition(status(ctx), "FINALIZE_RESULTS");
    const updated = await ctx.tx
      .update(tournamentResults)
      .set({ status: "FINALIZED", updatedAt: ctx.now })
      .where(eq(tournamentResults.tournamentId, ctx.tournament.id))
      .returning();
    const league = await applyLeaguePoints(ctx);
    ctx.updateTournament({ status: next, finalizedAt: ctx.now });
    ctx.emit({
      name: "result.updated",
      audience: "public",
      data: { tournamentId: ctx.tournament.id, status: "FINALIZED", players: updated.length, seasonId: ctx.tournament.seasonId },
    });
    ctx.touch("tournament:lifecycle", "results");
    ctx.summary(`Results finalized (${updated.length} players)`);
    return { status: next, players: updated.length, league };
  }) satisfies Handler<"FINALIZE_RESULTS">,

  CANCEL_TOURNAMENT: (async (ctx, payload) => {
    const next = assertTransition(status(ctx), "CANCEL_TOURNAMENT");
    ctx.updateTournament({ status: next, cancelledAt: ctx.now, pausedFromStatus: null });
    if (ctx.clock.status === "RUNNING" || ctx.clock.status === "PAUSED") ctx.setClock(finishClock(ctx.clock, levelLikes(ctx.levels), ctx.nowMs));
    ctx.audit({ entityType: "tournament", entityId: ctx.tournament.id, action: "CANCEL", metadata: { reason: payload.reason } });
    ctx.touch("tournament:lifecycle");
    ctx.summary(`Tournament cancelled: ${payload.reason}`);
    return { status: next };
  }) satisfies Handler<"CANCEL_TOURNAMENT">,

  CORRECT_RESULT: (async (ctx, payload) => {
    const rows = await ctx.tx.select().from(tournamentResults).where(eq(tournamentResults.tournamentId, ctx.tournament.id));
    const target = rows.find((r) => r.playerId === payload.playerId);
    if (!target) throw ruleViolation("player has no result in this tournament");
    if (payload.position > rows.length) throw ruleViolation(`position must be between 1 and ${rows.length}`);
    if (target.position === payload.position) throw ruleViolation("player already holds this position");
    const holder = rows.find((r) => r.position === payload.position);
    const finalized = status(ctx) === "FINALIZED";
    await ctx.tx
      .update(tournamentResults)
      .set({ position: payload.position, revision: target.revision + 1, updatedAt: ctx.now })
      .where(eq(tournamentResults.id, target.id));
    if (holder) {
      await ctx.tx
        .update(tournamentResults)
        .set({ position: target.position, revision: holder.revision + 1, updatedAt: ctx.now })
        .where(eq(tournamentResults.id, holder.id));
    }
    const league = finalized ? await applyLeaguePoints(ctx) : null;
    ctx.audit({
      entityType: "tournament_result",
      entityId: target.id,
      action: "RESULT_CORRECTED",
      before: { playerId: target.playerId, position: target.position, swappedWith: holder?.playerId ?? null },
      after: { position: payload.position },
      metadata: { reason: payload.reason, revision: target.revision + 1, finalized },
    });
    ctx.emit({
      name: "result.updated",
      audience: "public",
      data: { tournamentId: ctx.tournament.id, status: finalized ? "FINALIZED" : "PROVISIONAL", corrected: true, revision: target.revision + 1 },
    });
    ctx.touch("results");
    ctx.summary(`Result corrected: position ${target.position} → ${payload.position}`);
    return { revision: target.revision + 1, league };
  }) satisfies Handler<"CORRECT_RESULT">,
};
