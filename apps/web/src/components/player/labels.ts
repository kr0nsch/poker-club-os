"use client";

import type { GameType, LevelView, Money, TournamentFormat } from "@pcos/types";
import { useMemo } from "react";
import { ApiError } from "@/lib/api";
import { anteLabel, blindsLabel } from "@/lib/clock";
import { useFormat, useT } from "@/lib/i18n";

const FORMAT_LABELS: Record<TournamentFormat, string> = {
  FREEZEOUT: "Freezeout",
  REENTRY: "Re-entry",
  REBUY: "Rebuy",
  BOUNTY: "Bounty",
  PROGRESSIVE_KO: "Progressive knockout",
  MYSTERY_BOUNTY: "Mystery bounty",
  SATELLITE: "Satellite",
  SHOOTOUT: "Shootout",
  MULTI_DAY: "Multi-day",
};

const GAME_LABELS: Record<GameType, string> = {
  NLHE: "No-Limit Hold'em",
  PLO: "Pot-Limit Omaha",
  PLO5: "5-Card PLO",
  MIXED: "Mixed games",
  OTHER: "Other game",
};

/** Human labels for tournament facts, localized. */
export function useTournamentText() {
  const t = useT();
  const f = useFormat();
  return useMemo(
    () => ({
      format: (v: TournamentFormat) => t(FORMAT_LABELS[v] ?? v),
      game: (v: GameType) => t(GAME_LABELS[v] ?? v),
      buyIn: (m: Money | null | undefined) => {
        if (!m || m.amount + m.fee === 0) return t("Free");
        return m.fee > 0 ? `${f.money(m.amount, m.currency)} + ${f.money(m.fee, m.currency)}` : f.money(m.amount, m.currency);
      },
      minutes: (seconds: number) => `${Math.round(seconds / 60)} ${t("min")}`,
      blinds: (l: LevelView | null | undefined) => blindsLabel(l, f.number),
      ante: (l: LevelView | null | undefined) => {
        const a = anteLabel(l, f.number);
        if (!a || !l) return null;
        return l.anteType === "BIG_BLIND" ? `${t("BB ante")} ${a}` : `${t("Ante")} ${a}`;
      },
    }),
    [t, f],
  );
}

/** Next play level after `index` (breaks are skipped). */
export function nextPlayLevel(levels: readonly LevelView[], index: number): LevelView | null {
  for (let i = index + 1; i < levels.length; i++) {
    const l = levels[i];
    if (l && l.type === "PLAY") return l;
  }
  return null;
}

/** Server messages are English and technical; map the common cases to friendly, localized text. */
export function useFriendlyError() {
  const t = useT();
  return (e: unknown): { title: string; detail?: string } => {
    if (!(e instanceof ApiError)) return { title: t("Something went wrong") };
    if (e.isNetwork) return { title: t("Local server unreachable"), detail: t("Check the venue Wi-Fi and try again.") };
    switch (e.code) {
      case "UNAUTHENTICATED":
        return { title: t("Please sign in again.") };
      case "CSRF_REJECTED":
        return { title: t("Your session has expired. Please reload the page.") };
      case "RATE_LIMITED":
        return { title: t("Too many attempts. Please wait a moment and try again.") };
      case "FEATURE_DISABLED":
        return { title: t("This feature is disabled by the club."), detail: e.message };
      default:
        return { title: e.message || t("Something went wrong") };
    }
  };
}
