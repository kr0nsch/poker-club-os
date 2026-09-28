// Seating engine (spec §56): random initial seating, late-entry seat choice.
// All functions are pure: they return a plan (list of moves). The application
// layer applies plans transactionally after re-validating them.

import type { SeatMovementReason, TableStatus } from "@pcos/types";
import { ruleViolation } from "./errors.js";
import { pick, shuffle, type Rng } from "./rng.js";

export interface SeatingTable {
  id: string;
  tableNumber: number;
  capacity: number;
  status: TableStatus;
  /** seatNumber → entryId for currently occupied seats */
  seats: ReadonlyMap<number, string>;
  lockedSeats: ReadonlySet<number>;
  dealerButtonSeat?: number | null;
}

export interface SeatMove {
  entryId: string;
  fromTableId: string | null;
  fromSeatNumber: number | null;
  toTableId: string;
  toSeatNumber: number;
  reason: SeatMovementReason;
  explanation: string;
}

/** Mutable working copy used while planning. */
export interface WorkTable {
  id: string;
  tableNumber: number;
  capacity: number;
  status: TableStatus;
  seats: Map<number, string>;
  lockedSeats: Set<number>;
  dealerButtonSeat: number | null;
}

export const acceptsPlayers = (t: { status: TableStatus }) => t.status === "OPEN" || t.status === "ACTIVE";

export function toWork(tables: readonly SeatingTable[]): WorkTable[] {
  return tables.map((t) => ({
    id: t.id,
    tableNumber: t.tableNumber,
    capacity: t.capacity,
    status: t.status,
    seats: new Map(t.seats),
    lockedSeats: new Set(t.lockedSeats),
    dealerButtonSeat: t.dealerButtonSeat ?? null,
  }));
}

export function openSeats(t: Pick<WorkTable, "capacity" | "seats" | "lockedSeats">): number[] {
  const out: number[] = [];
  for (let s = 1; s <= t.capacity; s++) if (!t.seats.has(s) && !t.lockedSeats.has(s)) out.push(s);
  return out;
}

export const playerCount = (t: Pick<WorkTable, "seats">) => t.seats.size;

export function totalOpenSeats(tables: readonly WorkTable[]): number {
  return tables.filter(acceptsPlayers).reduce((n, t) => n + openSeats(t).length, 0);
}

/** Tables needed to seat `players` at `tableSize` (at least one). */
export function tablesNeeded(players: number, tableSize: number): number {
  return Math.max(1, Math.ceil(players / tableSize));
}

/** Choose the table with the fewest players that still has an open seat; ties broken randomly. */
function shortestTable(tables: readonly WorkTable[], rng: Rng): WorkTable | null {
  const candidates = tables.filter((t) => acceptsPlayers(t) && openSeats(t).length > 0);
  if (candidates.length === 0) return null;
  const min = Math.min(...candidates.map(playerCount));
  return pick(
    candidates.filter((t) => playerCount(t) === min),
    rng,
  );
}

export interface InitialSeatingInput {
  tables: readonly SeatingTable[];
  /** entries that need a seat (already-seated entries must not be included) */
  entryIds: readonly string[];
  rng: Rng;
  /** when false, seats are filled in order (table 1 seat 1, …) — used by venues that seat by arrival */
  random?: boolean;
}

export interface SeatingPlan {
  moves: SeatMove[];
  /** additional tables required when capacity is insufficient (plan is then empty) */
  additionalTablesNeeded: number;
}

/**
 * Random, balanced initial seating. Players are shuffled with a CSPRNG, then
 * each goes to the table with fewest players (ties random) and a random open
 * seat on it. Locked seats are never used.
 */
export function planInitialSeating(input: InitialSeatingInput): SeatingPlan {
  const work = toWork(input.tables);
  const capacity = totalOpenSeats(work);
  const n = input.entryIds.length;
  if (n > capacity) {
    const maxCap = Math.max(2, ...work.map((t) => t.capacity));
    return { moves: [], additionalTablesNeeded: Math.ceil((n - capacity) / maxCap) };
  }
  const random = input.random ?? true;
  const players = random ? shuffle(input.entryIds, input.rng) : [...input.entryIds];
  const moves: SeatMove[] = [];
  for (const entryId of players) {
    const table = random
      ? shortestTable(work, input.rng)
      : [...work].sort((a, b) => a.tableNumber - b.tableNumber).find((t) => acceptsPlayers(t) && openSeats(t).length > 0) ?? null;
    if (!table) throw ruleViolation("no open seat available");
    const seats = openSeats(table);
    const seat = random ? pick(seats, input.rng) : seats[0]!;
    table.seats.set(seat, entryId);
    moves.push({
      entryId,
      fromTableId: null,
      fromSeatNumber: null,
      toTableId: table.id,
      toSeatNumber: seat,
      reason: "INITIAL_SEATING",
      explanation: `Random draw: table ${table.tableNumber}, seat ${seat}`,
    });
  }
  return { moves, additionalTablesNeeded: 0 };
}

export type LateSeatPolicy = "RANDOM_OPEN_SEAT" | "SHORTEST_TABLE_RANDOM_SEAT";

/** Seat for a late registrant or re-entry. */
export function chooseSeatForNewEntry(
  tables: readonly SeatingTable[],
  entryId: string,
  policy: LateSeatPolicy,
  rng: Rng,
  reason: SeatMovementReason = "LATE_REGISTRATION",
): SeatMove | null {
  const work = toWork(tables).filter(acceptsPlayers);
  let table: WorkTable | null;
  let seat: number;
  if (policy === "RANDOM_OPEN_SEAT") {
    const all = work.flatMap((t) => openSeats(t).map((s) => ({ t, s })));
    if (all.length === 0) return null;
    const choice = pick(all, rng);
    table = choice.t;
    seat = choice.s;
  } else {
    table = shortestTable(work, rng);
    if (!table) return null;
    seat = pick(openSeats(table), rng);
  }
  return {
    entryId,
    fromTableId: null,
    fromSeatNumber: null,
    toTableId: table.id,
    toSeatNumber: seat,
    reason,
    explanation: `Table ${table.tableNumber} (${playerCount(table)} players), random seat ${seat}`,
  };
}

/**
 * Validate a plan against the current seat map before applying it. Moves are
 * applied sequentially, so a move may target a seat vacated by an earlier move.
 */
export function validatePlan(tables: readonly SeatingTable[], moves: readonly Omit<SeatMove, "reason" | "explanation">[]): string[] {
  const work = new Map(toWork(tables).map((t) => [t.id, t]));
  const location = new Map<string, { tableId: string; seat: number }>();
  for (const t of work.values()) for (const [seat, entryId] of t.seats) location.set(entryId, { tableId: t.id, seat });
  const errors: string[] = [];
  moves.forEach((m, i) => {
    const current = location.get(m.entryId) ?? null;
    if ((m.fromTableId ?? null) !== (current?.tableId ?? null) || (m.fromSeatNumber ?? null) !== (current?.seat ?? null)) {
      errors.push(`move ${i + 1}: entry is no longer at the expected seat`);
      return;
    }
    const to = work.get(m.toTableId);
    if (!to) return void errors.push(`move ${i + 1}: destination table not found`);
    if (!acceptsPlayers(to)) return void errors.push(`move ${i + 1}: table ${to.tableNumber} does not accept players`);
    if (m.toSeatNumber < 1 || m.toSeatNumber > to.capacity) return void errors.push(`move ${i + 1}: seat ${m.toSeatNumber} out of range`);
    if (to.seats.has(m.toSeatNumber)) return void errors.push(`move ${i + 1}: table ${to.tableNumber} seat ${m.toSeatNumber} is occupied`);
    if (to.lockedSeats.has(m.toSeatNumber)) return void errors.push(`move ${i + 1}: table ${to.tableNumber} seat ${m.toSeatNumber} is locked`);
    if (current) work.get(current.tableId)?.seats.delete(current.seat);
    to.seats.set(m.toSeatNumber, m.entryId);
    location.set(m.entryId, { tableId: to.id, seat: m.toSeatNumber });
  });
  return errors;
}
