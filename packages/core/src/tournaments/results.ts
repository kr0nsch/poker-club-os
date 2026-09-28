// League points and leaderboard recalculation (spec §67). Runs inside the
// FINALIZE_RESULTS / CORRECT_RESULT transaction: purely local database work.

import {
  leaderboardSnapshots,
  leagues,
  players,
  scoreRules,
  seasons,
  tournamentEntries,
  tournamentResults,
  tournaments,
  type Executor,
} from "@pcos/db";
import { computeLeaderboard, scorePoints, type LeaderboardRow, type ScoreRule } from "@pcos/domain";
import { topic } from "@pcos/types";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import type { CommandContext } from "./context.js";

export interface LeaderboardSnapshotRow extends LeaderboardRow {
  playerName: string;
  previousRank: number | null;
}

export async function applyLeaguePoints(ctx: CommandContext) {
  const seasonId = ctx.tournament.seasonId;
  if (!seasonId) return null;
  const [season] = await ctx.tx.select().from(seasons).where(eq(seasons.id, seasonId));
  if (!season) return null;
  const [league] = await ctx.tx.select().from(leagues).where(eq(leagues.id, season.leagueId));
  if (!league) return null;
  const [rule] = await ctx.tx.select().from(scoreRules).where(eq(scoreRules.id, league.scoreRuleId));
  if (!rule) return null;

  const results = await ctx.tx.select().from(tournamentResults).where(eq(tournamentResults.tournamentId, ctx.tournament.id));
  const entries = await ctx.tx
    .select({ playerId: tournamentEntries.playerId })
    .from(tournamentEntries)
    .where(and(eq(tournamentEntries.tournamentId, ctx.tournament.id), ne(tournamentEntries.status, "VOIDED")));
  const entrants = entries.length;
  const uniquePlayers = new Set(entries.map((e) => e.playerId)).size;
  const scoreRule = { kind: rule.kind, config: rule.config } as ScoreRule;

  for (const r of results) {
    const points = scorePoints(scoreRule, {
      position: r.position,
      entrants,
      players: uniquePlayers,
      buyIn: ctx.tournament.buyIn?.amount ?? 0,
      reentries: Math.max(0, r.entries - 1),
      bounties: r.bounties,
      entries: r.entries,
    });
    await ctx.tx.update(tournamentResults).set({ points }).where(eq(tournamentResults.id, r.id));
  }

  const rows = await recomputeLeaderboard(ctx.tx, ctx.tournament.organizationId, seasonId, league.bestResultsCount, ctx.tournament.id, ctx.now);
  ctx.emit({
    name: "leaderboard.updated",
    audience: "public",
    topics: [topic.organization(ctx.tournament.organizationId)],
    aggregateType: "season",
    aggregateId: seasonId,
    data: {
      seasonId,
      leagueId: league.id,
      top: rows.slice(0, 20).map((r) => ({ rank: r.rank, playerId: r.playerId, playerName: r.playerName, points: r.points })),
      changes: rows
        .filter((r) => r.previousRank !== r.rank)
        .map((r) => ({ playerId: r.playerId, rank: r.rank, previousRank: r.previousRank, points: r.points })),
    },
  });
  return { seasonId, leagueId: league.id, players: rows.length };
}

export async function recomputeLeaderboard(
  db: Executor,
  organizationId: string,
  seasonId: string,
  bestResultsCount: number | null,
  triggeredByTournamentId: string | null,
  now: Date,
): Promise<LeaderboardSnapshotRow[]> {
  const seasonTournaments = await db
    .select({ id: tournaments.id, finishedAt: tournaments.finishedAt })
    .from(tournaments)
    .where(and(eq(tournaments.seasonId, seasonId), eq(tournaments.status, "FINALIZED")));
  const ids = seasonTournaments.map((t) => t.id);
  // The tournament being finalised is still FINISHED inside this transaction.
  if (triggeredByTournamentId && !ids.includes(triggeredByTournamentId)) ids.push(triggeredByTournamentId);
  const results =
    ids.length === 0
      ? []
      : await db
          .select({ r: tournamentResults, name: players.displayName })
          .from(tournamentResults)
          .innerJoin(players, eq(players.id, tournamentResults.playerId))
          .where(inArray(tournamentResults.tournamentId, ids));
  const finishedAt = new Map(seasonTournaments.map((t) => [t.id, t.finishedAt?.getTime() ?? 0]));
  const board = computeLeaderboard(
    results.map(({ r }) => ({
      playerId: r.playerId,
      tournamentId: r.tournamentId,
      points: typeof r.points === "number" ? r.points : 0,
      position: r.position,
      finishedAt: finishedAt.get(r.tournamentId) ?? now.getTime(),
    })),
    bestResultsCount,
  );
  const [previous] = await db
    .select()
    .from(leaderboardSnapshots)
    .where(eq(leaderboardSnapshots.seasonId, seasonId))
    .orderBy(desc(leaderboardSnapshots.computedAt))
    .limit(1);
  const prevRanks = new Map(((previous?.rows ?? []) as LeaderboardSnapshotRow[]).map((r) => [r.playerId, r.rank]));
  const names = new Map(results.map(({ r, name }) => [r.playerId, name]));
  const rows: LeaderboardSnapshotRow[] = board.map((b) => ({ ...b, playerName: names.get(b.playerId) ?? "?", previousRank: prevRanks.get(b.playerId) ?? null }));
  await db.insert(leaderboardSnapshots).values({ organizationId, seasonId, rows, computedAt: now, triggeredByTournamentId });
  return rows;
}
