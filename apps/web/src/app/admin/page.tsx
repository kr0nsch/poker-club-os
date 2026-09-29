"use client";

import { Button, Skeleton } from "@pcos/ui";
import type { TournamentSummaryView } from "@pcos/types";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Plus, Tablet } from "lucide-react";
import Link from "next/link";
import { AttentionList, DashSection, LIVE_STATUSES, LiveTournamentTile, MetricList, NextStartTile, Schedule, TodayStrip } from "@/components/admin-dashboard";
import { useSysLabels } from "@/components/admin-system/labels";
import { StateBadge } from "@/components/admin-system/ui";
import { useCan, useStaff } from "@/components/staff-guard";
import { get } from "@/lib/api";
import { useFormat, useI18n, useT } from "@/lib/i18n";

interface Dashboard {
  today: { registrations_today: number; checked_in_today: number; active_tournaments: number; tournaments_today: number };
  newReturning: { new_players: number; returning_players: number };
  last90Days: {
    tournaments: number;
    avg_duration_minutes: number | null;
    no_show_rate: number | null;
    preregistration_conversion: number | null;
    reentry_rate: number | null;
    avg_time_to_final_table_minutes: number | null;
  };
  retention30d: { previous_period_players: number; returned: number; retention_rate: number | null };
}

interface Health {
  overall: string;
  components: { name: string; state: string; detail?: string }[];
}

const pct = (v: number | null | undefined) => (v == null ? "—" : `${Number(v).toFixed(1)}%`);

function greeting(hour: number) {
  if (hour < 5) return "Good night, {name}";
  if (hour < 12) return "Good morning, {name}";
  if (hour < 18) return "Good afternoon, {name}";
  return "Good evening, {name}";
}

/**
 * Operations first: what is in play and what needs a person sit at the top; today's figures,
 * the schedule and slower club metrics follow.
 */
export default function AdminDashboard() {
  const t = useT();
  const f = useFormat();
  const { locale } = useI18n();
  const me = useStaff();
  const can = useCan();
  const L = useSysLabels();
  const dashboard = useQuery({ queryKey: ["dashboard"], queryFn: () => get<Dashboard>("/api/v1/reports/dashboard"), enabled: can("analytics.read"), refetchInterval: 30_000 });
  const active = useQuery({
    queryKey: ["tournaments", "active"],
    queryFn: () => get<TournamentSummaryView[]>("/api/v1/tournaments?status=REGISTRATION_OPEN,SEATING,RUNNING,BREAK,PAUSED,HAND_FOR_HAND,SCHEDULED&limit=20"),
    refetchInterval: 15_000,
  });
  const health = useQuery({ queryKey: ["edge-health"], queryFn: () => get<Health>("/api/v1/edge/health"), enabled: can("edge.read"), refetchInterval: 30_000 });
  const d = dashboard.data;
  const list = active.data ?? [];
  const live = list.filter((x) => LIVE_STATUSES.includes(x.status));
  const upcoming = list.filter((x) => !LIVE_STATUSES.includes(x.status));
  const nextUp = [...upcoming].sort((a, b) => a.startAt.localeCompare(b.startAt))[0];
  const components = health.data?.components ?? [];
  const problems = components.filter((c) => c.state === "DOWN" || c.state === "DEGRADED").map((c) => ({ name: c.name, state: c.state, label: L.component[c.name] ?? c.name }));
  const okCount = components.filter((c) => c.state === "OK").length;
  const now = new Date();
  const firstName = me.user?.displayName?.split(" ")[0] ?? "";
  const n = (v: number | undefined) => (v == null ? <Skeleton className="h-8 w-12" /> : f.number(v));

  return (
    <div className="grid gap-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground first-letter:uppercase">
            {now.toLocaleDateString(locale === "ru" ? "ru-RU" : "en-GB", { weekday: "long", day: "numeric", month: "long" })}
            {me.organization?.name && <> · {me.organization.name}</>}
          </p>
          <h1 className="mt-1 text-[28px] font-semibold leading-tight">{t(greeting(now.getHours()), { name: firstName })}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {can("tournament.create") && (
            <Button asChild variant="outline" size="lg">
              <Link href="/admin/tournaments/new">
                <Plus /> {t("New tournament")}
              </Link>
            </Button>
          )}
          <Button asChild size="lg">
            <Link href="/floor">
              <Tablet /> {t("Floor control")}
            </Link>
          </Button>
        </div>
      </header>

      <div className="grid gap-x-6 gap-y-8 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <DashSection title={live.length > 0 ? t("In play now") : t("Nothing in play right now")}>
          {active.isLoading ? (
            <Skeleton className="h-56 rounded-xl" />
          ) : live.length > 0 ? (
            <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(100%,24rem),1fr))]">
              {live.map((x) => (
                <LiveTournamentTile key={x.id} tour={x} />
              ))}
            </div>
          ) : (
            <NextStartTile tour={nextUp} />
          )}
        </DashSection>
        <DashSection title={t("Needs attention")}>
          <AttentionList live={live} problems={problems} />
        </DashSection>
      </div>

      {can("analytics.read") && (
        <DashSection title={t("Today")}>
          <TodayStrip
            items={[
              { label: t("Registrations today"), value: n(d?.today.registrations_today) },
              { label: t("Checked in today"), value: n(d?.today.checked_in_today) },
              { label: t("Tournaments today"), value: n(d?.today.tournaments_today) },
              { label: t("Active tournaments"), value: n(d?.today.active_tournaments) },
            ]}
          />
        </DashSection>
      )}

      <div className="grid gap-x-6 gap-y-8 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <DashSection
          title={t("Schedule")}
          action={
            <Button asChild variant="ghost" size="sm">
              <Link href="/admin/tournaments">
                {t("All tournaments")} <ArrowRight />
              </Link>
            </Button>
          }
        >
          {active.isLoading ? <Skeleton className="h-40 rounded-xl" /> : <Schedule tournaments={upcoming} />}
        </DashSection>

        <div className="grid content-start gap-8">
          {can("analytics.read") && (
            <DashSection title={t("Club, last 90 days")}>
              <MetricList
                rows={[
                  { label: t("Tournaments played"), value: d ? f.number(d.last90Days.tournaments) : "—" },
                  { label: t("Average duration"), value: d?.last90Days.avg_duration_minutes != null ? `${Math.round(d.last90Days.avg_duration_minutes)} ${t("min")}` : "—" },
                  { label: t("Time to final table"), value: d?.last90Days.avg_time_to_final_table_minutes != null ? `${Math.round(d.last90Days.avg_time_to_final_table_minutes)} ${t("min")}` : "—" },
                  { label: t("Pre-registration conversion"), value: pct(d?.last90Days.preregistration_conversion) },
                  { label: t("No-show rate"), value: pct(d?.last90Days.no_show_rate) },
                  { label: t("Re-entry rate"), value: pct(d?.last90Days.reentry_rate) },
                  { label: t("New / returning (30 days)"), value: d ? `${f.number(d.newReturning.new_players)} / ${f.number(d.newReturning.returning_players)}` : "—" },
                  {
                    label: t("Retention (30 days)"),
                    value: pct(d?.retention30d.retention_rate),
                    hint: d && d.retention30d.previous_period_players > 0 ? t("{n} of {m} players returned", { n: d.retention30d.returned, m: d.retention30d.previous_period_players }) : undefined,
                  },
                ]}
              />
            </DashSection>
          )}
          {can("edge.read") && (
            <DashSection
              title={t("Edge server")}
              action={
                <Button asChild variant="ghost" size="sm">
                  <Link href="/admin/health">
                    {t("Details")} <ArrowRight />
                  </Link>
                </Button>
              }
            >
              <div className="edge-light flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm">
                <span className="text-foreground/85">{health.data ? t("{ok} of {total} components OK", { ok: okCount, total: components.length }) : <Skeleton className="h-4 w-40" />}</span>
                {health.data && <StateBadge state={health.data.overall} />}
              </div>
            </DashSection>
          )}
        </div>
      </div>
    </div>
  );
}
