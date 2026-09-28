// Standings from elimination order (spec §62, §66).
//
// Every elimination receives a tournament-wide increasing sequence number.
// Players are ranked by their *last* entry: survivors first, then the most
// recently eliminated. For several players busted in the same hand the TD
// submits them ordered by starting stack (largest first); the command assigns
// sequence numbers so that the larger stack busts "later" and finishes higher.

import type { EntryStatus } from "@pcos/types";
import { ruleViolation } from "./errors.js";

export interface StandingEntry {
  entryId: string;
  playerId: string;
  entryNumber: number;
  status: EntryStatus;
  eliminationSeq: number | null;
}

export interface Standing {
  playerId: string;
  /** null while the player is still in (TIED mode) */
  position: number | null;
  entries: number;
  lastEntryId: string;
  stillPlaying: boolean;
}

export function computeStandings(
  entries: readonly StandingEntry[],
  opts: { mode: "FINAL"; finalOrder?: readonly string[] } | { mode: "LIVE" } = { mode: "LIVE" },
): Standing[] {
  const byPlayer = new Map<string, StandingEntry[]>();
  for (const e of entries) {
    if (e.status === "VOIDED") continue;
    const list = byPlayer.get(e.playerId) ?? [];
    list.push(e);
    byPlayer.set(e.playerId, list);
  }
  const lasts = [...byPlayer.entries()].map(([playerId, list]) => {
    const last = list.reduce((a, b) => (b.entryNumber > a.entryNumber ? b : a));
    return { playerId, last, entries: list.length };
  });
  const survivors = lasts.filter((p) => p.last.status === "ACTIVE");
  const busted = lasts
    .filter((p) => p.last.status === "ELIMINATED")
    .sort((a, b) => (b.last.eliminationSeq ?? 0) - (a.last.eliminationSeq ?? 0));

  const out: Standing[] = [];
  if (opts.mode === "FINAL") {
    let ordered = survivors;
    if (survivors.length > 1) {
      const order = opts.finalOrder ?? [];
      const rank = new Map(order.map((id, i) => [id, i]));
      if (survivors.some((s) => !rank.has(s.last.entryId))) {
        throw ruleViolation(`${survivors.length} players remain; eliminate players or provide the final order of the remaining entries`);
      }
      ordered = [...survivors].sort((a, b) => rank.get(a.last.entryId)! - rank.get(b.last.entryId)!);
    }
    ordered.forEach((s, i) =>
      out.push({ playerId: s.playerId, position: i + 1, entries: s.entries, lastEntryId: s.last.entryId, stillPlaying: false }),
    );
  } else {
    for (const s of survivors) {
      out.push({ playerId: s.playerId, position: null, entries: s.entries, lastEntryId: s.last.entryId, stillPlaying: true });
    }
  }
  busted.forEach((b, i) =>
    out.push({
      playerId: b.playerId,
      position: survivors.length + i + 1,
      entries: b.entries,
      lastEntryId: b.last.entryId,
      stillPlaying: false,
    }),
  );
  return out;
}

/**
 * Sequence numbers for a multi-elimination. `entryIds` are ordered by stack at
 * the start of the hand, largest first → the largest gets the highest sequence.
 */
export function assignEliminationSequence(entryIds: readonly string[], lastSeq: number): Map<string, number> {
  const out = new Map<string, number>();
  const n = entryIds.length;
  entryIds.forEach((id, i) => out.set(id, lastSeq + (n - i)));
  return out;
}
