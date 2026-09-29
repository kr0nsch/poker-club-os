"use client";

import { deriveClock, formatClock, isLateRegistrationOpen, type DerivedClock } from "@pcos/domain";
import { LIVE_TOURNAMENT_STATUSES, type ClockView, type LevelView, type TournamentDetailView } from "@pcos/types";
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

/** Late registration as the server evaluates it: level/time rules plus the manual close switch. */
export function lateRegistrationOpen(t: Pick<TournamentDetailView, "status" | "lateRegistrationPolicy" | "lateRegistrationClosed">, clock: DerivedClock | null): boolean {
  if (t.status === "REGISTRATION_OPEN") return true;
  if (!["SEATING", ...LIVE_TOURNAMENT_STATUSES].includes(t.status)) return false;
  return isLateRegistrationOpen({ status: t.status, policy: t.lateRegistrationPolicy, manuallyClosed: t.lateRegistrationClosed, clock, now: Date.now() });
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
