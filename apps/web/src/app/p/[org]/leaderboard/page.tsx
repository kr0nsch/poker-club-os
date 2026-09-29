"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, Skeleton } from "@pcos/ui";
import { BarChart3 } from "lucide-react";
import { useParams } from "next/navigation";
import { useLeaderboards, usePlayerSession } from "@/components/player/api";
import { useFriendlyError } from "@/components/player/labels";
import { LeagueTable } from "@/components/player/leaderboard";
import { useFormat, useT } from "@/lib/i18n";

export default function LeaderboardPage() {
  const { org } = useParams<{ org: string }>();
  const t = useT();
  const f = useFormat();
  const friendly = useFriendlyError();
  const { player } = usePlayerSession(org);
  const boards = useLeaderboards(org);

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-5">
      <h1 className="text-2xl font-semibold tracking-tight">{t("League standings")}</h1>
      {boards.isLoading ? (
        <Skeleton className="h-80 w-full" />
      ) : boards.isError && !boards.data ? (
        <EmptyState icon={<BarChart3 />} title={friendly(boards.error).title} />
      ) : !boards.data?.leagues.length ? (
        <EmptyState icon={<BarChart3 />} title={t("No active leagues")} description={t("League standings appear here once the club runs a league season.")} />
      ) : (
        boards.data.leagues.map((l) => (
          <Card key={l.league.id}>
            <CardHeader>
              <CardTitle className="text-lg">{l.league.name}</CardTitle>
              <CardDescription>
                {l.season.name} · {f.date(l.season.startsOn)} – {f.date(l.season.endsOn)}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <LeagueTable league={l} highlightPlayerId={player?.id} />
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
