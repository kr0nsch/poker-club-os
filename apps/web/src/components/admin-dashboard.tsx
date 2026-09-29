"use client";

import { formatClock } from "@pcos/domain";
import type { TournamentSummaryView } from "@pcos/types";
import { cn, Skeleton } from "@pcos/ui";
import { AlertTriangle, BellRing, Check, ChevronRight, Hand, ListOrdered, ServerCrash, UserRoundX } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useTournamentText } from "@/components/player/labels";
import { useLiveClock } from "@/components/player/live-clock";
import { StatusBadge } from "@/components/status";
import { useFormat, useI18n, useT } from "@/lib/i18n";
import { usePublicLive, useTournamentSnapshot } from "@/lib/queries";
import { useServerNow } from "@/lib/realtime-context";

export const LIVE_STATUSES = ["SEATING", "RUNNING", "BREAK", "PAUSED", "HAND_FOR_HAND"];

/** Section heading used across the dashboard: a quiet title with an optional link on the right. */
export function DashSection({ title, action, children, className }: { title: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("grid content-start gap-3", className)}>
      <div className="flex min-h-8 items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A running tournament as the floor sees it: level, clock, blinds and the field. Opens the floor console. */
export function LiveTournamentTile({ tour }: { tour: TournamentSummaryView }) {
  const t = useT();
  const f = useFormat();
  const tt = useTournamentText();
  const live = usePublicLive(tour.id);
  const snap = live.data;
  const v = useLiveClock(snap);
  const d = v.d;
  const pct = d && d.levelDurationMs > 0 ? Math.min(100, (d.elapsedMs / d.levelDurationMs) * 100) : 0;
  const shown = v.isBreak ? v.next : v.level;
  return (
    <Link
      href={`/floor/${tour.id}`}
      className={cn(
        "edge-light group grid gap-4 rounded-xl border bg-card p-5 transition-colors hover:border-border-strong hover:bg-accent/30",
        v.handForHand ? "border-destructive/45" : v.paused ? "border-warning/40" : "border-border",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={tour.status} />
            {v.handForHand && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-destructive">
                <Hand className="size-3.5" /> {t("Hand-for-hand")}
              </span>
            )}
          </div>
          <h3 className="mt-1.5 truncate text-lg font-semibold leading-tight">{tour.name}</h3>
        </div>
        <ChevronRight className="mt-1 size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </div>

      {!snap ? (
        <Skeleton className="h-20" />
      ) : v.notStarted || !d ? (
        <div className="text-sm text-muted-foreground">{t("Seating in progress")}</div>
      ) : (
        <>
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
            <div>
              <div className={cn("text-sm font-semibold", v.paused ? "text-warning" : "text-gold")}>
                {v.paused ? t("Clock paused") : v.isBreak ? t("Break") : t("Level {n}", { n: d.playLevelNumber })}
              </div>
              <div className={cn("clock-digits text-5xl font-semibold leading-none", v.paused && "text-foreground/60")}>{d.formatted}</div>
            </div>
            <div className="ml-auto text-right">
              {v.isBreak && <div className="eyebrow">{t("Next level")}</div>}
              <div className="whitespace-nowrap text-2xl font-semibold tabular-nums">{tt.blinds(shown) || "—"}</div>
              {tt.ante(shown) && <div className="text-sm text-muted-foreground tabular-nums">{tt.ante(shown)}</div>}
            </div>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-muted">
            <div className={cn("h-full w-full origin-left transition-transform duration-1000 ease-linear", v.paused ? "bg-warning" : v.isBreak ? "bg-gold/70" : "bg-gold")} style={{ transform: `scaleX(${pct / 100})` }} />
          </div>
        </>
      )}

      {snap && (
        <dl className="grid grid-cols-3 gap-3 border-t border-border pt-3 text-sm">
          <div>
            <dt className="eyebrow">{t("Remaining")}</dt>
            <dd className="mt-0.5 font-semibold tabular-nums">
              {f.number(snap.stats.remaining)}
              <span className="font-normal text-muted-foreground"> / {f.number(snap.stats.entries)}</span>
            </dd>
          </div>
          <div>
            <dt className="eyebrow">{t("Average stack")}</dt>
            <dd className="mt-0.5 font-semibold tabular-nums">{f.number(snap.stats.averageStack)}</dd>
          </div>
          <div>
            <dt className="eyebrow">{v.isBreak ? t("Play resumes") : t("Break in")}</dt>
            <dd className="mt-0.5 font-semibold tabular-nums">{d ? (v.isBreak ? formatClock(d.remainingMs) : d.msUntilNextBreak != null ? formatClock(d.msUntilNextBreak) : "—") : "—"}</dd>
          </div>
        </dl>
      )}
    </Link>
  );
}

/** Shown in place of the live tiles when nothing is running: the next start with a countdown. */
export function NextStartTile({ tour }: { tour: TournamentSummaryView | undefined }) {
  const t = useT();
  const f = useFormat();
  const tt = useTournamentText();
  const now = useServerNow(1000);
  if (!tour) {
    return (
      <div className="grid place-items-center rounded-xl border border-dashed border-border-strong px-6 py-10 text-center text-sm text-muted-foreground">
        {t("Nothing is running and nothing is scheduled.")}
      </div>
    );
  }
  const until = Date.parse(tour.startAt) - now;
  return (
    <Link href={`/admin/tournaments/${tour.id}`} className="edge-light group grid gap-3 rounded-xl border border-border bg-card p-5 transition-colors hover:border-border-strong hover:bg-accent/30">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-gold">{t("Next start")}</div>
          <h3 className="mt-1 truncate text-lg font-semibold leading-tight">{tour.name}</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {f.dateTime(tour.startAt)} · {tt.buyIn(tour.buyIn)}
          </p>
        </div>
        <ChevronRight className="mt-1 size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </div>
      <div className="clock-digits text-5xl font-semibold leading-none">{until > 0 ? formatClock(until) : t("Soon")}</div>
    </Link>
  );
}

interface AttentionItem {
  key: string;
  tone: "warning" | "destructive" | "default";
  icon: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
  href: string;
}

/** Collects what needs a person for one running tournament: floor calls, unseated players, the waitlist. */
function useTournamentAttention(tour: TournamentSummaryView): AttentionItem[] {
  const t = useT();
  const f = useFormat();
  const snap = useTournamentSnapshot(tour.id).data;
  if (!snap) return [];
  const items: AttentionItem[] = [];
  const href = `/floor/${tour.id}`;
  for (const r of snap.floorRequests.filter((x) => x.status !== "RESOLVED")) {
    items.push({
      key: `fr-${r.id}`,
      tone: "warning",
      icon: <BellRing />,
      title: (
        <>
          {t("Table")} {r.tableNumber}
          {r.seatNumber ? ` · ${t("Seat")} ${r.seatNumber}` : ""}
          <span className="font-normal text-muted-foreground"> · {r.kind === "BUST_REPORT" ? t("Bust reported") : r.message || t("Floor called to the table")}</span>
        </>
      ),
      detail: `${tour.name} · ${f.time(r.createdAt)}`,
      href,
    });
  }
  const unseated = snap.entries.filter((e) => e.status === "ACTIVE" && !e.tableId).length;
  if (unseated > 0) items.push({ key: "unseated", tone: "warning", icon: <UserRoundX />, title: t("{n} without a seat", { n: unseated }), detail: tour.name, href });
  const waitlisted = snap.registrations.filter((r) => r.status === "WAITLISTED").length;
  if (waitlisted > 0) items.push({ key: "waitlist", tone: "default", icon: <ListOrdered />, title: t("{n} on the waitlist", { n: waitlisted }), detail: tour.name, href });
  return items;
}

function TournamentAttention({ tour }: { tour: TournamentSummaryView }) {
  return <AttentionRows items={useTournamentAttention(tour)} />;
}

function AttentionRows({ items }: { items: AttentionItem[] }) {
  return (
    <>
      {items.map((i) => (
        <li key={i.key}>
          <Link href={i.href} className="group flex items-start gap-3 px-4 py-3 transition-colors hover:bg-accent/40">
            <span className={cn("mt-0.5 shrink-0 [&_svg]:size-4", i.tone === "warning" ? "text-warning" : i.tone === "destructive" ? "text-destructive" : "text-muted-foreground")}>{i.icon}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium leading-snug">{i.title}</span>
              {i.detail && <span className="block truncate text-xs text-muted-foreground">{i.detail}</span>}
            </span>
            <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </li>
      ))}
    </>
  );
}

/**
 * Everything that needs a person right now, across running tournaments and the edge server.
 * An empty list is a calm, explicit "all quiet" rather than a blank card.
 */
export function AttentionList({ live, problems }: { live: TournamentSummaryView[]; problems: { name: string; label: string; state: string }[] }) {
  const t = useT();
  const serverItems: AttentionItem[] = problems.map((p) => ({
    key: `h-${p.name}`,
    tone: p.state === "DOWN" ? "destructive" : "warning",
    icon: p.state === "DOWN" ? <ServerCrash /> : <AlertTriangle />,
    title: p.label,
    detail: p.state === "DOWN" ? t("Down") : t("Degraded"),
    href: "/admin/health",
  }));
  return (
    <div className="edge-light overflow-hidden rounded-xl border border-border bg-card">
      <ul className="divide-y divide-border/70 [&:not(:has(li))]:hidden">
        {live.map((x) => (
          <TournamentAttention key={x.id} tour={x} />
        ))}
        <AttentionRows items={serverItems} />
      </ul>
      {/* Shown only when the list above rendered no rows. */}
      <div className="hidden items-center gap-3 px-4 py-5 text-sm [ul:not(:has(li))+&]:flex">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-success/12 text-success">
          <Check className="size-4" />
        </span>
        <span>
          <span className="block font-medium">{t("All quiet")}</span>
          <span className="block text-muted-foreground">{t("No floor calls, waitlists or server problems.")}</span>
        </span>
      </div>
    </div>
  );
}

/** Today's figures in one strip, divided by hairlines instead of four separate cards. */
export function TodayStrip({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <div className="edge-light grid grid-cols-2 overflow-hidden rounded-xl border border-border bg-card sm:grid-cols-4">
      {items.map((i, n) => (
        <div key={i.label} className={cn("px-5 py-4", n % 2 === 1 && "border-l border-border", n >= 2 && "max-sm:border-t sm:border-l")}>
          <div className="eyebrow">{i.label}</div>
          <div className="mt-1 text-3xl font-semibold tabular-nums tracking-tight">{i.value}</div>
        </div>
      ))}
    </div>
  );
}

/** Upcoming tournaments grouped by day, with how full each one is. */
export function Schedule({ tournaments, href = (x) => `/admin/tournaments/${x.id}` }: { tournaments: TournamentSummaryView[]; href?: (x: TournamentSummaryView) => string }) {
  const t = useT();
  const f = useFormat();
  const { locale } = useI18n();
  const dayLabel = (iso: string) => new Date(iso).toLocaleDateString(locale === "ru" ? "ru-RU" : "en-GB", { weekday: "long", day: "numeric", month: "long" });
  const tt = useTournamentText();
  const dayKey = (iso: string) => new Date(iso).toDateString();
  const today = new Date().toDateString();
  const tomorrow = new Date(Date.now() + 86_400_000).toDateString();
  const groups = new Map<string, TournamentSummaryView[]>();
  for (const x of [...tournaments].sort((a, b) => a.startAt.localeCompare(b.startAt))) {
    const k = dayKey(x.startAt);
    groups.set(k, [...(groups.get(k) ?? []), x]);
  }
  if (groups.size === 0) {
    return <div className="rounded-xl border border-dashed border-border-strong px-6 py-8 text-center text-sm text-muted-foreground">{t("No active or upcoming tournaments.")}</div>;
  }
  return (
    <div className="edge-light overflow-hidden rounded-xl border border-border bg-card">
      {[...groups.entries()].map(([k, list]) => (
        <div key={k}>
          <div className="border-b border-border bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground first-letter:uppercase">
            {k === today ? t("Today") : k === tomorrow ? t("Tomorrow") : dayLabel(list[0]!.startAt)}
          </div>
          <ul className="divide-y divide-border/70">
            {list.map((x) => {
              const fill = x.maxPlayers ? Math.min(1, x.registrationCount / x.maxPlayers) : null;
              return (
                <li key={x.id}>
                  <Link href={href(x)} className="group grid grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-3 transition-colors hover:bg-accent/40 sm:grid-cols-[3.5rem_minmax(0,1fr)_10.5rem_auto]">
                    <span className="text-sm font-semibold tabular-nums">{f.time(x.startAt)}</span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{x.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {tt.buyIn(x.buyIn)} · {tt.format(x.format)}
                      </span>
                    </span>
                    <span className="min-w-0 max-sm:hidden">
                      <span className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
                        <span className="truncate">{t("Registered")}</span>
                        <span className="shrink-0 whitespace-nowrap font-medium text-foreground tabular-nums">
                          {x.registrationCount}
                          {x.maxPlayers ? ` / ${x.maxPlayers}` : ""}
                        </span>
                      </span>
                      {fill != null && (
                        <span className="mt-1 block h-1 overflow-hidden rounded-full bg-muted">
                          <span className={cn("block h-full w-full origin-left", fill >= 1 ? "bg-warning" : "bg-gold/80")} style={{ transform: `scaleX(${fill})` }} />
                        </span>
                      )}
                    </span>
                    <span className="flex items-center gap-2">
                      <StatusBadge status={x.status} />
                      <ChevronRight className="size-4 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5" />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** Label/value rows for slower-moving club figures; missing data is a quiet dash, not an empty card. */
export function MetricList({ rows }: { rows: { label: string; value: string; hint?: string }[] }) {
  return (
    <dl className="edge-light divide-y divide-border/70 overflow-hidden rounded-xl border border-border bg-card text-sm">
      {rows.map((r) => (
        <div key={r.label} className="flex items-baseline justify-between gap-4 px-4 py-2.5">
          <dt className="min-w-0 text-foreground/80">
            {r.label}
            {r.hint && <span className="block text-xs text-muted-foreground">{r.hint}</span>}
          </dt>
          <dd className={cn("shrink-0 font-semibold tabular-nums", r.value === "—" && "font-normal text-muted-foreground")}>{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}
