"use client";

import type { AnnouncementView } from "@pcos/types";
import { Alert, Button, cn, EmptyState, Skeleton, Stat, Tabs, TabsContent, TabsList, TabsTrigger } from "@pcos/ui";
import { Armchair, Info, Megaphone, Radio, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { isLiveStatus, isNotFound, usePlayerSession } from "@/components/player/api";
import { useFriendlyError } from "@/components/player/labels";
import { RankBadge } from "@/components/player/leaderboard";
import { LiveClockPanel, useLiveClock } from "@/components/player/live-clock";
import { CheckInQr, NEEDS_CHECK_IN } from "@/components/player/registration";
import { SeatingList } from "@/components/player/seating-list";
import { StructureTable } from "@/components/player/structure-table";
import { StatusBadge } from "@/components/status";
import { useFormat, useT } from "@/lib/i18n";
import { usePublicLive } from "@/lib/queries";
import { useServerNow } from "@/lib/realtime-context";

function AnnouncementCard({ a }: { a: AnnouncementView }) {
  const f = useFormat();
  const tone = a.severity === "CRITICAL" ? "border-destructive/50 bg-destructive/10" : a.severity === "WARNING" ? "border-warning/50 bg-warning/10" : "border-border bg-card";
  const Icon = a.severity === "INFO" ? Megaphone : TriangleAlert;
  return (
    <div className={cn("flex gap-3 rounded-xl border p-4", tone)}>
      <Icon className={cn("mt-0.5 size-5 shrink-0", a.severity === "CRITICAL" ? "text-destructive" : a.severity === "WARNING" ? "text-warning" : "text-primary")} />
      <div className="min-w-0">
        <p className="whitespace-pre-line break-words font-medium">{a.body}</p>
        <p className="mt-1 text-xs text-muted-foreground">{f.relative(a.createdAt)}</p>
      </div>
    </div>
  );
}

export default function LivePage() {
  const { org, slug } = useParams<{ org: string; slug: string }>();
  const t = useT();
  const f = useFormat();
  const friendly = useFriendlyError();
  usePlayerSession(org); // keeps the session (and CSRF token) warm; mySeat comes with the snapshot
  const live = usePublicLive(slug, org);
  const snap = live.data;
  const v = useLiveClock(snap);
  const now = useServerNow(15_000);

  if (!snap) {
    if (live.isLoading) {
      return (
        <div className="grid gap-4">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-72 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      );
    }
    return (
      <EmptyState
        icon={<Radio />}
        title={isNotFound(live.error) ? t("Tournament not found") : friendly(live.error).title}
        action={
          <Button asChild variant="outline">
            <Link href={`/p/${org}`}>{t("All tournaments")}</Link>
          </Button>
        }
        className="mt-6"
      />
    );
  }

  const status = snap.tournament.status;
  const playing = isLiveStatus(status);
  const announcements = snap.announcements.filter((a) => !a.displayUntil || Date.parse(a.displayUntil) > now);
  const reg = snap.myRegistration;
  const seating = snap.seating;
  const defaultTab = v.finished || (snap.results.length > 0 && !playing) ? "results" : seating ? "seating" : "structure";

  return (
    <div className="grid gap-5">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={status} />
          <span className="text-sm text-muted-foreground">
            {snap.tournament.venueName} · {f.dateTime(snap.tournament.startAt)}
          </span>
        </div>
        <h1 className="mt-1.5 text-2xl font-semibold leading-tight tracking-tight">{snap.tournament.name}</h1>
      </div>

      <LiveClockPanel snap={snap} />

      {snap.mySeat ? (
        <div className="flex items-center gap-4 rounded-xl border border-gold/50 bg-gold/10 p-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-full bg-gold text-black">
            <Armchair className="size-6" />
          </span>
          <div>
            <div className="text-sm font-semibold text-gold">{t("Your seat")}</div>
            <div className="text-2xl font-bold tabular-nums">{t("Table {table}, seat {seat}", { table: snap.mySeat.tableNumber, seat: snap.mySeat.seatNumber })}</div>
          </div>
        </div>
      ) : reg && NEEDS_CHECK_IN.includes(reg.status) && reg.checkInCode ? (
        <div className="flex items-center gap-4 rounded-xl border border-primary/40 bg-primary/5 p-4">
          <div className="min-w-0 flex-1">
            <div className="font-semibold">{t("You are registered")}</div>
            <p className="mt-0.5 text-sm text-muted-foreground">{t("Check in at the registration desk or kiosk to get your seat.")}</p>
          </div>
          <CheckInQr code={reg.checkInCode} title={snap.tournament.name} size={80} />
        </div>
      ) : reg ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 text-sm">
          <span className="text-muted-foreground">{t("Your registration")}</span>
          <StatusBadge status={reg.status} />
        </div>
      ) : null}

      {(playing || v.finished) && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label={t("Entries")} value={f.number(snap.stats.entries)} hint={snap.stats.reentries > 0 ? `${t("Re-entries")}: ${f.number(snap.stats.reentries)}` : undefined} />
          <Stat label={t("Remaining")} value={f.number(snap.stats.remaining)} />
          <Stat label={t("Average stack")} value={f.number(snap.stats.averageStack)} />
          {snap.stats.prizePool != null && <Stat label={t("Prize pool")} value={f.money(snap.stats.prizePool, snap.tournament.buyIn?.currency)} />}
        </div>
      )}

      {!playing && !v.finished && !v.cancelled && (
        <div className="grid grid-cols-2 gap-3">
          <Stat label={t("Registered")} value={f.number(snap.stats.registrations)} />
          <Stat label={t("Starting stack")} value={f.number(snap.tournament.startingStack)} />
        </div>
      )}

      {playing && (
        <div className={cn("flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm", snap.tournament.registrationOpen ? "border-primary/40 text-primary" : "border-border text-muted-foreground")}>
          <Info className="size-4 shrink-0" />
          {snap.tournament.registrationOpen ? t("Late registration open") : t("Late registration closed")}
        </div>
      )}

      {announcements.length > 0 && (
        <section className="grid gap-2">
          <h2 className="text-lg font-semibold">{t("Announcements")}</h2>
          {announcements.slice(0, 5).map((a) => (
            <AnnouncementCard key={a.id} a={a} />
          ))}
        </section>
      )}

      <Tabs defaultValue={defaultTab}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="seating">{t("Seating")}</TabsTrigger>
          <TabsTrigger value="results">{t("Results")}</TabsTrigger>
          <TabsTrigger value="structure">{t("Structure")}</TabsTrigger>
        </TabsList>
        <TabsContent value="seating">
          {seating ? (
            <SeatingList seating={seating} mySeat={snap.mySeat} />
          ) : (
            <Alert>{t("The seating list is not published at this club. Your own seat is shown above when you are signed in.")}</Alert>
          )}
        </TabsContent>
        <TabsContent value="results">
          {snap.results.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{t("No eliminations yet.")}</p>
          ) : (
            <ol className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
              {snap.results.map((r) => (
                <li key={`${r.position}-${r.playerName}`} className={cn("flex items-center gap-3 px-4 py-2.5", r.position === 1 && "bg-gold/10")}>
                  <RankBadge rank={r.position} />
                  <span className={cn("min-w-0 truncate font-medium", r.position === 1 && "text-gold")}>{r.playerName}</span>
                </li>
              ))}
            </ol>
          )}
        </TabsContent>
        <TabsContent value="structure">
          <StructureTable levels={snap.levels} currentIndex={playing ? v.d?.levelIndex : null} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
