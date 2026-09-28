import {
  entryTransactions,
  operationalActions,
  tournamentEntries,
  tournamentResults,
  tournamentSeatAssignments,
  tournamentSeatLocks,
} from "@pcos/db";
import {
  analyzeBalance,
  assignEliminationSequence,
  pauseClock,
  recommendTableBreak,
  reopenClock,
  restoreClock,
  resumeClock,
  ruleViolation,
  statusAfterResume,
  undoability,
  validatePlan,
  type ClockAnchor,
} from "@pcos/domain";
import { topic, type PlannedMove, type TournamentStatus } from "@pcos/types";
import { and, desc, eq } from "drizzle-orm";
import { AppError, notFound, validation } from "../../errors.js";
import type { CommandContext } from "../context.js";
import type { Handler } from "../executor.js";
import {
  activeEntryCount,
  applyMove,
  getEntry,
  getRegistration,
  otherActiveEntry,
  playerName,
  releaseSeat,
  seatEntry,
  seatKey,
  updateRegistrationStatus,
} from "../ops.js";
import { levelLikes, loadSeatingState, policies } from "../repo.js";
import { addTransaction, voidEntry, voidTransaction } from "./entries.js";
import { lateRegOpen } from "./registration.js";

const victimTag = (entryId: string) => `victim:${entryId}`;

/** Balance / break hints returned after eliminations so the floor UI can prompt the TD. */
async function floorHints(ctx: CommandContext) {
  const state = await loadSeatingState(ctx.tx, ctx.tournament.id);
  const balance = analyzeBalance(state.seating, ctx.houseRules.maxTableImbalance, ctx.houseRules.severeImbalanceThreshold);
  const brk = recommendTableBreak(state.seating, ctx.houseRules.tableBreakStrategy, ctx.houseRules.finalTableSize);
  return {
    balanceNeeded: !balance.balanced,
    imbalance: balance.imbalance,
    severeImbalance: balance.severe,
    haltPlay: balance.severe && ctx.houseRules.haltPlayOnSevereImbalance,
    tableBreak: brk.shouldBreak ? { tableId: brk.tableId, tableNumber: brk.tableNumber, reason: brk.reason } : null,
  };
}

export async function restoreEntry(ctx: CommandContext, entryId: string, reason: string) {
  const entry = await getEntry(ctx, entryId);
  if (entry.status !== "ELIMINATED") throw ruleViolation("entry is not eliminated");
  if (await otherActiveEntry(ctx, entry.playerId, entry.id)) {
    throw ruleViolation("player already re-entered; void the newer entry before restoring this one");
  }
  if (ctx.tournament.status === "FINISHED") {
    // Restoring after the finish re-opens the tournament (paused, for safety).
    await ctx.tx.delete(tournamentResults).where(eq(tournamentResults.tournamentId, ctx.tournament.id));
    ctx.updateTournament({ status: "PAUSED", pausedFromStatus: "RUNNING", finishedAt: null });
    if (ctx.clock.status === "FINISHED") ctx.setClock(reopenClock(ctx.clock, levelLikes(ctx.levels), ctx.nowMs));
  } else if (ctx.tournament.status === "FINALIZED") {
    throw ruleViolation("results are finalized; use a result correction instead");
  }

  await ctx.tx
    .update(tournamentEntries)
    .set({ status: "ACTIVE", eliminatedAt: null, eliminationSeq: null, eliminatedByEntryId: null, finishPosition: null, version: entry.version + 1, updatedAt: ctx.now })
    .where(eq(tournamentEntries.id, entry.id));
  const reg = await getRegistration(ctx, entry.registrationId);
  if (reg.status !== "PLAYING") await updateRegistrationStatus(ctx, reg, "PLAYING");

  // Reverse a bounty credited for this elimination.
  const bounties = await ctx.tx
    .select()
    .from(entryTransactions)
    .where(and(eq(entryTransactions.tournamentId, ctx.tournament.id), eq(entryTransactions.type, "BOUNTY_WON"), eq(entryTransactions.reason, victimTag(entry.id)), eq(entryTransactions.voided, false)));
  for (const b of bounties) await voidTransaction(ctx, b.id, `elimination of ${entry.id} reversed`);

  // Back to the original seat when it is still free, otherwise the best open seat.
  const [lastSeat] = await ctx.tx
    .select()
    .from(tournamentSeatAssignments)
    .where(eq(tournamentSeatAssignments.entryId, entry.id))
    .orderBy(desc(tournamentSeatAssignments.assignedAt))
    .limit(1);
  let seat = null;
  if (lastSeat) {
    const state = await loadSeatingState(ctx.tx, ctx.tournament.id);
    const table = state.seating.find((t) => t.id === lastSeat.tableId);
    const free = table && (table.status === "ACTIVE" || table.status === "OPEN") && !table.seats.has(lastSeat.seatNumber) && !table.lockedSeats.has(lastSeat.seatNumber);
    seat = free
      ? await applyMove(ctx, { entryId: entry.id, fromTableId: null, fromSeatNumber: null, toTableId: lastSeat.tableId, toSeatNumber: lastSeat.seatNumber, reason: "RESTORE" }, state)
      : await seatEntry(ctx, entry.id, "AUTO", "RESTORE");
  }
  const name = await playerName(ctx, entry.playerId);
  ctx.touch(`entry:${entry.id}`);
  ctx.emit({
    name: "player.restored",
    audience: "public",
    data: { entryId: entry.id, playerId: entry.playerId, playerName: name, tableNumber: seat?.toTableNumber ?? null, seatNumber: seat?.toSeatNumber ?? null, reason },
    aggregateType: "entry",
    aggregateId: entry.id,
  });
  ctx.audit({ entityType: "entry", entityId: entry.id, action: "RESTORE_PLAYER", before: { status: "ELIMINATED", eliminationSeq: entry.eliminationSeq }, after: { status: "ACTIVE" }, metadata: { reason } });
  ctx.statsChanged();
  return { entryId: entry.id, playerName: name, seat: seat ? { tableNumber: seat.toTableNumber, seatNumber: seat.toSeatNumber } : null };
}

function reverseMoves(moves: readonly PlannedMove[]): PlannedMove[] {
  return [...moves].reverse().map((m) => ({
    entryId: m.entryId,
    fromTableId: m.toTableId,
    fromSeatNumber: m.toSeatNumber,
    toTableId: m.fromTableId!,
    toSeatNumber: m.fromSeatNumber!,
  }));
}

export const eliminationHandlers = {
  ELIMINATE_PLAYERS: (async (ctx, payload) => {
    if (new Set(payload.entryIds).size !== payload.entryIds.length) throw validation("duplicate entry in elimination list");
    const entries = [];
    for (const id of payload.entryIds) {
      const e = await getEntry(ctx, id);
      if (e.status === "ELIMINATED") throw new AppError("INVALID_STATE", `${await playerName(ctx, e.playerId)} is already eliminated`);
      if (e.status !== "ACTIVE") throw ruleViolation("only active entries can be eliminated");
      entries.push(e);
    }
    let hunter = null;
    if (payload.eliminatedByEntryId) {
      if (payload.entryIds.includes(payload.eliminatedByEntryId)) throw validation("a player cannot eliminate themselves");
      hunter = await getEntry(ctx, payload.eliminatedByEntryId);
      if (hunter.status !== "ACTIVE") throw ruleViolation("eliminating player must have an active entry");
    }
    const activeBefore = await activeEntryCount(ctx);
    const seqs = assignEliminationSequence(payload.entryIds, ctx.tournament.lastEliminationSeq);
    const lateOpen = lateRegOpen(ctx);
    const bounty = policies(ctx.tournament).bounty;
    const n = entries.length;
    const eliminated = [];
    for (let i = 0; i < n; i++) {
      const e = entries[i]!;
      const position = lateOpen ? null : activeBefore - n + 1 + i;
      await ctx.tx
        .update(tournamentEntries)
        .set({
          status: "ELIMINATED",
          eliminatedAt: ctx.now,
          eliminationSeq: seqs.get(e.id)!,
          eliminatedByEntryId: hunter?.id ?? null,
          finishPosition: position,
          version: e.version + 1,
          updatedAt: ctx.now,
        })
        .where(eq(tournamentEntries.id, e.id));
      const seat = await releaseSeat(ctx, e.id, "ELIMINATION");
      const reg = await getRegistration(ctx, e.registrationId);
      if (reg.status !== "ELIMINATED") await updateRegistrationStatus(ctx, reg, "ELIMINATED");
      if (hunter && (bounty.enabled || ctx.tournament.format === "BOUNTY" || ctx.tournament.format === "PROGRESSIVE_KO")) {
        await addTransaction(ctx, hunter.id, "BOUNTY_WON", 0, bounty.amount, victimTag(e.id));
      }
      const name = await playerName(ctx, e.playerId);
      ctx.touch(`entry:${e.id}`);
      ctx.emit({
        name: "player.eliminated",
        audience: "public",
        data: {
          entryId: e.id,
          playerId: e.playerId,
          playerName: name,
          position,
          tableNumber: seat?.tableNumber ?? null,
          seatNumber: seat?.seatNumber ?? null,
          eliminatedByPlayerName: hunter ? await playerName(ctx, hunter.playerId) : null,
          remaining: activeBefore - n,
        },
        aggregateType: "entry",
        aggregateId: e.id,
      });
      eliminated.push({ entryId: e.id, playerName: name, eliminationSeq: seqs.get(e.id)!, position, seat });
    }
    if (hunter) ctx.touch(`entry:${hunter.id}`);
    ctx.updateTournament({ lastEliminationSeq: ctx.tournament.lastEliminationSeq + n });
    ctx.statsChanged();
    const remaining = activeBefore - n;
    ctx.summary(`Eliminated: ${eliminated.map((x) => x.playerName + (x.position ? ` (${x.position})` : "")).join(", ")}`);
    return { eliminated, remaining, lastPlayerStanding: remaining === 1 && !lateOpen, hints: await floorHints(ctx) };
  }) satisfies Handler<"ELIMINATE_PLAYERS">,

  RESTORE_PLAYER: (async (ctx, payload) => {
    const r = await restoreEntry(ctx, payload.entryId, payload.reason);
    ctx.summary(`Restored ${r.playerName}: ${payload.reason}`);
    return r;
  }) satisfies Handler<"RESTORE_PLAYER">,

  UNDO_ACTION: (async (ctx, payload) => {
    const [action] = await ctx.tx
      .select()
      .from(operationalActions)
      .where(and(eq(operationalActions.id, payload.actionId), eq(operationalActions.tournamentId, ctx.tournament.id)));
    if (!action) throw notFound("action");
    const u = undoability({ type: action.type as never, compensatedByActionId: action.compensatedByActionId, compensatesActionId: action.compensatesActionId });
    if (!u.undoable) throw ruleViolation(u.reason);
    const p = action.payload as Record<string, unknown>;
    const r = (action.result ?? {}) as Record<string, unknown>;
    let outcome: unknown = null;

    switch (action.type) {
      case "ELIMINATE_PLAYERS": {
        const ids = [...(p.entryIds as string[])].reverse();
        outcome = [];
        for (const id of ids) (outcome as unknown[]).push(await restoreEntry(ctx, id, `undo: ${payload.reason}`));
        break;
      }
      case "MOVE_PLAYER": {
        const m = p as unknown as PlannedMove;
        outcome = await applyReverse(ctx, [m]);
        break;
      }
      case "APPLY_BALANCE":
        outcome = await applyReverse(ctx, p.moves as PlannedMove[]);
        break;
      case "ASSIGN_SEAT":
        outcome = await releaseSeat(ctx, r.entryId as string, "CORRECTION");
        break;
      case "REBUY":
      case "ADD_ON":
      case "CHIP_ADJUSTMENT":
        outcome = await voidTransaction(ctx, r.transactionId as string, `undo: ${payload.reason}`);
        break;
      case "CREATE_ENTRY":
        outcome = await voidEntry(ctx, r.entryId as string, `undo: ${payload.reason}`);
        break;
      case "CHECK_IN": {
        if (r.entryId) await voidEntry(ctx, r.entryId as string, `undo check-in: ${payload.reason}`);
        const reg = await getRegistration(ctx, r.registrationId as string);
        if (reg.status === "CHECKED_IN") await updateRegistrationStatus(ctx, reg, "REGISTERED", { checkedInAt: null });
        outcome = { registrationId: reg.id };
        break;
      }
      case "REGISTER_PLAYER": {
        const reg = await getRegistration(ctx, r.registrationId as string);
        if (!["RESERVED", "REGISTERED", "WAITLISTED"].includes(reg.status)) throw ruleViolation(`registration is already ${reg.status}`);
        await updateRegistrationStatus(ctx, reg, "CANCELLED", { cancelledAt: ctx.now, waitlistPosition: null });
        outcome = { registrationId: reg.id };
        break;
      }
      case "CANCEL_REGISTRATION":
      case "MARK_NO_SHOW": {
        const reg = await getRegistration(ctx, p.registrationId as string);
        await updateRegistrationStatus(ctx, reg, r.previousStatus as never, { cancelledAt: null });
        outcome = { registrationId: reg.id, status: r.previousStatus };
        break;
      }
      case "PAUSE_CLOCK": {
        if (ctx.clock.status !== "PAUSED") throw ruleViolation("clock is no longer paused");
        const resumed = resumeClock(ctx.clock, levelLikes(ctx.levels), ctx.nowMs);
        const isBreak = ctx.levels[resumed.levelIndex]?.type === "BREAK";
        ctx.updateTournament({ status: statusAfterResume(ctx.tournament.pausedFromStatus as TournamentStatus | null, isBreak), pausedFromStatus: null });
        ctx.setClock(resumed);
        ctx.touch("clock");
        break;
      }
      case "RESUME_CLOCK": {
        if (ctx.clock.status !== "RUNNING") throw ruleViolation("clock is no longer running");
        ctx.updateTournament({ status: "PAUSED", pausedFromStatus: ctx.tournament.status });
        ctx.setClock(pauseClock(ctx.clock, levelLikes(ctx.levels), ctx.nowMs));
        ctx.touch("clock");
        break;
      }
      case "NEXT_LEVEL":
      case "PREVIOUS_LEVEL":
      case "SET_LEVEL":
      case "ADJUST_CLOCK":
      case "SET_REMAINING": {
        const before = r.clockBefore as ClockAnchor;
        if (before.status !== ctx.clock.status) throw ruleViolation("the clock was paused/resumed since; adjust it manually");
        ctx.setClock(restoreClock(before, levelLikes(ctx.levels), ctx.nowMs));
        ctx.touch("clock");
        break;
      }
      case "CLOSE_LATE_REGISTRATION":
        ctx.updateTournament({ lateRegistrationClosed: false });
        ctx.touch("tournament:latereg");
        break;
      case "REOPEN_LATE_REGISTRATION":
        ctx.updateTournament({ lateRegistrationClosed: true });
        ctx.touch("tournament:latereg");
        break;
      case "START_HAND_FOR_HAND":
        if (ctx.tournament.status === "HAND_FOR_HAND") ctx.updateTournament({ status: ctx.derived.isBreak ? "BREAK" : "RUNNING" });
        else if (ctx.tournament.pausedFromStatus === "HAND_FOR_HAND") ctx.updateTournament({ pausedFromStatus: "RUNNING" });
        ctx.touch("tournament:hfh");
        break;
      case "SET_SEAT_LOCK": {
        const { tableId, seatNumber } = p as { tableId: string; seatNumber: number };
        await ctx.tx.delete(tournamentSeatLocks).where(and(eq(tournamentSeatLocks.tableId, tableId), eq(tournamentSeatLocks.seatNumber, seatNumber)));
        if (r.previous) {
          await ctx.tx.insert(tournamentSeatLocks).values({ tournamentId: ctx.tournament.id, tableId, seatNumber, reason: (r.reason as string | null) ?? null });
        }
        ctx.touch(seatKey(tableId, seatNumber));
        ctx.emit({ name: "table.updated", data: { tableId, seatNumber, locked: !!r.previous }, topics: [topic.table(tableId)] });
        outcome = { tableId, seatNumber, locked: !!r.previous };
        break;
      }
      default:
        throw ruleViolation(`${action.type} cannot be undone automatically`);
    }
    ctx.compensates(action.id);
    ctx.audit({ entityType: "operational_action", entityId: action.id, action: "UNDO", before: { type: action.type, summary: action.summary }, metadata: { reason: payload.reason } });
    ctx.summary(`Undo: ${action.summary}`);
    return { undoneActionId: action.id, type: action.type, outcome };
  }) satisfies Handler<"UNDO_ACTION">,
};

/** Move players back where they came from (MOVE_PLAYER_CORRECTION). */
async function applyReverse(ctx: CommandContext, moves: readonly PlannedMove[]) {
  if (moves.some((m) => m.fromTableId == null)) throw ruleViolation("initial seat assignments cannot be reversed this way");
  const reversed = reverseMoves(moves);
  const state = await loadSeatingState(ctx.tx, ctx.tournament.id);
  const errors = validatePlan(state.seating, reversed);
  if (errors.length > 0) throw ruleViolation(`cannot reverse the moves: ${errors.join("; ")}`);
  const out = [];
  for (const m of reversed) out.push(await applyMove(ctx, { ...m, reason: "CORRECTION" }, state));
  return out;
}
