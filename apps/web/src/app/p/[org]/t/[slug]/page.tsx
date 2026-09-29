"use client";

import type { CommandResult, RegistrationStatus } from "@pcos/types";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, EmptyState, Skeleton } from "@pcos/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Layers, LogIn, MapPin, Radio, Trophy, UserPlus } from "lucide-react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { isClosedStatus, isLiveStatus, isNotFound, playerKeys, useMyRegistrations, usePlayerSession, usePublicTournaments } from "@/components/player/api";
import { useFriendlyError, useTournamentText } from "@/components/player/labels";
import { useLiveClock } from "@/components/player/live-clock";
import { CheckInQr, NEEDS_CHECK_IN } from "@/components/player/registration";
import { StructureTable } from "@/components/player/structure-table";
import { StatusBadge } from "@/components/status";
import { post } from "@/lib/api";
import { useFormat, useT } from "@/lib/i18n";
import { keys, usePublicLive } from "@/lib/queries";

interface RegisterResult {
  registrationId: string;
  status: RegistrationStatus;
  waitlistPosition: number | null;
  checkInCode: string | null;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <dt className="eyebrow">{label}</dt>
      <dd className="mt-1 font-semibold tabular-nums">{children}</dd>
    </div>
  );
}

/** Most common play-level duration, for the "20 min levels" summary. */
function typicalLevelSeconds(levels: { type: string; durationSeconds: number }[]): number | null {
  const counts = new Map<number, number>();
  for (const l of levels) if (l.type === "PLAY") counts.set(l.durationSeconds, (counts.get(l.durationSeconds) ?? 0) + 1);
  let best: number | null = null;
  let n = 0;
  for (const [d, c] of counts) if (c > n) [best, n] = [d, c];
  return best;
}

export default function TournamentPage() {
  const { org, slug } = useParams<{ org: string; slug: string }>();
  const t = useT();
  const f = useFormat();
  const tt = useTournamentText();
  const friendly = useFriendlyError();
  const qc = useQueryClient();
  const path = usePathname() ?? `/p/${org}/t/${slug}`;
  const { isPlayer, signedIn } = usePlayerSession(org);
  const live = usePublicLive(slug, org);
  const list = usePublicTournaments(org);
  const listed = list.data?.tournaments.find((x) => x.slug === slug || x.id === slug);
  const past = usePublicTournaments(org, { past: true, enabled: list.isSuccess && !listed });
  const summary = listed ?? past.data?.tournaments.find((x) => x.slug === slug || x.id === slug) ?? null;
  const regs = useMyRegistrations(isPlayer);
  const snap = live.data;
  const v = useLiveClock(snap);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const tid = snap?.tournament.id ?? summary?.id ?? null;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: keys.live(slug) });
    void qc.invalidateQueries({ queryKey: playerKeys.registrations });
    void qc.invalidateQueries({ queryKey: ["public", org, "tournaments"] });
  };

  const register = useMutation({
    mutationFn: () => post<CommandResult<RegisterResult>>(`/api/v1/public/tournaments/${tid}/register`, { clientOperationId: crypto.randomUUID() }),
    onSuccess: (res) => {
      toast.success(res.result.status === "WAITLISTED" ? t("You are on the waitlist") : t("You are registered"), {
        description: res.result.status === "WAITLISTED" && res.result.waitlistPosition != null ? t("Position {n}", { n: res.result.waitlistPosition }) : undefined,
      });
      refresh();
    },
    onError: (e) => {
      const m = friendly(e);
      toast.error(m.title, { description: m.detail });
      refresh();
    },
  });

  const cancel = useMutation({
    mutationFn: () => post<CommandResult>(`/api/v1/public/tournaments/${tid}/cancel`, { clientOperationId: crypto.randomUUID() }),
    onSuccess: () => {
      setConfirmCancel(false);
      toast.success(t("Your registration was cancelled"));
      refresh();
    },
    onError: (e) => {
      const m = friendly(e);
      toast.error(m.title, { description: m.detail });
      refresh();
    },
  });

  const info = snap?.tournament ?? summary;
  if (!info) {
    if (live.isLoading || list.isLoading || past.isLoading) {
      return (
        <div className="grid gap-4">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      );
    }
    return (
      <EmptyState
        icon={<Trophy />}
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

  const { name, status, startAt, buyIn, format, gameType, startingStack, venueName } = info;
  const registered = snap?.stats.registrations ?? summary?.registrationCount ?? 0;
  const maxPlayers = summary?.maxPlayers ?? null;
  const full = maxPlayers != null && registered >= maxPlayers;
  const playing = isLiveStatus(status);
  const closed = isClosedStatus(status);
  // Computed by the server from the late-registration rules (level/time), not just the manual switch.
  const canRegisterNow = info.registrationOpen;
  const levelSeconds = snap ? typicalLevelSeconds(snap.levels) : null;

  const myReg = snap?.myRegistration && snap.myRegistration.status !== "CANCELLED" && snap.myRegistration.status !== "NO_SHOW" ? snap.myRegistration : null;
  const waitlistPosition = regs.data?.find((r) => r.tournamentId === tid && r.status === "WAITLISTED")?.waitlistPosition ?? null;
  const next = encodeURIComponent(path);

  let panel: ReactNode;
  if (myReg) {
    const cancellable = myReg.status === "REGISTERED" || myReg.status === "RESERVED" || myReg.status === "WAITLISTED";
    panel = (
      <div className="rounded-xl border border-primary/40 bg-primary/5 p-4">
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <div className="text-lg font-semibold">
              {myReg.status === "WAITLISTED"
                ? t("You are on the waitlist")
                : myReg.status === "CHECKED_IN" || myReg.status === "PLAYING"
                  ? t("You are checked in")
                  : myReg.status === "ELIMINATED"
                    ? t("Thanks for playing!")
                    : t("You are registered")}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <StatusBadge status={myReg.status} />
              {myReg.status === "WAITLISTED" && waitlistPosition != null && <span className="text-sm text-muted-foreground">{t("Position {n}", { n: waitlistPosition })}</span>}
            </div>
            {snap?.mySeat && (
              <div className="mt-2 text-lg font-bold text-gold">{t("Table {table}, seat {seat}", { table: snap.mySeat.tableNumber, seat: snap.mySeat.seatNumber })}</div>
            )}
            {NEEDS_CHECK_IN.includes(myReg.status) && (
              <p className="mt-2 text-sm text-muted-foreground">{t("Show this QR code at the registration desk or kiosk")}</p>
            )}
          </div>
          {NEEDS_CHECK_IN.includes(myReg.status) && myReg.checkInCode && <CheckInQr code={myReg.checkInCode} title={name} size={104} />}
        </div>
        {cancellable && !closed && (
          <Button variant="outline" className="mt-4 w-full" onClick={() => setConfirmCancel(true)}>
            {t("Cancel registration")}
          </Button>
        )}
      </div>
    );
  } else if (closed) {
    panel = null;
  } else if (canRegisterNow) {
    panel = isPlayer ? (
      <div className="grid gap-2">
        <Button size="xl" className="w-full" loading={register.isPending} onClick={() => register.mutate()} disabled={!tid}>
          <UserPlus /> {full ? t("Join the waitlist") : t("Register")}
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          {buyIn && buyIn.amount + buyIn.fee > 0 ? t("The buy-in is paid at the cashier when you check in.") : t("Free to enter.")}
        </p>
      </div>
    ) : signedIn ? (
      <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">{t("Sign in with a player account of this club to register.")}</div>
    ) : (
      <div className="rounded-xl border border-primary/40 bg-primary/5 p-4">
        <div className="font-semibold">{t("Sign in to register")}</div>
        <p className="mt-1 text-sm text-muted-foreground">{t("Registration takes one tap once you have a player account.")}</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button asChild size="lg">
            <Link href={`/p/${org}/login?next=${next}`}>
              <LogIn /> {t("Sign in")}
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href={`/p/${org}/signup?next=${next}`}>{t("Sign up")}</Link>
          </Button>
        </div>
      </div>
    );
  } else {
    panel = (
      <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
        {status === "SCHEDULED" ? t("Registration is not open yet.") : t("Registration is closed.")}
      </div>
    );
  }

  return (
    // Phones: one column. From lg: details and registration on the left, the blind structure on the right.
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start lg:gap-x-10">
      <div className="grid gap-6">
        <div>
          <StatusBadge status={status} />
          <h1 className="mt-2 text-2xl font-semibold leading-tight tracking-tight">{name}</h1>
          <div className="mt-2 grid gap-1 text-sm text-muted-foreground">
            <span className="flex items-center gap-2">
              <CalendarDays className="size-4" /> {f.dateTime(startAt)}
            </span>
            {venueName && (
              <span className="flex items-center gap-2">
                <MapPin className="size-4" /> {venueName}
              </span>
            )}
          </div>
          {summary?.description && <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-foreground/85">{summary.description}</p>}
        </div>

        {panel}

        {(playing || status === "SEATING" || closed) && status !== "CANCELLED" && (
          <Button asChild size="lg" variant={playing ? "default" : "secondary"}>
            <Link href={`/p/${org}/live/${slug}`}>
              <Radio /> {playing || status === "SEATING" ? t("Live page") : t("Results")}
            </Link>
          </Button>
        )}

        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Fact label={t("Buy-in")}>{tt.buyIn(buyIn)}</Fact>
          <Fact label={t("Starting stack")}>{f.number(startingStack)}</Fact>
          <Fact label={t("Format")}>{tt.format(format)}</Fact>
          <Fact label={t("Game")}>{tt.game(gameType)}</Fact>
          <Fact label={t("Registered")}>
            {maxPlayers ? `${f.number(registered)} / ${f.number(maxPlayers)}` : f.number(registered)}
            {snap && snap.stats.waitlisted > 0 && <span className="ml-1 text-xs font-normal text-warning">(+{f.number(snap.stats.waitlisted)})</span>}
          </Fact>
          {levelSeconds != null && <Fact label={t("Levels")}>{tt.minutes(levelSeconds)}</Fact>}
          {playing && <Fact label={t("Late registration")}>{canRegisterNow ? <span className="text-primary">{t("Still open")}</span> : <span className="text-muted-foreground">{t("Closed")}</span>}</Fact>}
        </dl>
      </div>

      {snap && snap.levels.length > 0 && (
        <section className="grid gap-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Layers className="size-5 text-muted-foreground" /> {t("Blind structure")}
          </h2>
          <StructureTable levels={snap.levels} currentIndex={playing ? v.d?.levelIndex : null} />
        </section>
      )}

      <Dialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Cancel registration?")}</DialogTitle>
            <DialogDescription>{t("Your place will be released. You can register again while registration is open.")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmCancel(false)}>
              {t("Keep my registration")}
            </Button>
            <Button variant="destructive" loading={cancel.isPending} onClick={() => cancel.mutate()}>
              {t("Cancel registration")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
