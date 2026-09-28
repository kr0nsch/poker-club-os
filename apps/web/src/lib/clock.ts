"use client";

import { deriveClock, formatClock, type DerivedClock } from "@pcos/domain";
import type { ClockView, LevelView } from "@pcos/types";
import { useMemo } from "react";
import { useServerNow } from "./realtime-context";

/**
 * Countdown derived locally from the server's persisted anchor and the
 * server-corrected time. The edge server stays authoritative; the browser
 * only animates (spec §16, §51).
 */
export function useDerivedClock(clock: ClockView | null | undefined, levels: readonly LevelView[] | null | undefined, intervalMs = 250): (DerivedClock & { formatted: string }) | null {
  const now = useServerNow(intervalMs);
  const lk = useMemo(() => (levels ?? []).map((l) => ({ type: l.type, durationSeconds: l.durationSeconds })), [levels]);
  if (!clock || !levels || levels.length === 0) return null;
  const d = deriveClock(
    {
      status: clock.status,
      levelIndex: clock.levelIndex,
      startedAt: clock.startedAt ? Date.parse(clock.startedAt) : null,
      pausedAt: clock.pausedAt ? Date.parse(clock.pausedAt) : null,
      remainingAtPauseMs: clock.remainingAtPauseMs,
    },
    lk,
    now,
  );
  return { ...d, formatted: formatClock(d.remainingMs) };
}

export function blindsLabel(level: LevelView | null | undefined, fmt: (n: number) => string): string {
  if (!level) return "—";
  if (level.type === "BREAK") return "";
  return `${fmt(level.smallBlind)} / ${fmt(level.bigBlind)}`;
}

export function anteLabel(level: LevelView | null | undefined, fmt: (n: number) => string): string | null {
  if (!level || level.type === "BREAK" || level.anteType === "NONE" || !level.ante) return null;
  return fmt(level.ante);
}
