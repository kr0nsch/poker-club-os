// Live tournament statistics shared by displays, live pages and dashboards.

import type { EntryStatus, EntryTransactionType, EntryType, RegistrationStatus, TournamentStats } from "@pcos/types";

export interface StatsInput {
  startingStack: number;
  registrations: readonly { status: RegistrationStatus }[];
  entries: readonly { id: string; playerId: string; type: EntryType; status: EntryStatus }[];
  transactions: readonly { entryId: string; type: EntryTransactionType; chips: number; amount: number; voided: boolean }[];
  /** fee part of each buy-in that does not go to the prize pool; null disables prize tracking */
  prizeTracking: { feePerEntry: number } | null;
}

export function computeStats(input: StatsInput): TournamentStats {
  const liveEntries = input.entries.filter((e) => e.status !== "VOIDED");
  const tx = input.transactions.filter((t) => !t.voided && t.type !== "VOID");
  const remaining = liveEntries.filter((e) => e.status === "ACTIVE").length;
  const totalChips = tx.reduce((n, t) => n + t.chips, 0);
  let prizePool: number | null = null;
  if (input.prizeTracking) {
    const gross = tx.filter((t) => t.type === "BUY_IN" || t.type === "REBUY" || t.type === "ADD_ON").reduce((n, t) => n + t.amount, 0);
    prizePool = Math.max(0, gross - input.prizeTracking.feePerEntry * liveEntries.length);
  }
  const count = (s: RegistrationStatus) => input.registrations.filter((r) => r.status === s).length;
  return {
    registrations: input.registrations.filter((r) => r.status !== "CANCELLED" && r.status !== "WAITLISTED").length,
    checkedIn: input.registrations.filter((r) => r.status === "CHECKED_IN" || r.status === "PLAYING" || r.status === "ELIMINATED").length,
    waitlisted: count("WAITLISTED"),
    entries: liveEntries.length,
    uniquePlayers: new Set(liveEntries.map((e) => e.playerId)).size,
    reentries: liveEntries.filter((e) => e.type === "REENTRY").length,
    rebuys: tx.filter((t) => t.type === "REBUY").length,
    addons: tx.filter((t) => t.type === "ADD_ON").length,
    remaining,
    totalChips,
    averageStack: remaining > 0 ? Math.round(totalChips / remaining) : null,
    prizePool,
  };
}
