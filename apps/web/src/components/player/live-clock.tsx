"use client";

import { formatClock } from "@pcos/domain";
import type { PublicLiveSnapshot } from "@pcos/types";
import { Badge, Card, cn } from "@pcos/ui";
import { Coffee, Hand, Pause, Trophy } from "lucide-react";
import { useDerivedClock } from "@/lib/clock";
import { useFormat, useT } from "@/lib/i18n";
import { useServerNow } from "@/lib/realtime-context";
import { nextPlayLevel, useTournamentText } from "./labels";

type Derived = NonNullable<ReturnType<typeof useDerivedClock>>;

/** Everything a clock view needs, derived from the public snapshot and server-corrected time. */
export function useLiveClock(snap: PublicLiveSnapshot | null | undefined) {
  const d = useDerivedClock(snap?.clock, snap?.levels);
  const levels = snap?.levels ?? [];
  const level = d ? (levels[d.levelIndex] ?? null) : null;
  const next = d ? nextPlayLevel(levels, d.levelIndex) : null;
  const followingLevel = d ? (levels[d.levelIndex + 1] ?? null) : null;
  const status = snap?.tournament.status;
  return {
    d,
    level,
    next,
    followingLevel,
    status,
    notStarted: !snap || snap.clock.status === "NOT_STARTED",
    paused: snap?.clock.status === "PAUSED" || status === "PAUSED",
    isBreak: !!d?.isBreak,
    handForHand: status === "HAND_FOR_HAND",
    finished: status === "FINISHED" || status === "FINALIZED" || snap?.clock.status === "FINISHED",
    cancelled: status === "CANCELLED",
  };
}

function Progress({ d, paused }: { d: Derived; paused: boolean }) {
  const pct = d.levelDurationMs > 0 ? Math.min(100, Math.max(0, (d.elapsedMs / d.levelDurationMs) * 100)) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
      <div className={cn("h-full w-full origin-left transition-transform duration-500 ease-linear", paused ? "bg-warning" : d.isBreak ? "bg-gold" : "bg-primary")} style={{ transform: `scaleX(${pct / 100})` }} />
    </div>
  );
}

/** Big mobile clock for the live page, with paused / break / hand-for-hand / finished states. */
export function LiveClockPanel({ snap }: { snap: PublicLiveSnapshot }) {
  const t = useT();
  const f = useFormat();
  const tt = useTournamentText();
  const now = useServerNow(1000);
  const v = useLiveClock(snap);
  const { d, level, next, followingLevel } = v;

  if (v.cancelled) {
    return (
      <Card className="p-8 text-center">
        <div className="text-2xl font-semibold text-destructive">{t("Tournament cancelled")}</div>
      </Card>
    );
  }

  if (v.finished) {
    const winner = snap.results.find((r) => r.position === 1);
    return (
      <Card className="felt overflow-hidden border-gold/30 p-8 text-center">
        <Trophy className="mx-auto size-12 text-gold" />
        <div className="mt-3 text-2xl font-semibold">{t("Tournament finished")}</div>
        {winner && (
          <div className="mt-2 text-lg">
            {t("Winner")}: <span className="font-semibold text-gold">{winner.playerName}</span>
          </div>
        )}
      </Card>
    );
  }

  if (v.notStarted || !d) {
    const startMs = Date.parse(snap.tournament.startAt);
    const untilStart = startMs - now;
    const first = snap.levels.find((l) => l.type === "PLAY") ?? null;
    return (
      <Card className="felt overflow-hidden border-primary/25 text-center">
        <div className="px-5 pt-5 text-sm font-semibold text-gold">
          {snap.tournament.status === "SEATING" ? t("Seating in progress") : t("Starts at {time}", { time: f.time(snap.tournament.startAt) })}
        </div>
        <div className="clock-digits px-4 py-3 font-bold leading-none" style={{ fontSize: "min(20vw, 6.5rem)" }}>
          {untilStart > 0 ? formatClock(untilStart) : t("Soon")}
        </div>
        {first && (
          <div className="border-t border-border/60 px-5 py-3 text-sm text-muted-foreground">
            {t("Level {n}", { n: 1 })}: <span className="font-semibold text-foreground">{tt.blinds(first)}</span> · {tt.minutes(first.durationSeconds)}
          </div>
        )}
      </Card>
    );
  }

  const resumeAt = v.isBreak && !v.paused ? new Date(now + d.remainingMs) : null;
  const ante = tt.ante(level);
  const nextAnte = tt.ante(next);

  return (
    <Card className={cn("felt relative overflow-hidden", v.handForHand ? "border-destructive/50" : v.isBreak ? "border-gold/40" : "border-primary/25")}>
      {v.handForHand && (
        <div className="flex items-center justify-center gap-2 bg-destructive px-4 py-1.5 text-sm font-semibold text-destructive-foreground">
          <Hand className="size-4" /> {t("Hand-for-hand")}
        </div>
      )}
      <div className="flex items-center justify-between gap-2 px-5 pt-4">
        <div className={cn("flex items-center gap-2 text-sm font-semibold", v.isBreak ? "text-gold" : "text-foreground")}>
          {v.isBreak ? (
            <>
              <Coffee className="size-4" /> {t("Break")}
            </>
          ) : (
            t("Level {n}", { n: d.playLevelNumber })
          )}
        </div>
        {v.paused && (
          <Badge variant="warning" className="fade-in gap-1.5 text-sm">
            <Pause className="size-3.5" /> {t("Clock paused")}
          </Badge>
        )}
      </div>
      <div className="px-5 pb-4 pt-1 text-center">
        <div className={cn("clock-digits font-bold leading-none transition-opacity", v.paused && "opacity-50")} style={{ fontSize: d.formatted.length > 5 ? "min(19vw, 6rem)" : "min(26vw, 8rem)" }}>
          {d.formatted}
        </div>
        <div className="mt-3">
          <Progress d={d} paused={v.paused} />
        </div>
        {resumeAt && <div className="mt-2 text-sm text-muted-foreground">{t("Play resumes at {time}", { time: f.time(resumeAt) })}</div>}
      </div>
      <div className="grid grid-cols-2 border-t border-border/60">
        <div className="p-4">
          <div className="eyebrow">{v.isBreak ? t("Next level") : t("Blinds")}</div>
          <div className="mt-1 whitespace-nowrap text-xl font-bold tabular-nums min-[420px]:text-2xl">{v.isBreak ? (next ? tt.blinds(next) : "—") : tt.blinds(level)}</div>
          {(v.isBreak ? nextAnte : ante) && <div className="text-sm text-muted-foreground tabular-nums">{v.isBreak ? nextAnte : ante}</div>}
        </div>
        <div className="border-l border-border/60 p-4">
          <div className="eyebrow">{v.isBreak ? t("Next break") : t("Next level")}</div>
          {v.isBreak ? (
            <div className="mt-1 whitespace-nowrap text-xl font-bold tabular-nums min-[420px]:text-2xl">{d.msUntilNextBreak != null ? formatClock(d.msUntilNextBreak) : "—"}</div>
          ) : followingLevel?.type === "BREAK" ? (
            <div className="mt-1 text-2xl font-bold text-gold">
              {t("Break")} <span className="whitespace-nowrap text-base font-medium text-muted-foreground">· {tt.minutes(followingLevel.durationSeconds)}</span>
            </div>
          ) : (
            <>
              <div className="mt-1 whitespace-nowrap text-xl font-bold tabular-nums min-[420px]:text-2xl">{next ? tt.blinds(next) : "—"}</div>
              {nextAnte && <div className="text-sm text-muted-foreground tabular-nums">{nextAnte}</div>}
            </>
          )}
        </div>
      </div>
      {!v.isBreak && (
        <div className="flex items-center justify-between border-t border-border/60 px-5 py-3 text-sm">
          <span className="text-muted-foreground">{t("Next break")}</span>
          <span className="font-semibold tabular-nums">{d.msUntilNextBreak != null ? formatClock(d.msUntilNextBreak) : "—"}</span>
        </div>
      )}
    </Card>
  );
}

/** One-line clock for tournament cards: level, countdown and blinds. */
export function LiveClockLine({ snap, className }: { snap: PublicLiveSnapshot; className?: string }) {
  const t = useT();
  const tt = useTournamentText();
  const v = useLiveClock(snap);
  if (!v.d || v.notStarted || v.finished || v.cancelled) return null;
  return (
    <div className={cn("flex flex-wrap items-baseline gap-x-3 gap-y-1", className)}>
      <span className={cn("text-sm font-semibold", v.isBreak ? "text-gold" : "text-muted-foreground")}>
        {v.isBreak ? t("Break") : t("Level {n}", { n: v.d.playLevelNumber })}
      </span>
      <span className={cn("clock-digits text-3xl font-bold", v.paused && "opacity-50")}>{v.d.formatted}</span>
      {!v.isBreak && <span className="font-semibold tabular-nums text-foreground/90">{tt.blinds(v.level)}</span>}
      {v.paused && <Badge variant="warning">{t("Paused")}</Badge>}
      {v.handForHand && <Badge variant="destructive">{t("Hand-for-hand")}</Badge>}
    </div>
  );
}
