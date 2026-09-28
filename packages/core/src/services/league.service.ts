// Leagues, seasons, series, score rules and leaderboards (spec §67).

import { leaderboardSnapshots, leagues, organizations, scoreRules, seasons, series } from "@pcos/db";
import { scorePoints, validateScoreRule, type ScoreRule } from "@pcos/domain";
import { LeagueInput, ScoreRuleInput, SeasonInput, SeriesInput } from "@pcos/types";
import { and, asc, desc, eq } from "drizzle-orm";
import { requireOrganization, requirePermission, type Actor } from "../actor.js";
import { writeAudit } from "../audit.js";
import type { CoreDeps } from "../deps.js";
import { AppError, notFound, validation } from "../errors.js";
import { recomputeLeaderboard, type LeaderboardSnapshotRow } from "../tournaments/results.js";

export class LeagueService {
  constructor(private readonly deps: CoreDeps) {}

  async listScoreRules(actor: Actor) {
    requirePermission(actor, "tournament.read");
    return this.deps.db.select().from(scoreRules).where(eq(scoreRules.organizationId, requireOrganization(actor))).orderBy(asc(scoreRules.name));
  }

  async saveScoreRule(actor: Actor, raw: unknown, id?: string) {
    requirePermission(actor, "league.manage");
    const orgId = requireOrganization(actor);
    const input = ScoreRuleInput.parse(raw);
    const problem = validateScoreRule({ kind: input.kind, config: input.config } as ScoreRule);
    if (problem) throw validation(`score rule is invalid: ${problem}`);
    const [row] = id
      ? await this.deps.db
          .update(scoreRules)
          .set({ name: input.name, kind: input.kind, config: input.config, updatedAt: this.deps.now() })
          .where(and(eq(scoreRules.id, id), eq(scoreRules.organizationId, orgId)))
          .returning()
      : await this.deps.db.insert(scoreRules).values({ organizationId: orgId, name: input.name, kind: input.kind, config: input.config }).returning();
    if (!row) throw notFound("score rule");
    await writeAudit(this.deps.db, actor, this.deps.edgeNodeId, { organizationId: orgId, entityType: "score_rule", entityId: row.id, action: id ? "SCORE_RULE_UPDATED" : "SCORE_RULE_CREATED", after: input });
    return row;
  }

  /** Points for positions 1..N given a field size — lets managers see a rule before saving it. */
  previewScoreRule(actor: Actor, raw: unknown, sample: { entrants?: number; players?: number; buyIn?: number } = {}) {
    requirePermission(actor, "league.manage");
    const input = ScoreRuleInput.parse(raw);
    const rule = { kind: input.kind, config: input.config } as ScoreRule;
    const problem = validateScoreRule(rule);
    if (problem) throw validation(problem);
    const entrants = Math.max(2, Math.min(sample.entrants ?? 40, 2000));
    return Array.from({ length: Math.min(entrants, 50) }, (_, i) => ({
      position: i + 1,
      points: scorePoints(rule, { position: i + 1, entrants, players: sample.players ?? entrants, buyIn: sample.buyIn ?? 100, reentries: 0, bounties: 0, entries: 1 }),
    }));
  }

  async listLeagues(actor: Actor) {
    requirePermission(actor, "tournament.read");
    const orgId = requireOrganization(actor);
    const ls = await this.deps.db.select().from(leagues).where(eq(leagues.organizationId, orgId)).orderBy(asc(leagues.name));
    const ss = await this.deps.db.select().from(seasons).where(eq(seasons.organizationId, orgId)).orderBy(desc(seasons.startsOn));
    return ls.map((l) => ({ ...l, seasons: ss.filter((s) => s.leagueId === l.id) }));
  }

  async saveLeague(actor: Actor, raw: unknown, id?: string) {
    requirePermission(actor, "league.manage");
    const orgId = requireOrganization(actor);
    const input = LeagueInput.parse(raw);
    const [rule] = await this.deps.db.select({ id: scoreRules.id }).from(scoreRules).where(and(eq(scoreRules.id, input.scoreRuleId), eq(scoreRules.organizationId, orgId)));
    if (!rule) throw notFound("score rule");
    const values = { name: input.name, description: input.description ?? null, scoreRuleId: input.scoreRuleId, bestResultsCount: input.bestResultsCount ?? null };
    const [row] = id
      ? await this.deps.db.update(leagues).set({ ...values, updatedAt: this.deps.now() }).where(and(eq(leagues.id, id), eq(leagues.organizationId, orgId))).returning()
      : await this.deps.db.insert(leagues).values({ organizationId: orgId, ...values }).returning();
    if (!row) throw notFound("league");
    await writeAudit(this.deps.db, actor, this.deps.edgeNodeId, { organizationId: orgId, entityType: "league", entityId: row.id, action: id ? "LEAGUE_UPDATED" : "LEAGUE_CREATED", after: input });
    return row;
  }

  async saveSeason(actor: Actor, leagueId: string, raw: unknown, id?: string) {
    requirePermission(actor, "league.manage");
    const orgId = requireOrganization(actor);
    const input = SeasonInput.parse(raw);
    if (input.endsOn < input.startsOn) throw validation("season ends before it starts");
    const [league] = await this.deps.db.select().from(leagues).where(and(eq(leagues.id, leagueId), eq(leagues.organizationId, orgId)));
    if (!league) throw notFound("league");
    const [row] = id
      ? await this.deps.db.update(seasons).set(input).where(and(eq(seasons.id, id), eq(seasons.leagueId, leagueId))).returning()
      : await this.deps.db.insert(seasons).values({ organizationId: orgId, leagueId, ...input }).returning();
    if (!row) throw notFound("season");
    return row;
  }

  async listSeries(actor: Actor) {
    requirePermission(actor, "tournament.read");
    return this.deps.db.select().from(series).where(eq(series.organizationId, requireOrganization(actor))).orderBy(desc(series.startsOn));
  }

  async saveSeries(actor: Actor, raw: unknown, id?: string) {
    requirePermission(actor, "league.manage");
    const orgId = requireOrganization(actor);
    const input = SeriesInput.parse(raw);
    const values = { name: input.name, seasonId: input.seasonId ?? null, startsOn: input.startsOn ?? null, endsOn: input.endsOn ?? null };
    const [row] = id
      ? await this.deps.db.update(series).set(values).where(and(eq(series.id, id), eq(series.organizationId, orgId))).returning()
      : await this.deps.db.insert(series).values({ organizationId: orgId, ...values }).returning();
    if (!row) throw notFound("series");
    return row;
  }

  private async latest(seasonId: string) {
    const [snap] = await this.deps.db.select().from(leaderboardSnapshots).where(eq(leaderboardSnapshots.seasonId, seasonId)).orderBy(desc(leaderboardSnapshots.computedAt)).limit(1);
    return snap ?? null;
  }

  async leaderboard(actor: Actor, seasonId: string) {
    requirePermission(actor, "tournament.read");
    const orgId = requireOrganization(actor);
    const [season] = await this.deps.db.select().from(seasons).where(and(eq(seasons.id, seasonId), eq(seasons.organizationId, orgId)));
    if (!season) throw notFound("season");
    const snap = await this.latest(seasonId);
    return { season, computedAt: snap?.computedAt.toISOString() ?? null, rows: (snap?.rows ?? []) as LeaderboardSnapshotRow[] };
  }

  async recalculate(actor: Actor, seasonId: string) {
    requirePermission(actor, "league.manage");
    const orgId = requireOrganization(actor);
    const [season] = await this.deps.db.select().from(seasons).where(and(eq(seasons.id, seasonId), eq(seasons.organizationId, orgId)));
    if (!season) throw notFound("season");
    const [league] = await this.deps.db.select().from(leagues).where(eq(leagues.id, season.leagueId));
    if (!league) throw new AppError("NOT_FOUND", "league not found");
    const rows = await recomputeLeaderboard(this.deps.db, orgId, seasonId, league.bestResultsCount, null, this.deps.now());
    await writeAudit(this.deps.db, actor, this.deps.edgeNodeId, { organizationId: orgId, entityType: "season", entityId: seasonId, action: "LEADERBOARD_RECALCULATED", metadata: { rows: rows.length } });
    return { rows };
  }

  /** Public leaderboard for players (display names only). */
  async publicLeaderboards(orgSlug: string) {
    const [org] = await this.deps.db.select().from(organizations).where(eq(organizations.slug, orgSlug));
    if (!org) throw notFound("organization");
    const ls = await this.deps.db.select().from(leagues).where(and(eq(leagues.organizationId, org.id), eq(leagues.status, "ACTIVE")));
    const out = [];
    for (const l of ls) {
      const ss = await this.deps.db.select().from(seasons).where(eq(seasons.leagueId, l.id)).orderBy(desc(seasons.startsOn)).limit(1);
      const season = ss[0];
      if (!season) continue;
      const snap = await this.latest(season.id);
      out.push({
        league: { id: l.id, name: l.name },
        season: { id: season.id, name: season.name, startsOn: season.startsOn, endsOn: season.endsOn },
        rows: ((snap?.rows ?? []) as LeaderboardSnapshotRow[]).slice(0, 100).map((r) => ({ rank: r.rank, playerId: r.playerId, playerName: r.playerName, points: r.points, tournaments: r.tournaments, wins: r.wins })),
      });
    }
    return { organization: { name: org.name, slug: org.slug }, leagues: out };
  }
}
