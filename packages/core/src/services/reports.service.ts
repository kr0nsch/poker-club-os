// Business dashboard and operational analytics (spec §71-72).

import { auditLogs, exportJobs, players, tournamentResults, tournaments, users } from "@pcos/db";
import { AuditQuery } from "@pcos/types";
import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import Papa from "papaparse";
import { requireOrganization, requirePermission, type Actor } from "../actor.js";
import { writeAudit } from "../audit.js";
import type { CoreDeps } from "../deps.js";

type Row = Record<string, unknown>;

export class ReportsService {
  constructor(private readonly deps: CoreDeps) {}

  private async rows(query: ReturnType<typeof sql>): Promise<Row[]> {
    return (await this.deps.db.execute(query)).rows as Row[];
  }

  async dashboard(actor: Actor, opts: { venueId?: string; timezone?: string } = {}) {
    requirePermission(actor, "analytics.read");
    const orgId = requireOrganization(actor);
    const tz = opts.timezone ?? "UTC";
    const venue = opts.venueId ? sql`and t.venue_id = ${opts.venueId}` : sql``;
    const [today] = await this.rows(sql`
      with day as (select (now() at time zone ${tz})::date as d)
      select
        (select count(*)::int from tournament_registrations r join tournaments t on t.id = r.tournament_id
          where r.organization_id = ${orgId} ${venue} and (r.registered_at at time zone ${tz})::date = (select d from day)) as registrations_today,
        (select count(*)::int from tournament_registrations r join tournaments t on t.id = r.tournament_id
          where r.organization_id = ${orgId} ${venue} and (r.checked_in_at at time zone ${tz})::date = (select d from day)) as checked_in_today,
        (select count(*)::int from tournaments t where t.organization_id = ${orgId} ${venue}
          and t.status in ('SEATING','RUNNING','BREAK','PAUSED','HAND_FOR_HAND')) as active_tournaments,
        (select count(*)::int from tournaments t where t.organization_id = ${orgId} ${venue}
          and (t.start_at at time zone ${tz})::date = (select d from day)) as tournaments_today`);

    // New vs returning among players who registered in the last 30 days.
    const [newReturning] = await this.rows(sql`
      with recent as (
        select distinct r.player_id from tournament_registrations r join tournaments t on t.id = r.tournament_id
        where r.organization_id = ${orgId} ${venue} and r.registered_at >= now() - interval '30 days' and r.status not in ('CANCELLED')
      ), first_seen as (
        select r.player_id, min(r.registered_at) as first_at from tournament_registrations r where r.organization_id = ${orgId} group by r.player_id
      )
      select count(*) filter (where f.first_at >= now() - interval '30 days')::int as new_players,
             count(*) filter (where f.first_at < now() - interval '30 days')::int as returning_players
      from recent x join first_seen f on f.player_id = x.player_id`);

    // Last 90 days of completed tournaments.
    const [rates] = await this.rows(sql`
      with ts as (
        select t.* from tournaments t
        where t.organization_id = ${orgId} ${venue} and t.status in ('FINISHED','FINALIZED') and t.finished_at >= now() - interval '90 days'
      )
      select
        (select count(*)::int from ts) as tournaments,
        (select round(avg(extract(epoch from (finished_at - started_at)) / 60)::numeric, 1) from ts where started_at is not null) as avg_duration_minutes,
        (select round(100.0 * count(*) filter (where r.status = 'NO_SHOW') / nullif(count(*) filter (where r.status <> 'CANCELLED'), 0), 1)
           from tournament_registrations r where r.tournament_id in (select id from ts)) as no_show_rate,
        (select round(100.0 * count(*) filter (where r.source <> 'WALK_IN' and r.source <> 'STAFF' and r.checked_in_at is not null)
                   / nullif(count(*) filter (where r.source <> 'WALK_IN' and r.source <> 'STAFF' and r.status <> 'CANCELLED'), 0), 1)
           from tournament_registrations r where r.tournament_id in (select id from ts)) as preregistration_conversion,
        (select round(100.0 * count(*) filter (where e.type = 'REENTRY') / nullif(count(*), 0), 1)
           from tournament_entries e where e.tournament_id in (select id from ts) and e.status <> 'VOIDED') as reentry_rate,
        (select round(avg(x.minutes)::numeric, 1) from (
           select extract(epoch from (max(m.created_at) - t.started_at)) / 60 as minutes
           from ts t join seat_movements m on m.tournament_id = t.id and m.reason = 'TABLE_BREAK'
           group by t.id, t.started_at) x) as avg_time_to_final_table_minutes`);

    const [retention] = await this.rows(sql`
      with prev as (
        select distinct player_id from tournament_registrations
        where organization_id = ${orgId} and status in ('PLAYING','ELIMINATED','CHECKED_IN')
          and registered_at >= now() - interval '60 days' and registered_at < now() - interval '30 days'
      ), cur as (
        select distinct player_id from tournament_registrations
        where organization_id = ${orgId} and status in ('PLAYING','ELIMINATED','CHECKED_IN') and registered_at >= now() - interval '30 days'
      )
      select (select count(*)::int from prev) as previous_period_players,
             (select count(*)::int from prev where player_id in (select player_id from cur)) as returned,
             round(100.0 * (select count(*) from prev where player_id in (select player_id from cur)) / nullif((select count(*) from prev), 0), 1) as retention_rate`);

    return { today, newReturning, last90Days: rates, retention30d: retention, generatedAt: this.deps.now().toISOString() };
  }

  async analytics(actor: Actor, range: { from?: string; to?: string } = {}) {
    requirePermission(actor, "analytics.read");
    const orgId = requireOrganization(actor);
    const from = range.from ? new Date(range.from) : new Date(this.deps.now().getTime() - 180 * 86_400_000);
    const to = range.to ? new Date(range.to) : this.deps.now();

    const [checkin] = await this.rows(sql`
      select percentile_cont(0.5) within group (order by m) as median_minutes_before_start,
             percentile_cont(0.9) within group (order by m) as p90_minutes_before_start,
             count(*)::int as samples
      from (
        select extract(epoch from (t.start_at - r.checked_in_at)) / 60 as m
        from tournament_registrations r join tournaments t on t.id = r.tournament_id
        where r.organization_id = ${orgId} and r.checked_in_at is not null and t.start_at between ${from} and ${to}
      ) x`);

    const [registration] = await this.rows(sql`
      select count(*)::int as registrations,
             count(*) filter (where r.status in ('CHECKED_IN','PLAYING','ELIMINATED'))::int as played,
             round(100.0 * count(*) filter (where r.status in ('CHECKED_IN','PLAYING','ELIMINATED')) / nullif(count(*) filter (where r.status <> 'CANCELLED'), 0), 1) as conversion_rate,
             count(*) filter (where r.source in ('TELEGRAM','TELEGRAM_MINI_APP'))::int as via_telegram,
             count(*) filter (where r.source in ('PLAYER_WEB','PLAYER_QR'))::int as via_web,
             count(*) filter (where r.source = 'KIOSK')::int as via_kiosk,
             count(*) filter (where r.source in ('STAFF','WALK_IN'))::int as via_staff
      from tournament_registrations r join tournaments t on t.id = r.tournament_id
      where r.organization_id = ${orgId} and t.start_at between ${from} and ${to}`);

    const [entries] = await this.rows(sql`
      select count(*)::int as entries,
             round(100.0 * count(*) filter (where e.created_at > t.started_at) / nullif(count(*), 0), 1) as late_registration_rate,
             round(100.0 * count(*) filter (where e.type = 'REENTRY') / nullif(count(*), 0), 1) as reentry_rate
      from tournament_entries e join tournaments t on t.id = e.tournament_id
      where e.organization_id = ${orgId} and e.status <> 'VOIDED' and t.start_at between ${from} and ${to}`);

    const [floor] = await this.rows(sql`
      select count(*) filter (where a.type = 'APPLY_BALANCE')::int as balance_actions,
             count(*) filter (where a.type = 'BREAK_TABLE')::int as table_breaks,
             count(*) filter (where a.type = 'UNDO_ACTION')::int as undo_actions
      from operational_actions a join tournaments t on t.id = a.tournament_id
      where a.organization_id = ${orgId} and t.start_at between ${from} and ${to}`);

    const breakTiming = await this.rows(sql`
      select t.id, t.name,
             round(avg(extract(epoch from (m.created_at - t.started_at)) / 60)::numeric, 1) as avg_minutes_after_start,
             count(distinct m.action_id)::int as breaks
      from seat_movements m join tournaments t on t.id = m.tournament_id
      where m.organization_id = ${orgId} and m.reason = 'TABLE_BREAK' and t.start_at between ${from} and ${to}
      group by t.id, t.name order by t.name limit 50`);

    const finalTable = await this.rows(sql`
      select t.id, t.name, round((extract(epoch from (max(m.created_at) - t.started_at)) / 60)::numeric, 1) as minutes_to_final_table
      from tournaments t join seat_movements m on m.tournament_id = t.id and m.reason = 'TABLE_BREAK'
      where t.organization_id = ${orgId} and t.status in ('FINISHED','FINALIZED') and t.start_at between ${from} and ${to}
      group by t.id, t.name, t.started_at order by max(t.start_at) desc limit 50`);

    const venues = await this.rows(sql`
      select v.id, v.name, count(distinct t.id)::int as tournaments,
             round(avg(x.entries)::numeric, 1) as avg_entries
      from venues v left join tournaments t on t.venue_id = v.id and t.start_at between ${from} and ${to} and t.status in ('FINISHED','FINALIZED')
      left join lateral (select count(*) as entries from tournament_entries e where e.tournament_id = t.id and e.status <> 'VOIDED') x on true
      where v.organization_id = ${orgId} group by v.id, v.name order by v.name`);

    const weekdays = await this.rows(sql`
      select extract(isodow from t.start_at)::int as weekday, count(distinct t.id)::int as tournaments,
             round(avg(x.entries)::numeric, 1) as avg_entries
      from tournaments t
      left join lateral (select count(*) as entries from tournament_entries e where e.tournament_id = t.id and e.status <> 'VOIDED') x on true
      where t.organization_id = ${orgId} and t.status in ('FINISHED','FINALIZED') and t.start_at between ${from} and ${to}
      group by 1 order by 1`);

    const cohorts = await this.rows(sql`
      with visits as (
        select r.player_id, date_trunc('month', t.start_at) as month
        from tournament_registrations r join tournaments t on t.id = r.tournament_id
        where r.organization_id = ${orgId} and r.status in ('PLAYING','ELIMINATED','CHECKED_IN')
        group by 1, 2
      ), firsts as (select player_id, min(month) as cohort from visits group by 1)
      select to_char(f.cohort, 'YYYY-MM') as cohort,
             count(distinct f.player_id)::int as players,
             count(distinct v.player_id) filter (where v.month = f.cohort + interval '1 month')::int as month_1,
             count(distinct v.player_id) filter (where v.month = f.cohort + interval '2 months')::int as month_2,
             count(distinct v.player_id) filter (where v.month = f.cohort + interval '3 months')::int as month_3
      from firsts f join visits v on v.player_id = f.player_id
      where f.cohort >= date_trunc('month', ${from}::timestamptz)
      group by f.cohort order by f.cohort`);

    const [telegram] = await this.rows(sql`
      select count(*) filter (where n.status = 'SENT')::int as sent,
             count(*) filter (where n.status = 'EXPIRED')::int as expired,
             count(*) filter (where n.status = 'FAILED')::int as failed,
             (select count(*)::int from tournament_registrations r where r.organization_id = ${orgId}
               and r.source in ('TELEGRAM','TELEGRAM_MINI_APP') and r.registered_at between ${from} and ${to}) as registrations_via_telegram,
             (select count(*)::int from tournament_registrations r where r.organization_id = ${orgId}
               and r.source in ('TELEGRAM','TELEGRAM_MINI_APP') and r.registered_at between ${from} and ${to}
               and exists (select 1 from notifications n2 where n2.player_id = r.player_id and n2.channel = 'TELEGRAM'
                           and n2.type in ('REGISTRATION_OPENING','TOURNAMENT_REMINDER') and n2.status = 'SENT'
                           and n2.sent_at between r.registered_at - interval '24 hours' and r.registered_at)) as registrations_after_notification
      from notifications n where n.organization_id = ${orgId} and n.channel = 'TELEGRAM' and n.created_at between ${from} and ${to}`);

    return { range: { from: from.toISOString(), to: to.toISOString() }, checkin, registration, entries, floor, breakTiming, finalTable, venues, weekdays, cohorts, telegram };
  }

  // --- audit & exports ------------------------------------------------------------------------------

  async audit(actor: Actor, raw: unknown) {
    requirePermission(actor, "audit.read");
    const orgId = requireOrganization(actor);
    const q = AuditQuery.parse(raw);
    return this.deps.db
      .select({ a: auditLogs, actorName: users.displayName })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorId))
      .where(
        and(
          eq(auditLogs.organizationId, orgId),
          q.tournamentId ? eq(auditLogs.tournamentId, q.tournamentId) : undefined,
          q.entityType ? eq(auditLogs.entityType, q.entityType) : undefined,
          q.entityId ? eq(auditLogs.entityId, q.entityId) : undefined,
          q.actorId ? eq(auditLogs.actorId, q.actorId) : undefined,
          q.action ? eq(auditLogs.action, q.action) : undefined,
          q.from ? gte(auditLogs.createdAt, new Date(q.from)) : undefined,
          q.to ? lte(auditLogs.createdAt, new Date(q.to)) : undefined,
        ),
      )
      .orderBy(desc(auditLogs.createdAt))
      .limit(q.limit)
      .offset(q.offset)
      .then((rows) => rows.map(({ a, actorName }) => ({ ...a, actorName })));
  }

  /** CSV exports are audited: they move personal data out of the system (spec §87). */
  async exportPlayers(actor: Actor): Promise<{ filename: string; csv: string }> {
    requirePermission(actor, "player.export");
    const orgId = requireOrganization(actor);
    const rows = await this.deps.db.select().from(players).where(eq(players.organizationId, orgId)).orderBy(asc(players.lastName));
    const csv = Papa.unparse(
      rows.map((p) => ({
        public_id: p.externalPublicId,
        member_number: p.memberNumber ?? "",
        first_name: p.firstName,
        last_name: p.lastName,
        display_name: p.displayName,
        nickname: p.nickname ?? "",
        email: p.email ?? "",
        phone: p.phone ?? "",
        country: p.country ?? "",
        status: p.status,
        marketing_consent: p.marketingConsent ? "yes" : "no",
        created_at: p.createdAt.toISOString(),
      })),
    );
    await this.recordExport(actor, orgId, "PLAYERS_CSV", rows.length);
    return { filename: `players-${this.deps.now().toISOString().slice(0, 10)}.csv`, csv };
  }

  async exportResults(actor: Actor, tournamentId: string): Promise<{ filename: string; csv: string }> {
    requirePermission(actor, "results.read");
    const orgId = requireOrganization(actor);
    const [t] = await this.deps.db.select().from(tournaments).where(and(eq(tournaments.id, tournamentId), eq(tournaments.organizationId, orgId)));
    if (!t) return { filename: "results.csv", csv: "" };
    const rows = await this.deps.db
      .select({ r: tournamentResults, name: players.displayName, publicId: players.externalPublicId })
      .from(tournamentResults)
      .innerJoin(players, eq(players.id, tournamentResults.playerId))
      .where(eq(tournamentResults.tournamentId, tournamentId))
      .orderBy(asc(tournamentResults.position));
    const csv = Papa.unparse(
      rows.map(({ r, name, publicId }) => ({ position: r.position, player: name, public_id: publicId, entries: r.entries, bounties: r.bounties, points: r.points ?? "", status: r.status, revision: r.revision })),
    );
    await this.recordExport(actor, orgId, "RESULTS_CSV", rows.length, { tournamentId });
    return { filename: `results-${t.slug}.csv`, csv };
  }

  private async recordExport(actor: Actor, orgId: string, kind: string, rowCount: number, params: Record<string, unknown> = {}) {
    const now = this.deps.now();
    const [job] = await this.deps.db.insert(exportJobs).values({ organizationId: orgId, kind, status: "COMPLETED", params, rowCount, createdBy: actor.userId, createdAt: now, completedAt: now }).returning();
    await writeAudit(this.deps.db, actor, this.deps.edgeNodeId, { organizationId: orgId, entityType: "export", entityId: job!.id, action: "DATA_EXPORTED", metadata: { kind, rowCount, ...params } }, now);
  }
}
