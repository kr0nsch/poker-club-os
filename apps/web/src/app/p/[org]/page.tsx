"use client";

import { Alert, Button, EmptyState, Skeleton } from "@pcos/ui";
import { BarChart3, CalendarDays, ChevronRight, Ticket } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { ReactNode } from "react";
import {
  isClosedStatus,
  isLiveStatus,
  isNotFound,
  useLeaderboards,
  useMyRegistrations,
  usePlayerSession,
  usePublicTournaments,
  type MyRegistration,
} from "@/components/player/api";
import { useFriendlyError } from "@/components/player/labels";
import { LeagueTable } from "@/components/player/leaderboard";
import { RegistrationTicket } from "@/components/player/registration";
import { LiveTournamentCard, TournamentCard } from "@/components/player/tournament-card";
import { useFormat, useT } from "@/lib/i18n";

function Section({ title, icon, action, children }: { title: string; icon?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight [&_svg]:size-5 [&_svg]:text-muted-foreground">
          {icon}
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export default function PlayerHomePage() {
  const { org } = useParams<{ org: string }>();
  const t = useT();
  const f = useFormat();
  const friendly = useFriendlyError();
  const list = usePublicTournaments(org);
  const { isPlayer, player } = usePlayerSession(org);
  const regs = useMyRegistrations(isPlayer);
  const boards = useLeaderboards(org);

  const tournaments = list.data?.tournaments ?? [];
  const live = tournaments.filter((x) => isLiveStatus(x.status) || x.status === "SEATING");
  const upcoming = tournaments.filter((x) => x.status === "SCHEDULED" || x.status === "REGISTRATION_OPEN");
  const earlier = tournaments.filter((x) => isClosedStatus(x.status));
  const myRegs = (regs.data ?? []).filter((r) => r.status !== "CANCELLED" && r.status !== "NO_SHOW");
  const regByTournament = new Map<string, MyRegistration>(myRegs.map((r) => [r.tournamentId, r]));
  const firstLeague = boards.data?.leagues[0];

  return (
    <div className="grid gap-8">
      {list.isError && !isNotFound(list.error) && !list.data && (
        <Alert variant="destructive" title={t("Could not load tournaments")}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>{friendly(list.error).title}</span>
            <Button size="sm" variant="outline" onClick={() => void list.refetch()}>
              {t("Try again")}
            </Button>
          </div>
        </Alert>
      )}

      {list.isLoading && (
        <div className="grid gap-3">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-36 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      )}

      {live.length > 0 && (
        <Section title={t("Live now")}>
          <div className="grid gap-3">
            {live.map((x) => (
              <LiveTournamentCard key={x.id} tour={x} org={org} registration={regByTournament.get(x.id)} />
            ))}
          </div>
        </Section>
      )}

      {isPlayer && myRegs.length > 0 && (
        <Section title={t("My registrations")} icon={<Ticket />}>
          <div className="grid gap-3">
            {myRegs.map((r) => (
              <RegistrationTicket key={r.registrationId} reg={r} org={org} />
            ))}
          </div>
        </Section>
      )}

      {list.isSuccess && (
        <Section title={t("Upcoming tournaments")} icon={<CalendarDays />}>
          {upcoming.length === 0 ? (
            <EmptyState icon={<CalendarDays />} title={t("No upcoming tournaments")} description={t("New tournaments will appear here as soon as the club publishes them.")} />
          ) : (
            <div className="grid gap-3">
              {upcoming.map((x) => (
                <TournamentCard key={x.id} tour={x} org={org} registration={regByTournament.get(x.id)} />
              ))}
            </div>
          )}
        </Section>
      )}

      {list.isSuccess && !isPlayer && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
          <div className="font-semibold">{t("Register for tournaments from your phone")}</div>
          <p className="mt-1 text-sm text-muted-foreground">{t("Create a free player account to register online, get your check-in QR code and see your seat.")}</p>
          <div className="mt-3 flex gap-2">
            <Button asChild>
              <Link href={`/p/${org}/signup`}>{t("Sign up")}</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={`/p/${org}/login`}>{t("Sign in")}</Link>
            </Button>
          </div>
        </div>
      )}

      {earlier.length > 0 && (
        <Section title={t("Earlier today")}>
          <div className="grid gap-2">
            {earlier.map((x) => (
              <Link
                key={x.id}
                href={x.status === "CANCELLED" ? `/p/${org}/t/${x.slug}` : `/p/${org}/live/${x.slug}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card/60 px-4 py-3 text-sm hover:border-primary/40"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{x.name}</span>
                  <span className="text-muted-foreground">{f.time(x.startAt)}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
                  {x.status === "CANCELLED" ? t("CANCELLED") : t("Results")}
                  <ChevronRight className="size-4" />
                </span>
              </Link>
            ))}
          </div>
        </Section>
      )}

      {firstLeague && (
        <Section
          title={t("League standings")}
          icon={<BarChart3 />}
          action={
            <Button asChild variant="ghost" size="sm">
              <Link href={`/p/${org}/leaderboard`}>
                {t("Full standings")} <ChevronRight />
              </Link>
            </Button>
          }
        >
          <div className="text-sm text-muted-foreground">
            {firstLeague.league.name} · {firstLeague.season.name}
          </div>
          <LeagueTable league={firstLeague} limit={5} highlightPlayerId={player?.id} />
        </Section>
      )}
    </div>
  );
}
