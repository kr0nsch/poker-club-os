import { entryTransactions, tournamentEntries, tournamentRegistrations, type Executor } from "@pcos/db";
import { computeStats } from "@pcos/domain";
import type { EntryStatus, EntryTransactionType, EntryType, FeatureFlags, RegistrationStatus, TournamentStats } from "@pcos/types";
import { eq } from "drizzle-orm";
import type { TournamentRow } from "./repo.js";

export async function computeTournamentStats(db: Executor, t: TournamentRow, flags: FeatureFlags): Promise<TournamentStats> {
  // Sequential on purpose: inside a transaction all queries share one connection.
  const registrations = await db
    .select({ status: tournamentRegistrations.status })
    .from(tournamentRegistrations)
    .where(eq(tournamentRegistrations.tournamentId, t.id));
  const entries = await db
    .select({ id: tournamentEntries.id, playerId: tournamentEntries.playerId, type: tournamentEntries.type, status: tournamentEntries.status })
    .from(tournamentEntries)
    .where(eq(tournamentEntries.tournamentId, t.id));
  const transactions = await db
    .select({
      entryId: entryTransactions.entryId,
      type: entryTransactions.type,
      chips: entryTransactions.chips,
      amount: entryTransactions.amount,
      voided: entryTransactions.voided,
    })
    .from(entryTransactions)
    .where(eq(entryTransactions.tournamentId, t.id));
  return computeStats({
    startingStack: t.startingStack,
    registrations: registrations.map((r) => ({ status: r.status as RegistrationStatus })),
    entries: entries.map((e) => ({ ...e, type: e.type as EntryType, status: e.status as EntryStatus })),
    transactions: transactions.map((x) => ({ ...x, type: x.type as EntryTransactionType })),
    prizeTracking: flags.prizeTracking ? { feePerEntry: t.buyIn?.fee ?? 0 } : null,
  });
}
