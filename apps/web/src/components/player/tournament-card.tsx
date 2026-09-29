"use client";

import { cn } from "@pcos/ui";
import { ChevronRight, Users } from "lucide-react";
import Link from "next/link";
import { StatusBadge } from "@/components/status";
import { useFormat, useT } from "@/lib/i18n";
import { usePublicLive } from "@/lib/queries";
import { isLiveStatus, type MyRegistration, type PublicTournament } from "./api";
import { useTournamentText } from "./labels";
import { useLiveClock } from "./live-clock";

function RegisteredCount({ tour }: { tour: PublicTournament }) {
  const t = useT();
  const f = useFormat();
  return (
    <span className="flex items-center gap-1.5 text-muted-foreground">
      <Users className="size-4" />
      <span className="tabular-nums">{tour.maxPlayers ? `${f.number(tour.registrationCount)} / ${f.number(tour.maxPlayers)}` : f.number(tour.registrationCount)}</span>
      {t("registered")}
    </span>
  );
}

/** Schedule entry; the whole card opens the tournament page. */
export function TournamentCard({ tour, org, registration }: { tour: PublicTournament; org: string; registration?: MyRegistration | null }) {
  const t = useT();
  const f = useFormat();
  const tt = useTournamentText();
  const full = tour.maxPlayers != null && tour.registrationCount >= tour.maxPlayers;
  return (
    <Link
      href={`/p/${org}/t/${tour.slug}`}
      className="edge-light block rounded-xl border border-border bg-card p-4 transition-colors hover:border-border-strong hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:bg-accent"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm font-medium text-gold">{f.dateTime(tour.startAt)}</div>
        <StatusBadge status={tour.status} />
      </div>
      <div className="mt-1 text-lg font-semibold leading-tight">{tour.name}</div>
      <div className="mt-1 text-sm text-muted-foreground">
        {tt.buyIn(tour.buyIn)} · {tt.format(tour.format)} · {tt.game(tour.gameType)}
      </div>
      <div className="mt-3 flex items-center gap-3 text-sm">
        <RegisteredCount tour={tour} />
        {full && !registration && <span className="text-xs font-medium text-warning">{t("Full — waitlist")}</span>}
        <span className="ml-auto flex items-center gap-2">
          {registration && <StatusBadge status={registration.status} />}
          <ChevronRight className="size-4 text-muted-foreground" />
        </span>
      </div>
    </Link>
  );
}

/**
 * A tournament in play, read at a glance: level, clock and blinds large, the field below, the player's
 * own seat as a highlighted strip. The whole card opens the live page (which links to the details).
 */
export function LiveTournamentCard({ tour, org, registration }: { tour: PublicTournament; org: string; registration?: MyRegistration | null }) {
  const t = useT();
  const f = useFormat();
  const tt = useTournamentText();
  const live = usePublicLive(tour.slug, org);
  const snap = live.data;
  const v = useLiveClock(snap);
  const d = v.d;
  const playing = isLiveStatus(tour.status);
  const shown = v.isBreak ? v.next : v.level;
  const pct = d && d.levelDurationMs > 0 ? Math.min(1, d.elapsedMs / d.levelDurationMs) : 0;
  return (
    <Link
      href={`/p/${org}/live/${tour.slug}`}
      className={cn(
        "edge-light group grid gap-4 overflow-hidden rounded-xl border bg-card p-4 transition-colors hover:border-border-strong hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:bg-accent/50",
        v.handForHand ? "border-destructive/45" : "border-border",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className={cn("flex items-center gap-2 text-sm font-semibold", playing ? "text-destructive" : "text-gold")}>
            <span aria-hidden className="size-2 rounded-full bg-current" />
            {playing ? (v.handForHand ? t("Hand-for-hand") : v.paused ? t("Paused") : t("Live")) : t("Seating")}
          </span>
          <h3 className="mt-1 truncate text-xl font-semibold leading-tight">{tour.name}</h3>
        </div>
        <ChevronRight className="mt-6 size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </div>

      {d && !v.notStarted && (
        <div className="grid gap-2.5">
          <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
            <div>
              <div className={cn("text-sm font-semibold", v.paused ? "text-warning" : "text-gold")}>{v.isBreak ? t("Break") : t("Level {n}", { n: d.playLevelNumber })}</div>
              <div className={cn("clock-digits text-4xl font-semibold leading-none", v.paused && "text-foreground/60")}>{d.formatted}</div>
            </div>
            <div className="ml-auto text-right">
              {v.isBreak && <div className="eyebrow">{t("Next level")}</div>}
              <div className="whitespace-nowrap text-xl font-semibold tabular-nums">{tt.blinds(shown) || "—"}</div>
              {tt.ante(shown) && <div className="text-sm text-muted-foreground tabular-nums">{tt.ante(shown)}</div>}
            </div>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-muted">
            <div className={cn("h-full w-full origin-left transition-transform duration-1000 ease-linear", v.paused ? "bg-warning" : "bg-gold")} style={{ transform: `scaleX(${pct})` }} />
          </div>
        </div>
      )}

      {snap && playing && (
        <dl className="grid grid-cols-3 gap-3 border-t border-border pt-3 text-sm">
          <div>
            <dt className="eyebrow">{t("Entries")}</dt>
            <dd className="mt-0.5 font-semibold tabular-nums">{f.number(snap.stats.entries)}</dd>
          </div>
          <div>
            <dt className="eyebrow">{t("Remaining")}</dt>
            <dd className="mt-0.5 font-semibold tabular-nums">{f.number(snap.stats.remaining)}</dd>
          </div>
          <div>
            <dt className="eyebrow">{t("Average stack")}</dt>
            <dd className="mt-0.5 font-semibold tabular-nums">{f.number(snap.stats.averageStack)}</dd>
          </div>
        </dl>
      )}

      {snap?.mySeat ? (
        <div className="-mx-4 -mb-4 flex items-center justify-between gap-3 border-t border-gold/30 bg-gold/[0.08] px-4 py-3 text-sm">
          <span className="text-muted-foreground">{t("Your seat")}</span>
          <span className="font-semibold text-gold">{t("Table {table}, seat {seat}", { table: snap.mySeat.tableNumber, seat: snap.mySeat.seatNumber })}</span>
        </div>
      ) : (
        registration && <div className="text-sm text-muted-foreground">{t("You are registered")}</div>
      )}
    </Link>
  );
}
