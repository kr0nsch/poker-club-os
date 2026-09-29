"use client";

import { Button, EmptyState, Skeleton } from "@pcos/ui";
import { Radio } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { isLiveStatus, useMyRegistrations, usePlayerSession, usePublicTournaments } from "@/components/player/api";
import { LiveTournamentCard } from "@/components/player/tournament-card";
import { useT } from "@/lib/i18n";

/** "Live" tab: every tournament currently in play (or seating) at the club. */
export default function LiveIndexPage() {
  const { org } = useParams<{ org: string }>();
  const t = useT();
  const list = usePublicTournaments(org);
  const { isPlayer } = usePlayerSession(org);
  const regs = useMyRegistrations(isPlayer);
  const live = (list.data?.tournaments ?? []).filter((x) => isLiveStatus(x.status) || x.status === "SEATING");

  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">{t("Live now")}</h1>
      {list.isLoading ? (
        <Skeleton className="h-44 w-full" />
      ) : live.length === 0 ? (
        <EmptyState
          icon={<Radio />}
          title={t("No tournament is running right now")}
          description={t("The live clock, your seat and the seating list appear here as soon as a tournament starts.")}
          action={
            <Button asChild variant="outline">
              <Link href={`/p/${org}`}>{t("Upcoming tournaments")}</Link>
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {live.map((x) => (
            <LiveTournamentCard key={x.id} tour={x} org={org} registration={regs.data?.find((r) => r.tournamentId === x.id && r.status !== "CANCELLED")} />
          ))}
        </div>
      )}
    </div>
  );
}
