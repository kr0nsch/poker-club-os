"use client";

import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, Field, Input, PageHeader, Stat, Table, TBody, Td, Th, THead, Tr, cn } from "@pcos/ui";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { BarChart3, CalendarRange, Clock, Filter, Layers, MapPin, Send, Timer, TrendingUp, Users } from "lucide-react";
import { useState, type ReactNode } from "react";
import { sysKeys } from "@/components/admin-system/queries";
import type { AnalyticsView } from "@/components/admin-system/types";
import { Bar, ErrorState, NoAccess, RowsSkeleton, num, useLocaleTag } from "@/components/admin-system/ui";
import { useCan } from "@/components/staff-guard";
import { get, qs } from "@/lib/api";
import { useFormat, useT } from "@/lib/i18n";

/** Local calendar date as YYYY-MM-DD. */
function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return ymd(d);
}

/** Operational analytics (spec §71-72). Charts are plain CSS bars — no chart library. */
export default function AnalyticsPage() {
  const t = useT();
  const can = useCan();
  return can("analytics.read") ? (
    <AnalyticsContent />
  ) : (
    <div className="grid gap-6">
      <PageHeader className="mb-0" title={t("Analytics")} />
      <NoAccess permission="analytics.read" />
    </div>
  );
}

function AnalyticsContent() {
  const t = useT();
  const fmt = useFormat();
  const [draft, setDraft] = useState({ from: daysAgo(180), to: ymd(new Date()) });
  const [range, setRange] = useState(draft);
  // whole local days: from 00:00 to 23:59:59.999
  const params = { from: new Date(`${range.from}T00:00:00`).toISOString(), to: new Date(`${range.to}T23:59:59.999`).toISOString() };
  const q = useQuery({
    queryKey: sysKeys.analytics(params.from, params.to),
    queryFn: () => get<AnalyticsView>(`/api/v1/reports/analytics${qs(params)}`),
    placeholderData: keepPreviousData,
  });
  const invalid = !draft.from || !draft.to || draft.from > draft.to;
  const preset = (days: number) => {
    const next = { from: daysAgo(days), to: ymd(new Date()) };
    setDraft(next);
    setRange(next);
  };
  const d = q.data;

  return (
    <div className="grid gap-6">
      <PageHeader
        className="mb-0"
        title={t("Analytics")}
        description={d ? t("Tournaments starting {from} – {to}", { from: fmt.date(d.range.from), to: fmt.date(d.range.to) }) : t("How the club's tournaments run: registration, check-in, floor work and retention.")}
      />
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-5">
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!invalid) setRange(draft);
            }}
          >
            <Field label={t("From")}>
              <Input type="date" value={draft.from} max={draft.to || undefined} onChange={(e) => setDraft({ ...draft, from: e.target.value })} className="w-44" />
            </Field>
            <Field label={t("To")}>
              <Input type="date" value={draft.to} min={draft.from || undefined} onChange={(e) => setDraft({ ...draft, to: e.target.value })} className="w-44" />
            </Field>
            <Button type="submit" disabled={invalid} loading={q.isFetching}>
              <Filter /> {t("Apply")}
            </Button>
          </form>
          <div className="flex flex-wrap gap-1.5">
            {[
              [30, t("30 days")],
              [90, t("90 days")],
              [180, t("180 days")],
              [365, t("1 year")],
            ].map(([n, label]) => (
              <Button key={n} type="button" size="sm" variant="ghost" onClick={() => preset(n as number)}>
                <CalendarRange /> {label}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {q.isLoading ? (
        <RowsSkeleton rows={8} />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : d ? (
        <div className={cn("grid gap-6 transition-opacity", q.isPlaceholderData && "opacity-60")}>
          <Report d={d} />
        </div>
      ) : null}
    </div>
  );
}

const fmtPct = (v: number | null, tag: string) => (v == null ? "—" : `${v.toLocaleString(tag, { maximumFractionDigits: 1 })}%`);

function Section({ icon: Icon, title, description, children, className }: { icon: typeof Clock; title: string; description?: string; children: ReactNode; className?: string }) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon className="size-4 text-primary" /> {title}
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function BarRow({ label, value, max, display, tone }: { label: ReactNode; value: number; max: number; display?: ReactNode; tone?: "primary" | "warning" | "destructive" | "muted" | "gold" }) {
  return (
    <div className="grid grid-cols-[minmax(6rem,11rem)_1fr_auto] items-center gap-3 text-sm">
      <span className="truncate text-muted-foreground">{label}</span>
      <Bar value={value} max={max} tone={tone} className="h-2.5" />
      <span className="min-w-12 text-right font-medium tabular-nums">{display ?? value}</span>
    </div>
  );
}

function Report({ d }: { d: AnalyticsView }) {
  const t = useT();
  const fmt = useFormat();
  const tag = useLocaleTag();
  const pct = (v: number | null) => fmtPct(v, tag);
  const minutes = (v: number | null) => {
    if (v == null) return "—";
    const abs = Math.abs(Math.round(v));
    const text = abs < 60 ? t("{m} min", { m: abs }) : t("{h} h {m} min", { h: Math.floor(abs / 60), m: abs % 60 });
    return v < 0 ? `−${text}` : text;
  };

  const reg = d.registration;
  const sources = reg
    ? [
        { label: t("Web and QR"), value: reg.via_web },
        { label: "Telegram", value: reg.via_telegram },
        { label: t("Kiosk"), value: reg.via_kiosk },
        { label: t("Staff and walk-in"), value: reg.via_staff },
      ]
    : [];
  const maxSource = Math.max(1, ...sources.map((s) => s.value));
  const median = num(d.checkin?.median_minutes_before_start);
  const p90 = num(d.checkin?.p90_minutes_before_start);
  const late = num(d.entries?.late_registration_rate);
  const reentry = num(d.entries?.reentry_rate);
  const conversion = num(reg?.conversion_rate);

  // ISO weekday 1 = Monday … 7 = Sunday; 2024-01-01 was a Monday.
  const weekdayName = (n: number) => new Date(Date.UTC(2024, 0, n)).toLocaleDateString(tag, { weekday: "long", timeZone: "UTC" });
  const weekdays = Array.from({ length: 7 }, (_, i) => {
    const row = d.weekdays.find((w) => w.weekday === i + 1);
    return { weekday: i + 1, tournaments: row?.tournaments ?? 0, avg: num(row?.avg_entries) ?? 0 };
  });
  const maxWeekday = Math.max(1, ...weekdays.map((w) => w.avg));
  const maxVenue = Math.max(1, ...d.venues.map((v) => num(v.avg_entries) ?? 0));
  const cohortLabel = (c: string) => {
    const [y, m] = c.split("-").map(Number);
    return y && m ? new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(tag, { month: "short", year: "numeric", timeZone: "UTC" }) : c;
  };
  const tg = d.telegram;
  const tgMax = Math.max(1, tg?.sent ?? 0, tg?.expired ?? 0, tg?.failed ?? 0);

  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label={t("Registrations")} value={fmt.number(reg?.registrations ?? 0)} />
        <Stat label={t("Played")} value={fmt.number(reg?.played ?? 0)} hint={t("Conversion {p}", { p: pct(conversion) })} />
        <Stat label={t("Entries")} value={fmt.number(d.entries?.entries ?? 0)} />
        <Stat label={t("Late registration")} value={pct(late)} hint={t("of entries after the start")} />
        <Stat label={t("Re-entry rate")} value={pct(reentry)} />
        <Stat label={t("Check-in (median)")} value={minutes(median)} hint={t("before the start")} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section icon={Clock} title={t("Check-in timing")} description={t("How long before the start players check in. Negative values mean after the start.")}>
          {d.checkin && d.checkin.samples > 0 ? (
            <div className="grid gap-3">
              <BarRow label={t("Median")} value={Math.max(0, median ?? 0)} max={Math.max(1, p90 ?? 0, median ?? 0)} display={minutes(median)} />
              <BarRow label={t("90th percentile")} value={Math.max(0, p90 ?? 0)} max={Math.max(1, p90 ?? 0, median ?? 0)} display={minutes(p90)} tone="gold" />
              <p className="text-xs text-muted-foreground">{t("Based on {n} check-ins. 90% of players check in no earlier than the 90th percentile value.", { n: fmt.number(d.checkin.samples) })}</p>
            </div>
          ) : (
            <Empty />
          )}
        </Section>

        <Section icon={Users} title={t("Registration funnel and sources")}>
          {reg && reg.registrations > 0 ? (
            <div className="grid gap-4">
              <div className="grid gap-2">
                <BarRow label={t("Registered")} value={reg.registrations} max={reg.registrations} display={fmt.number(reg.registrations)} />
                <BarRow label={t("Played")} value={reg.played} max={reg.registrations} display={`${fmt.number(reg.played)} · ${pct(conversion)}`} tone="gold" />
              </div>
              <div className="grid gap-2">
                <div className="eyebrow">{t("Sources")}</div>
                {sources.map((s) => (
                  <BarRow key={s.label} label={s.label} value={s.value} max={maxSource} display={fmt.number(s.value)} />
                ))}
              </div>
            </div>
          ) : (
            <Empty />
          )}
        </Section>

        <Section icon={TrendingUp} title={t("Late registration and re-entries")}>
          {d.entries && d.entries.entries > 0 ? (
            <div className="grid gap-3">
              <BarRow label={t("Late registration")} value={late ?? 0} max={100} display={pct(late)} />
              <BarRow label={t("Re-entries")} value={reentry ?? 0} max={100} display={pct(reentry)} tone="gold" />
              <p className="text-xs text-muted-foreground">{t("Share of {n} entries (voided entries excluded).", { n: fmt.number(d.entries.entries) })}</p>
            </div>
          ) : (
            <Empty />
          )}
        </Section>

        <Section icon={Layers} title={t("Floor actions")}>
          {d.floor ? (
            <div className="grid grid-cols-3 gap-3">
              <MiniStat label={t("Balancing moves")} value={fmt.number(d.floor.balance_actions)} />
              <MiniStat label={t("Table breaks")} value={fmt.number(d.floor.table_breaks)} />
              <MiniStat label={t("Undos")} value={fmt.number(d.floor.undo_actions)} />
            </div>
          ) : (
            <Empty />
          )}
        </Section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section icon={Timer} title={t("Table break timing")} description={t("Average time after the start at which tables were broken.")}>
          {d.breakTiming.length === 0 ? (
            <Empty />
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th>{t("Tournament")}</Th>
                  <Th className="text-right">{t("Breaks")}</Th>
                  <Th className="text-right">{t("Avg. after start")}</Th>
                </Tr>
              </THead>
              <TBody>
                {d.breakTiming.map((r) => (
                  <Tr key={r.id}>
                    <Td className="max-w-64 truncate">{r.name}</Td>
                    <Td className="text-right tabular-nums">{r.breaks}</Td>
                    <Td className="text-right tabular-nums">{minutes(num(r.avg_minutes_after_start))}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Section>

        <Section icon={Timer} title={t("Time to final table")} description={t("From the start until the last table break of finished tournaments.")}>
          {d.finalTable.length === 0 ? (
            <Empty />
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th>{t("Tournament")}</Th>
                  <Th className="text-right">{t("Time")}</Th>
                </Tr>
              </THead>
              <TBody>
                {d.finalTable.map((r) => (
                  <Tr key={r.id}>
                    <Td className="max-w-64 truncate">{r.name}</Td>
                    <Td className="text-right tabular-nums">{minutes(num(r.minutes_to_final_table))}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Section>

        <Section icon={MapPin} title={t("Venue performance")} description={t("Finished tournaments in the period.")}>
          {d.venues.length === 0 ? (
            <Empty />
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th>{t("Venue")}</Th>
                  <Th className="text-right">{t("Tournaments")}</Th>
                  <Th>{t("Avg. entries")}</Th>
                </Tr>
              </THead>
              <TBody>
                {d.venues.map((v) => {
                  const avg = num(v.avg_entries);
                  return (
                    <Tr key={v.id}>
                      <Td>{v.name}</Td>
                      <Td className="text-right tabular-nums">{v.tournaments}</Td>
                      <Td>
                        <div className="flex items-center gap-2">
                          <Bar value={avg ?? 0} max={maxVenue} className="w-24" />
                          <span className="tabular-nums">{v.tournaments > 0 && avg != null ? fmt.number(avg) : "—"}</span>
                        </div>
                      </Td>
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
          )}
        </Section>

        <Section icon={BarChart3} title={t("Weekday performance")} description={t("Average entries of finished tournaments by weekday of the start.")}>
          <div className="grid gap-2">
            {weekdays.map((w) => (
              <BarRow
                key={w.weekday}
                label={<span className="capitalize">{weekdayName(w.weekday)}</span>}
                value={w.avg}
                max={maxWeekday}
                display={
                  w.tournaments > 0 ? (
                    <span>
                      {fmt.number(w.avg)} <span className="text-xs font-normal text-muted-foreground">({t("{n} tourn.", { n: w.tournaments })})</span>
                    </span>
                  ) : (
                    "—"
                  )
                }
              />
            ))}
          </div>
        </Section>
      </div>

      <Section icon={Users} title={t("Retention cohorts")} description={t("Players grouped by the month of their first played tournament, and how many played again in the following months.")}>
        {d.cohorts.length === 0 ? (
          <Empty />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("First month")}</Th>
                <Th className="text-right">{t("Players")}</Th>
                <Th className="text-center">{t("Month +1")}</Th>
                <Th className="text-center">{t("Month +2")}</Th>
                <Th className="text-center">{t("Month +3")}</Th>
              </Tr>
            </THead>
            <TBody>
              {d.cohorts.map((c) => (
                <Tr key={c.cohort}>
                  <Td className="capitalize">{cohortLabel(c.cohort)}</Td>
                  <Td className="text-right tabular-nums">{fmt.number(c.players)}</Td>
                  {[c.month_1, c.month_2, c.month_3].map((n, i) => {
                    const share = c.players > 0 ? (n / c.players) * 100 : 0;
                    return (
                      <Td
                        key={i}
                        className="text-center tabular-nums"
                        // shade by share retained
                        style={{ backgroundColor: share > 0 ? `color-mix(in oklab, var(--primary) ${Math.round(10 + share * 0.6)}%, transparent)` : undefined }}
                        title={t("{n} of {m} players", { n, m: c.players })}
                      >
                        {pct(share)}
                        <span className="ml-1 text-xs text-foreground/60">({n})</span>
                      </Td>
                    );
                  })}
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Section>

      <Section icon={Send} title="Telegram" description={t("Messages sent through the bot in the period and registrations that came from Telegram.")}>
        {tg ? (
          <div className="grid gap-6 md:grid-cols-2">
            <div className="grid content-start gap-2">
              <BarRow label={t("Sent")} value={tg.sent} max={tgMax} display={fmt.number(tg.sent)} />
              <BarRow label={t("Expired")} value={tg.expired} max={tgMax} display={fmt.number(tg.expired)} tone="muted" />
              <BarRow label={t("Failed")} value={tg.failed} max={tgMax} display={fmt.number(tg.failed)} tone="destructive" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <MiniStat label={t("Registrations via Telegram")} value={fmt.number(tg.registrations_via_telegram)} />
              <MiniStat
                label={t("Within 24 h after a notification")}
                value={fmt.number(tg.registrations_after_notification)}
                hint={tg.registrations_via_telegram > 0 ? pct((tg.registrations_after_notification / tg.registrations_via_telegram) * 100) : undefined}
              />
            </div>
          </div>
        ) : (
          <Empty />
        )}
      </Section>
    </>
  );
}

function MiniStat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

function Empty() {
  const t = useT();
  return <EmptyState title={t("No data in this period")} className="p-6" />;
}
