// Table balancing engine (spec §58). Produces recommendations; the Tournament
// Director confirms them, then they are applied as a STRICT-versioned command.

import { acceptsPlayers, openSeats, playerCount, toWork, type SeatMove, type SeatingTable, type WorkTable } from "./seating.js";
import { pick, type Rng } from "./rng.js";

export interface BalanceAnalysis {
  balanced: boolean;
  imbalance: number;
  severe: boolean;
  maxTable: { id: string; tableNumber: number; players: number } | null;
  minTable: { id: string; tableNumber: number; players: number } | null;
  playersSeated: number;
  activeTables: number;
}

export interface BalanceOptions {
  maxImbalance: number;
  severeThreshold?: number;
  playerSelection: "BIG_BLIND_NEXT" | "RANDOM";
  rng: Rng;
}

const seated = (tables: readonly WorkTable[]) => tables.filter((t) => acceptsPlayers(t) && t.status !== "BREAKING");

export function analyzeBalance(tables: readonly SeatingTable[], maxImbalance: number, severeThreshold = 3): BalanceAnalysis {
  const work = seated(toWork(tables)).filter((t) => playerCount(t) > 0 || t.status === "ACTIVE");
  if (work.length < 2) {
    return {
      balanced: true,
      imbalance: 0,
      severe: false,
      maxTable: null,
      minTable: null,
      playersSeated: work.reduce((n, t) => n + playerCount(t), 0),
      activeTables: work.length,
    };
  }
  const sorted = [...work].sort((a, b) => playerCount(b) - playerCount(a) || a.tableNumber - b.tableNumber);
  const max = sorted[0]!;
  const min = sorted[sorted.length - 1]!;
  const imbalance = playerCount(max) - playerCount(min);
  return {
    balanced: imbalance <= maxImbalance,
    imbalance,
    severe: imbalance >= severeThreshold,
    maxTable: { id: max.id, tableNumber: max.tableNumber, players: playerCount(max) },
    minTable: { id: min.id, tableNumber: min.tableNumber, players: playerCount(min) },
    playersSeated: work.reduce((n, t) => n + playerCount(t), 0),
    activeTables: work.length,
  };
}

/** Occupied seats clockwise starting after `from`. */
function clockwiseOccupied(t: WorkTable, from: number): number[] {
  const out: number[] = [];
  for (let i = 1; i <= t.capacity; i++) {
    const s = ((from - 1 + i) % t.capacity) + 1;
    if (t.seats.has(s)) out.push(s);
  }
  return out;
}

/**
 * Seat of the player who will post the big blind on the next hand: with the
 * button at B, this hand's blinds are the 1st and 2nd occupied seats after B,
 * so next hand's big blind is the 3rd (heads-up tables use the 2nd).
 */
export function nextBigBlindSeat(t: WorkTable): number | null {
  if (t.dealerButtonSeat == null) return null;
  const order = clockwiseOccupied(t, t.dealerButtonSeat);
  if (order.length === 0) return null;
  if (order.length <= 2) return order[order.length - 1] ?? null;
  return order[2] ?? null;
}

/**
 * Worst position at the destination table: the open seat that reaches the big
 * blind soonest — the first open seat clockwise after the current big blind.
 */
function worstOpenSeat(t: WorkTable, rng: Rng): { seat: number; why: string } {
  const open = openSeats(t);
  if (t.dealerButtonSeat != null) {
    const order = clockwiseOccupied(t, t.dealerButtonSeat);
    const bb = order.length >= 2 ? order[1]! : order[0];
    if (bb != null) {
      for (let i = 1; i <= t.capacity; i++) {
        const s = ((bb - 1 + i) % t.capacity) + 1;
        if (open.includes(s)) return { seat: s, why: "seat that reaches the big blind first" };
      }
    }
  }
  return { seat: pick(open, rng), why: "random open seat (button position unknown)" };
}

/** Recommend moves until the spread between tables is within `maxImbalance`. */
export function recommendBalanceMoves(tables: readonly SeatingTable[], opts: BalanceOptions): SeatMove[] {
  const work = seated(toWork(tables));
  const moves: SeatMove[] = [];
  for (let guard = 0; guard < 500; guard++) {
    const candidates = work.filter((t) => playerCount(t) > 0 || t.status === "ACTIVE");
    if (candidates.length < 2) break;
    const byCount = [...candidates].sort((a, b) => playerCount(b) - playerCount(a) || b.tableNumber - a.tableNumber);
    const source = byCount[0]!;
    const destOptions = candidates
      .filter((t) => t.id !== source.id && openSeats(t).length > 0)
      .sort((a, b) => playerCount(a) - playerCount(b) || a.tableNumber - b.tableNumber);
    const dest = destOptions[0];
    if (!dest) break;
    const spread = playerCount(source) - playerCount(dest);
    if (spread <= opts.maxImbalance) break;

    let seat: number | null = null;
    let who = "";
    if (opts.playerSelection === "BIG_BLIND_NEXT") {
      seat = nextBigBlindSeat(source);
      if (seat != null) who = "player due to post the big blind next";
    }
    if (seat == null) {
      seat = pick([...source.seats.keys()], opts.rng);
      who = opts.playerSelection === "BIG_BLIND_NEXT" ? "random player (button position unknown)" : "random player";
    }
    const entryId = source.seats.get(seat)!;
    const target = worstOpenSeat(dest, opts.rng);
    moves.push({
      entryId,
      fromTableId: source.id,
      fromSeatNumber: seat,
      toTableId: dest.id,
      toSeatNumber: target.seat,
      reason: "BALANCE",
      explanation: `Table ${source.tableNumber} has ${playerCount(source)} players, table ${dest.tableNumber} has ${playerCount(dest)} (imbalance ${spread} > ${opts.maxImbalance}); moving ${who} to ${target.why}`,
    });
    source.seats.delete(seat);
    dest.seats.set(target.seat, entryId);
  }
  return moves;
}
