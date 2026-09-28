// Shared mutations used by several command handlers. All run inside the
// command transaction and record realtime events / history via the context.

import {
  entryTransactions,
  players,
  seatMovements,
  tournamentEntries,
  tournamentRegistrations,
  tournamentSeatAssignments,
  tournamentTables,
} from "@pcos/db";
import { chooseSeatForNewEntry, ruleViolation, type SeatMove } from "@pcos/domain";
import { topic, type SeatMovementReason } from "@pcos/types";
import { and, desc, eq, max, ne } from "drizzle-orm";
import { AppError, notFound, pgErrorInfo } from "../errors.js";
import type { CommandContext } from "./context.js";
import { loadSeatingState, type EntryRow, type RegistrationRow, type SeatingState } from "./repo.js";

export type SeatTarget = "AUTO" | "NONE" | { tableId: string; seatNumber: number };

/**
 * Conflict key for a single seat. Seat-level (not table-level) keys let two
 * floor devices work on different players at the same table without false
 * conflicts, while two moves into the same seat still conflict.
 */
export const seatKey = (tableId: string | null, seatNumber: number | null) => `seat:${tableId}:${seatNumber}`;

export async function getEntry(ctx: CommandContext, entryId: string): Promise<EntryRow> {
  const [e] = await ctx.tx
    .select()
    .from(tournamentEntries)
    .where(and(eq(tournamentEntries.id, entryId), eq(tournamentEntries.tournamentId, ctx.tournament.id)));
  if (!e) throw notFound("entry");
  return e;
}

export async function getRegistration(ctx: CommandContext, registrationId: string): Promise<RegistrationRow> {
  const [r] = await ctx.tx
    .select()
    .from(tournamentRegistrations)
    .where(and(eq(tournamentRegistrations.id, registrationId), eq(tournamentRegistrations.tournamentId, ctx.tournament.id)));
  if (!r) throw notFound("registration");
  return r;
}

export async function playerName(ctx: CommandContext, playerId: string): Promise<string> {
  const [p] = await ctx.tx.select({ displayName: players.displayName }).from(players).where(eq(players.id, playerId));
  return p?.displayName ?? "Unknown";
}

export async function updateRegistrationStatus(ctx: CommandContext, reg: RegistrationRow, status: RegistrationRow["status"], extra: Partial<RegistrationRow> = {}) {
  const [row] = await ctx.tx
    .update(tournamentRegistrations)
    .set({ status, ...extra, version: reg.version + 1, updatedAt: ctx.now })
    .where(eq(tournamentRegistrations.id, reg.id))
    .returning();
  ctx.touch(`registration:${reg.id}`, `player:${reg.playerId}`);
  ctx.emit({
    name: "registration.updated",
    data: { registrationId: reg.id, playerId: reg.playerId, status, previousStatus: reg.status },
    aggregateType: "registration",
    aggregateId: reg.id,
  });
  ctx.statsChanged();
  return row!;
}

/** Create additional tables numbered after the highest existing one. */
export async function addTables(ctx: CommandContext, count: number, capacity = ctx.tournament.tableSize) {
  const [row] = await ctx.tx
    .select({ n: max(tournamentTables.tableNumber) })
    .from(tournamentTables)
    .where(eq(tournamentTables.tournamentId, ctx.tournament.id));
  const start = (row?.n ?? 0) + 1;
  const created = await ctx.tx
    .insert(tournamentTables)
    .values(
      Array.from({ length: count }, (_, i) => ({
        organizationId: ctx.tournament.organizationId,
        tournamentId: ctx.tournament.id,
        tableNumber: start + i,
        capacity,
        status: "OPEN",
      })),
    )
    .returning();
  for (const t of created) {
    ctx.emit({ name: "table.updated", data: { tableId: t.id, tableNumber: t.tableNumber, status: t.status, capacity: t.capacity, created: true }, audience: "public" });
  }
  ctx.touch("tables");
  return created;
}

/**
 * Apply one seat move: release the previous seat (if any), occupy the new one,
 * and record the movement history (spec §60).
 */
export async function applyMove(ctx: CommandContext, move: Omit<SeatMove, "explanation"> & { explanation?: string }, state?: SeatingState) {
  const entry = await getEntry(ctx, move.entryId);
  if (entry.status !== "ACTIVE") throw ruleViolation("only active entries can be seated");
  const tables = state?.tables ?? (await loadSeatingState(ctx.tx, ctx.tournament.id)).tables;
  const to = tables.find((t) => t.id === move.toTableId);
  if (!to) throw notFound("table");
  if (to.status === "CLOSED" || to.status === "BREAKING") throw ruleViolation(`table ${to.tableNumber} does not accept players`);

  let fromTableNumber: number | null = null;
  if (move.fromTableId) {
    const released = await ctx.tx
      .update(tournamentSeatAssignments)
      .set({ status: "RELEASED", releasedAt: ctx.now })
      .where(
        and(
          eq(tournamentSeatAssignments.entryId, move.entryId),
          eq(tournamentSeatAssignments.tableId, move.fromTableId),
          eq(tournamentSeatAssignments.seatNumber, move.fromSeatNumber ?? -1),
          eq(tournamentSeatAssignments.status, "ACTIVE"),
        ),
      )
      .returning();
    if (released.length === 0) throw new AppError("VERSION_CONFLICT", "player is no longer at the expected seat");
    fromTableNumber = tables.find((t) => t.id === move.fromTableId)?.tableNumber ?? null;
    ctx.touch(seatKey(move.fromTableId, move.fromSeatNumber));
  } else {
    const [current] = await ctx.tx
      .select({ id: tournamentSeatAssignments.id })
      .from(tournamentSeatAssignments)
      .where(and(eq(tournamentSeatAssignments.entryId, move.entryId), eq(tournamentSeatAssignments.status, "ACTIVE")));
    if (current) throw ruleViolation("entry is already seated");
  }

  try {
    await ctx.tx.insert(tournamentSeatAssignments).values({
      organizationId: ctx.tournament.organizationId,
      tournamentId: ctx.tournament.id,
      tableId: move.toTableId,
      seatNumber: move.toSeatNumber,
      entryId: move.entryId,
      playerId: entry.playerId,
      status: "ACTIVE",
      assignedAt: ctx.now,
    });
  } catch (e) {
    if (pgErrorInfo(e).constraint === "seat_active_seat_uq") {
      throw new AppError("VERSION_CONFLICT", `table ${to.tableNumber} seat ${move.toSeatNumber} is already occupied`);
    }
    throw e;
  }
  if (to.status === "OPEN") {
    await ctx.tx.update(tournamentTables).set({ status: "ACTIVE" }).where(eq(tournamentTables.id, to.id));
    to.status = "ACTIVE";
  }

  const [movement] = await ctx.tx
    .insert(seatMovements)
    .values({
      organizationId: ctx.tournament.organizationId,
      tournamentId: ctx.tournament.id,
      entryId: move.entryId,
      playerId: entry.playerId,
      fromTableId: move.fromTableId,
      fromTableNumber,
      fromSeat: move.fromSeatNumber,
      toTableId: move.toTableId,
      toTableNumber: to.tableNumber,
      toSeat: move.toSeatNumber,
      reason: move.reason,
      actionId: ctx.actionId,
      performedBy: ctx.actor.userId,
      createdAt: ctx.now,
    })
    .returning({ id: seatMovements.id });

  const name = await playerName(ctx, entry.playerId);
  ctx.touch(`entry:${move.entryId}`, seatKey(move.toTableId, move.toSeatNumber));
  const data = {
    movementId: movement!.id,
    entryId: move.entryId,
    playerId: entry.playerId,
    playerName: name,
    fromTableId: move.fromTableId,
    fromTableNumber,
    fromSeatNumber: move.fromSeatNumber,
    toTableId: move.toTableId,
    toTableNumber: to.tableNumber,
    toSeatNumber: move.toSeatNumber,
    reason: move.reason,
  };
  const topics = [topic.table(move.toTableId), ...(move.fromTableId ? [topic.table(move.fromTableId)] : [])];
  ctx.emit({ name: move.fromTableId ? "seat.moved" : "seat.assigned", data, topics, audience: ctx.seatAudience(), aggregateType: "entry", aggregateId: move.entryId });
  return { ...data };
}

/** Release the active seat of an entry (elimination, void). Returns the released seat. */
export async function releaseSeat(ctx: CommandContext, entryId: string, reason: SeatMovementReason | "ELIMINATION" | "VOID") {
  const released = await ctx.tx
    .update(tournamentSeatAssignments)
    .set({ status: "RELEASED", releasedAt: ctx.now })
    .where(and(eq(tournamentSeatAssignments.entryId, entryId), eq(tournamentSeatAssignments.status, "ACTIVE")))
    .returning();
  const seat = released[0];
  if (!seat) return null;
  const [table] = await ctx.tx.select().from(tournamentTables).where(eq(tournamentTables.id, seat.tableId));
  ctx.touch(seatKey(seat.tableId, seat.seatNumber));
  ctx.emit({
    name: "seat.released",
    data: { entryId, playerId: seat.playerId, tableId: seat.tableId, tableNumber: table?.tableNumber ?? null, seatNumber: seat.seatNumber, reason },
    topics: [topic.table(seat.tableId)],
    audience: ctx.seatAudience(),
    aggregateType: "entry",
    aggregateId: entryId,
  });
  return { tableId: seat.tableId, tableNumber: table?.tableNumber ?? null, seatNumber: seat.seatNumber };
}

/** Whether initial seating has happened (so new entries are seated immediately). */
export function seatingStarted(ctx: CommandContext): boolean {
  return ["SEATING", "RUNNING", "BREAK", "PAUSED", "HAND_FOR_HAND"].includes(ctx.tournament.status);
}

/** Seat an entry according to the target, opening a new table when every seat is taken. */
export async function seatEntry(ctx: CommandContext, entryId: string, target: SeatTarget, reason: SeatMovementReason) {
  if (target === "NONE") return null;
  if (target === "AUTO") {
    if (!seatingStarted(ctx)) return null;
    let state = await loadSeatingState(ctx.tx, ctx.tournament.id);
    let move = chooseSeatForNewEntry(state.seating, entryId, ctx.houseRules.lateRegistrationSeatPolicy, ctx.rng, reason);
    if (!move) {
      await addTables(ctx, 1);
      state = await loadSeatingState(ctx.tx, ctx.tournament.id);
      move = chooseSeatForNewEntry(state.seating, entryId, ctx.houseRules.lateRegistrationSeatPolicy, ctx.rng, reason);
      if (!move) throw ruleViolation("no seat available");
    }
    return applyMove(ctx, move, state);
  }
  const state = await loadSeatingState(ctx.tx, ctx.tournament.id);
  const table = state.seating.find((t) => t.id === target.tableId);
  if (!table) throw notFound("table");
  if (target.seatNumber > table.capacity) throw ruleViolation("seat number exceeds table capacity");
  if (table.lockedSeats.has(target.seatNumber)) throw ruleViolation(`seat ${target.seatNumber} is locked`);
  return applyMove(ctx, { entryId, fromTableId: null, fromSeatNumber: null, toTableId: target.tableId, toSeatNumber: target.seatNumber, reason }, state);
}

/** Create an entry (initial or re-entry) with its buy-in transaction. */
export async function createEntry(ctx: CommandContext, reg: RegistrationRow, type: "INITIAL" | "REENTRY") {
  const [last] = await ctx.tx
    .select({ n: tournamentEntries.entryNumber })
    .from(tournamentEntries)
    .where(and(eq(tournamentEntries.tournamentId, ctx.tournament.id), eq(tournamentEntries.playerId, reg.playerId)))
    .orderBy(desc(tournamentEntries.entryNumber))
    .limit(1);
  const [entry] = await ctx.tx
    .insert(tournamentEntries)
    .values({
      organizationId: ctx.tournament.organizationId,
      tournamentId: ctx.tournament.id,
      registrationId: reg.id,
      playerId: reg.playerId,
      entryNumber: (last?.n ?? 0) + 1,
      type,
      status: "ACTIVE",
      createdBy: ctx.actor.userId,
      createdAt: ctx.now,
    })
    .returning();
  const buyIn = ctx.tournament.buyIn;
  await ctx.tx.insert(entryTransactions).values({
    organizationId: ctx.tournament.organizationId,
    tournamentId: ctx.tournament.id,
    entryId: entry!.id,
    type: "BUY_IN",
    chips: ctx.tournament.startingStack,
    amount: buyIn ? buyIn.amount + buyIn.fee : 0,
    actionId: ctx.actionId,
    createdBy: ctx.actor.userId,
    createdAt: ctx.now,
  });
  if (reg.status !== "PLAYING") await updateRegistrationStatus(ctx, reg, "PLAYING");
  const name = await playerName(ctx, reg.playerId);
  ctx.touch(`entry:${entry!.id}`, `player:${reg.playerId}`);
  ctx.emit({
    name: "entry.created",
    data: { entryId: entry!.id, playerId: reg.playerId, playerName: name, entryNumber: entry!.entryNumber, type },
    aggregateType: "entry",
    aggregateId: entry!.id,
  });
  ctx.statsChanged();
  return entry!;
}

export async function otherActiveEntry(ctx: CommandContext, playerId: string, exceptEntryId: string) {
  const [row] = await ctx.tx
    .select({ id: tournamentEntries.id })
    .from(tournamentEntries)
    .where(
      and(
        eq(tournamentEntries.tournamentId, ctx.tournament.id),
        eq(tournamentEntries.playerId, playerId),
        eq(tournamentEntries.status, "ACTIVE"),
        ne(tournamentEntries.id, exceptEntryId),
      ),
    );
  return row ?? null;
}

export async function activeEntryCount(ctx: CommandContext): Promise<number> {
  const rows = await ctx.tx
    .select({ id: tournamentEntries.id })
    .from(tournamentEntries)
    .where(and(eq(tournamentEntries.tournamentId, ctx.tournament.id), eq(tournamentEntries.status, "ACTIVE")));
  return rows.length;
}
