// Table breaking (spec §59): choose a table to break and distribute its
// players to random open seats on the remaining tables, shortest table first.

import { ruleViolation } from "./errors.js";
import { acceptsPlayers, openSeats, playerCount, toWork, type SeatMove, type SeatingTable } from "./seating.js";
import { pick, type Rng } from "./rng.js";

export type TableBreakStrategy = "HIGHEST_NUMBER_FIRST" | "LOWEST_NUMBER_FIRST" | "FEWEST_PLAYERS_FIRST";

export interface BreakRecommendation {
  shouldBreak: boolean;
  tableId: string | null;
  tableNumber: number | null;
  reason: string;
}

/**
 * A table should break when the remaining players fit on one table fewer
 * (optionally forming a final table of `finalTableSize`).
 */
export function recommendTableBreak(
  tables: readonly SeatingTable[],
  strategy: TableBreakStrategy,
  finalTableSize?: number | null,
): BreakRecommendation {
  const active = toWork(tables).filter((t) => acceptsPlayers(t));
  const occupied = active.filter((t) => playerCount(t) > 0);
  const players = occupied.reduce((n, t) => n + playerCount(t), 0);
  if (occupied.length < 2) return { shouldBreak: false, tableId: null, tableNumber: null, reason: "fewer than two tables in play" };

  const ordered = [...occupied].sort((a, b) => {
    if (strategy === "LOWEST_NUMBER_FIRST") return a.tableNumber - b.tableNumber;
    if (strategy === "FEWEST_PLAYERS_FIRST") return playerCount(a) - playerCount(b) || b.tableNumber - a.tableNumber;
    return b.tableNumber - a.tableNumber;
  });
  const candidate = ordered[0]!;
  const remaining = occupied.filter((t) => t.id !== candidate.id);
  const seatsElsewhere = remaining.reduce((n, t) => n + openSeats(t).length, 0);
  const fitsElsewhere = playerCount(candidate) <= seatsElsewhere;

  if (occupied.length === 2 && finalTableSize != null && players > finalTableSize) {
    return { shouldBreak: false, tableId: null, tableNumber: null, reason: `${players} players remain; final table forms at ${finalTableSize}` };
  }
  if (!fitsElsewhere) {
    return { shouldBreak: false, tableId: null, tableNumber: null, reason: `${players} players need ${occupied.length} tables` };
  }
  return {
    shouldBreak: true,
    tableId: candidate.id,
    tableNumber: candidate.tableNumber,
    reason: `${players} players fit on ${occupied.length - 1} tables; break table ${candidate.tableNumber} (${strategy})`,
  };
}

/** Distribute every player from `tableId` to other tables. */
export function planTableBreak(tables: readonly SeatingTable[], tableId: string, rng: Rng): SeatMove[] {
  const work = toWork(tables);
  const breaking = work.find((t) => t.id === tableId);
  if (!breaking) throw ruleViolation("table not found");
  const targets = work.filter((t) => t.id !== tableId && acceptsPlayers(t) && t.status !== "BREAKING");
  const free = targets.reduce((n, t) => n + openSeats(t).length, 0);
  if (free < playerCount(breaking)) {
    throw ruleViolation(`not enough open seats to break table ${breaking.tableNumber} (${playerCount(breaking)} players, ${free} seats)`);
  }
  const moves: SeatMove[] = [];
  // Random order of players leaving the broken table (seat cards are drawn).
  const leaving = [...breaking.seats.entries()];
  for (let i = leaving.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [leaving[i], leaving[j]] = [leaving[j]!, leaving[i]!];
  }
  for (const [seat, entryId] of leaving) {
    const withSeats = targets.filter((t) => openSeats(t).length > 0);
    const min = Math.min(...withSeats.map(playerCount));
    const dest = pick(
      withSeats.filter((t) => playerCount(t) === min),
      rng,
    );
    const toSeat = pick(openSeats(dest), rng);
    moves.push({
      entryId,
      fromTableId: breaking.id,
      fromSeatNumber: seat,
      toTableId: dest.id,
      toSeatNumber: toSeat,
      reason: "TABLE_BREAK",
      explanation: `Table ${breaking.tableNumber} breaks: seat ${seat} → table ${dest.tableNumber} seat ${toSeat}`,
    });
    dest.seats.set(toSeat, entryId);
    breaking.seats.delete(seat);
  }
  return moves;
}
