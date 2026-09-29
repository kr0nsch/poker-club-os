"use client";

import { Button, cn } from "@pcos/ui";
import { ChevronRight, Radio, Users } from "lucide-react";
import Link from "next/link";
import { StatusBadge } from "@/components/status";
import { useFormat, useT } from "@/lib/i18n";
import { usePublicLive } from "@/lib/queries";
import { isLiveStatus, type MyRegistration, type PublicTournament } from "./api";
import { useTournamentText } from "./labels";
import { LiveClockLine } from "./live-clock";

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

/** Highlighted card for a tournament in play, with its live clock. */
export function LiveTournamentCard({ tour, org, registration }: { tour: PublicTournament; org: string; registration?: MyRegistration | null }) {
  const t = useT();
  const f = useFormat();
  const live = usePublicLive(tour.slug, org);
  const snap = live.data;
  const playing = isLiveStatus(tour.status);
  return (
    <div className={cn("edge-light rounded-xl border bg-card p-4", playing ? "border-gold/35" : "border-border")}>
      <div className="flex items-center justify-between gap-3">
        <span className={cn("flex items-center gap-2 text-sm font-semibold", playing ? "text-destructive" : "text-gold")}>
          <span aria-hidden className="size-2 rounded-full bg-current" />
          {playing ? t("Live") : t("Seating")}
        </span>
        <StatusBadge status={tour.status} />
      </div>
      <Link href={`/p/${org}/live/${tour.slug}`} className="mt-0.5 block py-1 text-xl font-semibold leading-tight transition-colors hover:text-gold">
        {tour.name}
      </Link>
      {snap && <LiveClockLine snap={snap} className="mt-2" />}
      {snap && playing && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span>
            {t("Entries")}: <span className="font-semibold text-foreground tabular-nums">{f.number(snap.stats.entries)}</span>
          </span>
          <span>
            {t("Remaining")}: <span className="font-semibold text-foreground tabular-nums">{f.number(snap.stats.remaining)}</span>
          </span>
          <span>
            {t("Average stack")}: <span className="font-semibold text-foreground tabular-nums">{f.number(snap.stats.averageStack)}</span>
          </span>
        </div>
      )}
      {snap?.mySeat && (
        <div className="mt-3 rounded-lg border border-gold/30 bg-gold/[0.07] px-3 py-2 text-sm">
          <span className="text-muted-foreground">{t("Your seat")}: </span>
          <span className="font-semibold text-gold">{t("Table {table}, seat {seat}", { table: snap.mySeat.tableNumber, seat: snap.mySeat.seatNumber })}</span>
        </div>
      )}
      {!snap?.mySeat && registration && <div className="mt-2 text-sm text-muted-foreground">{t("You are registered")}</div>}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button asChild size="lg">
          <Link href={`/p/${org}/live/${tour.slug}`}>
            <Radio /> {t("Live page")}
          </Link>
        </Button>
        <Button asChild size="lg" variant="outline">
          <Link href={`/p/${org}/t/${tour.slug}`}>{t("Details")}</Link>
        </Button>
      </div>
    </div>
  );
}
