"use client";

import { Button, Card, CardContent, CardHeader, CardTitle, PageHeader, Skeleton, Stat } from "@pcos/ui";
import { useSysLabels } from "@/components/admin-system/labels";
import { StateBadge } from "@/components/admin-system/ui";
import type { TournamentSummaryView } from "@pcos/types";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Tablet } from "lucide-react";
import Link from "next/link";
import { useCan, useStaff } from "@/components/staff-guard";
import { StatusBadge } from "@/components/status";
import { get } from "@/lib/api";
import { useFormat, useT } from "@/lib/i18n";

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

export default function AdminDashboard() {
  const t = useT();
  const fmt = useFormat();
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

  return (
    <div>
      <PageHeader
        title={t("Welcome, {name}", { name: me.user?.displayName ?? "" })}
        description={me.organization?.name}
        actions={
          <Button asChild size="lg">
            <Link href="/floor">
              <Tablet /> {t("Floor control")}
            </Link>
          </Button>
        }
      />
      {can("analytics.read") && (
        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label={t("Registrations today")} value={d ? fmt.number(d.today.registrations_today) : <Skeleton className="h-7 w-12" />} />
          <Stat label={t("Checked in today")} value={d ? fmt.number(d.today.checked_in_today) : <Skeleton className="h-7 w-12" />} />
          <Stat label={t("Active tournaments")} value={d ? fmt.number(d.today.active_tournaments) : <Skeleton className="h-7 w-12" />} />
          <Stat label={t("New / returning (30 days)")} value={d ? `${d.newReturning.new_players} / ${d.newReturning.returning_players}` : <Skeleton className="h-7 w-16" />} />
          <Stat label={t("Pre-registration conversion")} value={pct(d?.last90Days.preregistration_conversion)} hint={t("last 90 days")} />
          <Stat label={t("No-show rate")} value={pct(d?.last90Days.no_show_rate)} hint={t("last 90 days")} />
          <Stat label={t("Re-entry rate")} value={pct(d?.last90Days.reentry_rate)} hint={t("last 90 days")} />
          <Stat label={t("Retention (30 days)")} value={pct(d?.retention30d.retention_rate)} hint={d ? t("{n} of {m} players returned", { n: d.retention30d.returned, m: d.retention30d.previous_period_players }) : undefined} />
          <Stat label={t("Average duration")} value={d?.last90Days.avg_duration_minutes != null ? `${Math.round(d.last90Days.avg_duration_minutes)} ${t("min")}` : "—"} hint={t("last 90 days")} />
          <Stat label={t("Time to final table")} value={d?.last90Days.avg_time_to_final_table_minutes != null ? `${Math.round(d.last90Days.avg_time_to_final_table_minutes)} ${t("min")}` : "—"} hint={t("last 90 days")} />
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>{t("Today and upcoming")}</CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link href="/admin/tournaments">
                {t("All tournaments")} <ArrowRight />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="grid gap-2">
            {active.isLoading && <Skeleton className="h-16" />}
            {active.data?.length === 0 && <p className="text-sm text-muted-foreground">{t("No active or upcoming tournaments.")}</p>}
            {active.data?.map((x) => (
              <Link key={x.id} href={`/floor/${x.id}`} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 hover:bg-accent">
                <div className="min-w-0">
                  <div className="truncate font-medium">{x.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {fmt.dateTime(x.startAt)} · {x.registrationCount}
                    {x.maxPlayers ? `/${x.maxPlayers}` : ""} {t("registered")}
                  </div>
                </div>
                <StatusBadge status={x.status} />
              </Link>
            ))}
          </CardContent>
        </Card>
        {can("edge.read") && (
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>{t("Edge server")}</CardTitle>
              {health.data && <StateBadge state={health.data.overall} />}
            </CardHeader>
            <CardContent className="grid gap-0 text-sm">
              {health.data?.components.map((c) => (
                <div key={c.name} className="flex items-center justify-between gap-2 border-b border-border/60 py-1.5 last:border-0">
                  <span className="text-foreground/85">{L.component[c.name] ?? c.name}</span>
                  <StateBadge state={c.state} />
                </div>
              ))}
              <Button asChild variant="outline" size="sm" className="mt-2">
                <Link href="/admin/health">{t("Details")}</Link>
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
