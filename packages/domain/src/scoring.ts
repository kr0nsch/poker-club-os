// League scoring engine (spec §67).

import { compileFormula } from "./formula.js";

export const SCORE_VARIABLES = ["position", "entrants", "players", "buyIn", "reentries", "bounties", "entries"] as const;

export interface ScoreContext {
  position: number;
  /** total entries in the tournament (incl. re-entries) */
  entrants: number;
  /** unique players in the tournament */
  players: number;
  buyIn: number;
  /** re-entries used by this player */
  reentries: number;
  /** knockouts credited to this player */
  bounties: number;
  /** entries used by this player */
  entries: number;
}

export type ScoreRule =
  | {
      kind: "POSITION_TABLE";
      config: { points: number[]; otherPositionsPoints?: number; participationPoints?: number; bountyPoints?: number };
    }
  | { kind: "FORMULA"; config: { expression: string; minPoints?: number; roundTo?: number } };

export function scorePoints(rule: ScoreRule, ctx: ScoreContext): number {
  if (rule.kind === "POSITION_TABLE") {
    const c = rule.config;
    const base = c.points[ctx.position - 1] ?? c.otherPositionsPoints ?? 0;
    return base + (c.participationPoints ?? 0) + (c.bountyPoints ?? 0) * ctx.bounties;
  }
  const f = compileFormula(rule.config.expression, SCORE_VARIABLES);
  const raw = f.evaluate({ ...ctx });
  const round = rule.config.roundTo ?? 2;
  const factor = 10 ** round;
  return Math.max(rule.config.minPoints ?? 0, Math.round(raw * factor) / factor);
}

/** Validate a rule by scoring a sample field; returns an error message or null. */
export function validateScoreRule(rule: ScoreRule): string | null {
  try {
    for (const position of [1, 2, 10]) {
      scorePoints(rule, { position, entrants: 50, players: 45, buyIn: 100, reentries: 1, bounties: 2, entries: 2 });
    }
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

export interface PlayerTournamentScore {
  playerId: string;
  tournamentId: string;
  points: number;
  position: number;
  finishedAt: number;
}

export interface LeaderboardRow {
  rank: number;
  playerId: string;
  points: number;
  tournaments: number;
  counted: number;
  bestPosition: number;
  wins: number;
}

/**
 * Aggregate tournament scores into a leaderboard. With `bestResultsCount`,
 * only a player's best N scores count. Ties: points, wins, best finish, then
 * tournaments played (fewer is better — more efficient); equal rows share rank.
 */
export function computeLeaderboard(scores: readonly PlayerTournamentScore[], bestResultsCount?: number | null): LeaderboardRow[] {
  const byPlayer = new Map<string, PlayerTournamentScore[]>();
  for (const s of scores) {
    const l = byPlayer.get(s.playerId) ?? [];
    l.push(s);
    byPlayer.set(s.playerId, l);
  }
  const rows = [...byPlayer.entries()].map(([playerId, list]) => {
    const sorted = [...list].sort((a, b) => b.points - a.points);
    const counted = bestResultsCount ? sorted.slice(0, bestResultsCount) : sorted;
    const points = Math.round(counted.reduce((n, s) => n + s.points, 0) * 100) / 100;
    return {
      rank: 0,
      playerId,
      points,
      tournaments: list.length,
      counted: counted.length,
      bestPosition: Math.min(...list.map((s) => s.position)),
      wins: list.filter((s) => s.position === 1).length,
    };
  });
  const cmp = (a: LeaderboardRow, b: LeaderboardRow) =>
    b.points - a.points || b.wins - a.wins || a.bestPosition - b.bestPosition || a.tournaments - b.tournaments;
  rows.sort((a, b) => cmp(a, b) || a.playerId.localeCompare(b.playerId));
  rows.forEach((r, i) => {
    const prev = rows[i - 1];
    r.rank = prev && cmp(prev, r) === 0 ? prev.rank : i + 1;
  });
  return rows;
}
