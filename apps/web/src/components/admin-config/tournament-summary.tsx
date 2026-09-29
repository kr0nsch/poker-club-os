"use client";

import type { TournamentSnapshot } from "@pcos/types";
import { cn } from "@pcos/ui";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { blindsLabel, useDerivedClock } from "@/lib/clock";
import { useFormat, useT } from "@/lib/i18n";
import { isClosedStatus, isStartedStatus } from "./tournament-form";
import { formatDuration } from "./utils";

interface Figure {
  label: string;
  value: ReactNode;
  hint?: string;
}

/** The tournament's key figures, in the order the floor reads them. */
function useFigures(s: TournamentSnapshot): Figure[] {
  const t = useT();
  const fmt = useFormat();
  const tt = s.tournament;
  const st = s.stats;
  const started = isStartedStatus(tt.status) || isClosedStatus(tt.status);
  const figures: Figure[] = [
    {
      label: t("Registered"),
      value: (
        <>
          {fmt.number(st.registrations)}
          {tt.maxPlayers ? <span className="font-normal text-muted-foreground"> / {fmt.number(tt.maxPlayers)}</span> : null}
        </>
      ),
      hint: st.waitlisted > 0 ? t("{n} on the waitlist", { n: st.waitlisted }) : undefined,
    },
    { label: t("Checked in"), value: fmt.number(st.checkedIn) },
    { label: t("Entries"), value: fmt.number(st.entries), hint: st.reentries > 0 ? t("{n} re-entries", { n: st.reentries }) : undefined },
  ];
  if (started) figures.push({ label: t("Remaining"), value: fmt.number(st.remaining), hint: st.averageStack != null ? `${t("Average stack")}: ${fmt.number(Math.round(st.averageStack))}` : undefined });
  if (st.prizePool != null) figures.push({ label: t("Prize pool"), value: fmt.money(st.prizePool, tt.buyIn?.currency ?? "EUR") });
  if (!started) figures.push({ label: t("Structure"), value: t("{n} levels", { n: s.levels.length }), hint: formatDuration(s.levels.reduce((n, l) => n + l.durationSeconds, 0), t) });
  return figures;
}

/** Level, clock and blinds while the tournament runs; nothing otherwise. */
function LiveClockBlock({ s }: { s: TournamentSnapshot }) {
  const t = useT();
  const fmt = useFormat();
  const clock = useDerivedClock(s.clock, s.levels, 1000);
  if (!clock || s.clock.status === "NOT_STARTED" || s.clock.status === "FINISHED") return null;
  const level = s.levels[clock.levelIndex];
  const paused = s.clock.status === "PAUSED";
  const pct = clock.levelDurationMs > 0 ? Math.min(1, clock.elapsedMs / clock.levelDurationMs) : 0;
  return (
    <div className="grid gap-2 border-b border-border p-4">
      <div className={cn("text-sm font-semibold", paused ? "text-warning" : "text-gold")}>
        {paused ? t("Clock paused") : level?.type === "BREAK" ? t("Break") : t("Level {n}", { n: clock.playLevelNumber })}
      </div>
      <div className="flex items-end justify-between gap-3">
        <span className={cn("clock-digits text-4xl font-semibold leading-none", paused && "text-foreground/60")}>{clock.formatted}</span>
        {level?.type === "PLAY" && <span className="whitespace-nowrap text-lg font-semibold tabular-nums">{blindsLabel(level, fmt.number)}</span>}
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full w-full origin-left", paused ? "bg-warning" : "bg-gold")} style={{ transform: `scaleX(${pct})` }} />
      </div>
    </div>
  );
}

/** Narrow screens: the figures as one strip with hairline dividers. */
export function FiguresStrip({ s }: { s: TournamentSnapshot }) {
  const figures = useFigures(s);
  return (
    <div className="edge-light grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3">
      {figures.map((f) => (
        <div key={f.label} className="bg-card px-4 py-3">
          <div className="eyebrow">{f.label}</div>
          <div className="mt-0.5 text-xl font-semibold tabular-nums">{f.value}</div>
          {f.hint && <div className="text-xs text-muted-foreground">{f.hint}</div>}
        </div>
      ))}
    </div>
  );
}

/** Wide screens: the live clock and the figures in the side rail. */
export function SummaryCard({ s }: { s: TournamentSnapshot }) {
  const figures = useFigures(s);
  return (
    <div className="edge-light overflow-hidden rounded-xl border border-border bg-card">
      <LiveClockBlock s={s} />
      <dl className="divide-y divide-border/70 text-sm">
        {figures.map((f) => (
          <div key={f.label} className="flex items-baseline justify-between gap-3 px-4 py-2.5">
            <dt className="text-foreground/80">
              {f.label}
              {f.hint && <span className="block text-xs text-muted-foreground">{f.hint}</span>}
            </dt>
            <dd className="shrink-0 font-semibold tabular-nums">{f.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * Index of the sections marked with data-toc inside `root`, highlighting the one in view. Sections appear
 * and disappear (entry options follow the format), so the list is rebuilt when the DOM under root changes.
 */
export function SectionIndex({ rootId, title }: { rootId: string; title: string }) {
  const [items, setItems] = useState<{ id: string; label: string }[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const observer = useRef<IntersectionObserver | null>(null);
  useEffect(() => {
    const root = document.getElementById(rootId);
    if (!root) return;
    const scan = () => {
      const els = [...root.querySelectorAll<HTMLElement>("[data-toc]")].filter((el) => el.id);
      setItems((prev) => {
        const next = els.map((el) => ({ id: el.id, label: el.dataset.toc ?? "" }));
        return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
      });
      observer.current?.disconnect();
      observer.current = new IntersectionObserver(
        (entries) => {
          const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
          if (visible) setActive(visible.target.id);
        },
        { rootMargin: "-96px 0px -60% 0px" },
      );
      for (const el of els) observer.current.observe(el);
    };
    scan();
    const mo = new MutationObserver(scan);
    mo.observe(root, { childList: true, subtree: true });
    return () => {
      mo.disconnect();
      observer.current?.disconnect();
    };
  }, [rootId]);
  if (items.length === 0) return null;
  return (
    <nav aria-label={title} className="grid gap-1">
      <div className="px-3 pb-1 text-xs font-medium text-muted-foreground/80">{title}</div>
      {items.map((i) => (
        <a
          key={i.id}
          href={`#${i.id}`}
          onClick={(e) => {
            e.preventDefault();
            document.getElementById(i.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
            setActive(i.id);
          }}
          className={cn(
            "flex min-h-8 items-center rounded-md px-3 text-sm transition-colors",
            active === i.id ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
          )}
        >
          {i.label}
        </a>
      ))}
    </nav>
  );
}
