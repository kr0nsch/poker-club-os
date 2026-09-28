import { tournamentSeatLocks, tournamentTables } from "@pcos/db";
import { chooseSeatForNewEntry, ruleViolation, validatePlan } from "@pcos/domain";
import { topic, type PlannedMove, type SeatMovementReason } from "@pcos/types";
import { and, eq } from "drizzle-orm";
import { AppError, notFound } from "../../errors.js";
import type { CommandContext } from "../context.js";
import type { Handler } from "../executor.js";
import { addTables, applyMove, getEntry, seatEntry, seatKey } from "../ops.js";
import { loadSeatingState } from "../repo.js";
import { drawSeating } from "./lifecycle.js";

async function getTable(ctx: CommandContext, tableId: string) {
  const [t] = await ctx.tx
    .select()
    .from(tournamentTables)
    .where(and(eq(tournamentTables.id, tableId), eq(tournamentTables.tournamentId, ctx.tournament.id)));
  if (!t) throw notFound("table");
  return t;
}

/**
 * Validate a plan against the current seat map, then apply it move by move.
 * A table in BREAKING status accepts no players (validatePlan rejects it as a destination).
 */
async function applyPlan(ctx: CommandContext, moves: readonly PlannedMove[], reason: SeatMovementReason) {
  const state = await loadSeatingState(ctx.tx, ctx.tournament.id);
  const errors = validatePlan(state.seating, moves);
  if (errors.length > 0) throw new AppError("VERSION_CONFLICT", `plan is no longer valid: ${errors.join("; ")}`, { currentVersion: ctx.tournament.version, details: errors });
  const applied = [];
  for (const m of moves) applied.push(await applyMove(ctx, { ...m, reason }, state));
  return applied;
}

export const seatingHandlers = {
  ADD_TABLES: (async (ctx, payload) => {
    const created = await addTables(ctx, payload.count, payload.capacity ?? ctx.tournament.tableSize);
    ctx.summary(`${created.length} table(s) added`);
    return { tables: created.map((t) => ({ id: t.id, tableNumber: t.tableNumber })) };
  }) satisfies Handler<"ADD_TABLES">,

  CLOSE_TABLE: (async (ctx, payload) => {
    const table = await getTable(ctx, payload.tableId);
    const state = await loadSeatingState(ctx.tx, ctx.tournament.id);
    if (state.assignments.some((a) => a.tableId === table.id)) throw ruleViolation(`table ${table.tableNumber} still has players; break it instead`);
    await ctx.tx.update(tournamentTables).set({ status: "CLOSED", closedAt: ctx.now }).where(eq(tournamentTables.id, table.id));
    ctx.touch(`table:${table.id}`, "tables");
    ctx.emit({ name: "table.updated", data: { tableId: table.id, tableNumber: table.tableNumber, status: "CLOSED" }, topics: [topic.table(table.id)], audience: "public" });
    ctx.summary(`Table ${table.tableNumber} closed`);
    return { tableId: table.id, previousStatus: table.status };
  }) satisfies Handler<"CLOSE_TABLE">,

  SET_SEAT_LOCK: (async (ctx, payload) => {
    if (!ctx.houseRules.seatLockingEnabled) throw ruleViolation("seat locking is disabled by house rules");
    const table = await getTable(ctx, payload.tableId);
    if (payload.seatNumber > table.capacity) throw ruleViolation("seat number exceeds table capacity");
    const [existing] = await ctx.tx
      .select()
      .from(tournamentSeatLocks)
      .where(and(eq(tournamentSeatLocks.tableId, table.id), eq(tournamentSeatLocks.seatNumber, payload.seatNumber)));
    if (payload.locked && !existing) {
      await ctx.tx.insert(tournamentSeatLocks).values({ tournamentId: ctx.tournament.id, tableId: table.id, seatNumber: payload.seatNumber, reason: payload.reason ?? null });
    } else if (!payload.locked && existing) {
      await ctx.tx.delete(tournamentSeatLocks).where(eq(tournamentSeatLocks.id, existing.id));
    }
    ctx.touch(seatKey(table.id, payload.seatNumber));
    ctx.emit({ name: "table.updated", data: { tableId: table.id, seatNumber: payload.seatNumber, locked: payload.locked }, topics: [topic.table(table.id)] });
    ctx.summary(`Table ${table.tableNumber} seat ${payload.seatNumber} ${payload.locked ? "locked" : "unlocked"}`);
    return { tableId: table.id, seatNumber: payload.seatNumber, previous: !!existing, reason: existing?.reason ?? null };
  }) satisfies Handler<"SET_SEAT_LOCK">,

  SET_DEALER_BUTTON: (async (ctx, payload) => {
    const table = await getTable(ctx, payload.tableId);
    if (payload.seatNumber != null && payload.seatNumber > table.capacity) throw ruleViolation("seat number exceeds table capacity");
    await ctx.tx.update(tournamentTables).set({ dealerButtonSeat: payload.seatNumber }).where(eq(tournamentTables.id, table.id));
    ctx.touch(`table:${table.id}:button`);
    ctx.emit({ name: "table.updated", data: { tableId: table.id, dealerButtonSeat: payload.seatNumber }, topics: [topic.table(table.id)] });
    ctx.summary(`Table ${table.tableNumber} button → seat ${payload.seatNumber ?? "unknown"}`);
    return { previous: table.dealerButtonSeat };
  }) satisfies Handler<"SET_DEALER_BUTTON">,

  APPLY_INITIAL_SEATING: (async (ctx, payload) => {
    if (payload.generate) {
      const r = await drawSeating(ctx);
      ctx.summary(`Seat draw: ${r.seated} players seated${r.tablesCreated ? `, ${r.tablesCreated} tables opened` : ""}`);
      return { seated: r.seated, tablesCreated: r.tablesCreated };
    }
    const moves = payload.moves ?? [];
    if (moves.some((m) => m.fromTableId !== null)) throw ruleViolation("initial seating moves must start from unseated entries");
    const applied = await applyPlan(ctx, moves, "INITIAL_SEATING");
    ctx.touch("seating");
    ctx.summary(`Seat draw applied: ${applied.length} players`);
    return { seated: applied.length, tablesCreated: 0 };
  }) satisfies Handler<"APPLY_INITIAL_SEATING">,

  ASSIGN_SEAT: (async (ctx, payload) => {
    const entry = await getEntry(ctx, payload.entryId);
    if (entry.status !== "ACTIVE") throw ruleViolation("only active entries can be seated");
    let seat;
    if (payload.seat === "AUTO") {
      const state = await loadSeatingState(ctx.tx, ctx.tournament.id);
      const move = chooseSeatForNewEntry(state.seating, entry.id, ctx.houseRules.lateRegistrationSeatPolicy, ctx.rng, "MANUAL");
      if (!move) throw ruleViolation("no open seat; add a table first");
      seat = await applyMove(ctx, move, state);
    } else if (payload.seat === "NONE") {
      throw ruleViolation("seat target required");
    } else {
      seat = await seatEntry(ctx, entry.id, payload.seat, "MANUAL");
    }
    ctx.summary(`Seated at table ${seat!.toTableNumber} seat ${seat!.toSeatNumber}`);
    return { entryId: entry.id, tableId: seat!.toTableId, seatNumber: seat!.toSeatNumber };
  }) satisfies Handler<"ASSIGN_SEAT">,

  MOVE_PLAYER: (async (ctx, payload) => {
    const [applied] = await applyPlan(ctx, [payload], payload.reason);
    ctx.summary(`Moved ${applied!.playerName}: T${applied!.fromTableNumber}/S${payload.fromSeatNumber} → T${applied!.toTableNumber}/S${payload.toSeatNumber}`);
    return { move: payload, reason: payload.reason };
  }) satisfies Handler<"MOVE_PLAYER">,

  APPLY_BALANCE: (async (ctx, payload) => {
    const applied = await applyPlan(ctx, payload.moves, "BALANCE");
    ctx.touch("balance");
    ctx.summary(`Tables balanced: ${applied.length} move(s)`);
    return { moves: payload.moves };
  }) satisfies Handler<"APPLY_BALANCE">,

  BREAK_TABLE: (async (ctx, payload) => {
    const table = await getTable(ctx, payload.tableId);
    if (table.status === "CLOSED") throw ruleViolation("table is already closed");
    const state = await loadSeatingState(ctx.tx, ctx.tournament.id);
    const atTable = new Set(state.assignments.filter((a) => a.tableId === table.id).map((a) => a.entryId));
    const moving = new Set(payload.moves.filter((m) => m.fromTableId === table.id).map((m) => m.entryId));
    if (payload.moves.some((m) => m.fromTableId !== table.id)) throw ruleViolation("break plan may only move players from the breaking table");
    if (atTable.size !== moving.size || [...atTable].some((id) => !moving.has(id))) {
      throw new AppError("VERSION_CONFLICT", "players at the table changed since the break was previewed", { currentVersion: ctx.tournament.version });
    }
    await ctx.tx.update(tournamentTables).set({ status: "BREAKING" }).where(eq(tournamentTables.id, table.id));
    const applied = await applyPlan(ctx, payload.moves, "TABLE_BREAK");
    await ctx.tx.update(tournamentTables).set({ status: "CLOSED", closedAt: ctx.now }).where(eq(tournamentTables.id, table.id));
    ctx.touch(`table:${table.id}`, "tables");
    ctx.emit({
      name: "table.updated",
      data: { tableId: table.id, tableNumber: table.tableNumber, status: "CLOSED", broken: true, moved: applied.length },
      topics: [topic.table(table.id)],
      audience: "public",
    });
    ctx.summary(`Table ${table.tableNumber} broken: ${applied.length} player(s) moved`);
    return { tableId: table.id, moves: payload.moves };
  }) satisfies Handler<"BREAK_TABLE">,
};
