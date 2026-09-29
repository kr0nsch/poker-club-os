"use client";

import { Alert, Badge, Button, EmptyState, PageHeader, Skeleton, Stat, Table, TBody, Td, Th, THead, Tr } from "@pcos/ui";
import { topic } from "@pcos/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ListOrdered, Minus, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { cfgKeys, useLeagues, useScoreRules } from "@/components/admin-config/queries";
import type { LeaderboardView } from "@/components/admin-config/types";
import { BackLink, QueryError, TableSkeleton } from "@/components/admin-config/ui";
import { useCan, useStaff } from "@/components/staff-guard";
import { ApiError, get, post } from "@/lib/api";
import { useFormat, useT } from "@/lib/i18n";
import { errorMessage } from "@/lib/queries";
import { useTopicEvents } from "@/lib/realtime-context";

export default function SeasonLeaderboardPage() {
  const { id } = useParams<{ id: string }>();
  const t = useT();
  const fmt = useFormat();
  const can = useCan();
  const me = useStaff();
  const qc = useQueryClient();
  const leagues = useLeagues();
  const rules = useScoreRules();
  const board = useQuery({ queryKey: cfgKeys.leaderboard(id), queryFn: () => get<LeaderboardView>(`/api/v1/seasons/${id}/leaderboard`) });

  // Finalizing a tournament of this season recomputes the leaderboard on the server.
  useTopicEvents([me.organization ? topic.organization(me.organization.id) : null], (e) => {
    if (e.name === "leaderboard.updated" && (e.data as { seasonId?: string } | null)?.seasonId === id) void qc.invalidateQueries({ queryKey: cfgKeys.leaderboard(id) });
  });

  const recalc = useMutation({
    mutationFn: () => post(`/api/v1/seasons/${id}/recalculate`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: cfgKeys.leaderboard(id) });
      toast.success(t("Leaderboard recalculated"));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (board.isLoading) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-10 w-72" />
        <TableSkeleton rows={10} />
      </div>
    );
  }
  if (!board.data) {
    const notFound = board.error instanceof ApiError && board.error.status === 404;
    return (
      <div>
        <BackLink href="/admin/leagues" label={t("Leagues")} />
        {notFound ? <EmptyState icon={<ListOrdered />} title={t("Season not found")} /> : <QueryError error={board.error} onRetry={() => void board.refetch()} />}
      </div>
    );
  }

  const { season, rows, computedAt } = board.data;
  const league = leagues.data?.find((l) => l.id === season.leagueId);
  const rule = rules.data?.find((r) => r.id === league?.scoreRuleId);
  const totalPoints = rows.reduce((n, r) => n + r.points, 0);

  return (
    <div>
      <BackLink href="/admin/leagues" label={t("Leagues")} />
      <PageHeader
        title={`${league ? `${league.name} — ` : ""}${season.name}`}
        description={`${fmt.date(season.startsOn)} – ${fmt.date(season.endsOn)}${rule ? ` · ${t("Score rule")}: ${rule.name}` : ""}${league?.bestResultsCount ? ` · ${t("best {n} results count", { n: league.bestResultsCount })}` : ""}`}
        actions={
          can("league.manage") && (
            <Button variant="outline" onClick={() => recalc.mutate()} loading={recalc.isPending}>
              <RefreshCw /> {t("Recalculate")}
            </Button>
          )
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3">
        <Stat label={t("Players ranked")} value={fmt.number(rows.length)} />
        <Stat label={t("Points awarded")} value={fmt.number(Math.round(totalPoints * 100) / 100)} />
        <Stat label={t("Last calculated")} value={<span className="text-lg">{computedAt ? fmt.relative(computedAt) : "—"}</span>} hint={computedAt ? fmt.dateTime(computedAt) : undefined} />
      </div>
      {board.isError && <Alert variant="destructive" className="mb-4">{errorMessage(board.error)}</Alert>}
      {rows.length === 0 ? (
        <EmptyState
          icon={<ListOrdered />}
          title={t("No points yet")}
          description={t("The leaderboard fills when tournaments assigned to this season have their results finalized.")}
        />
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th className="w-16">{t("Rank")}</Th>
              <Th className="w-20">{t("Change")}</Th>
              <Th>{t("Player")}</Th>
              <Th className="text-right">{t("Points")}</Th>
              <Th className="hidden text-right sm:table-cell">{t("Tournaments")}</Th>
              <Th className="hidden text-right md:table-cell">{t("Counted")}</Th>
              <Th className="text-right">{t("Wins")}</Th>
              <Th className="hidden text-right sm:table-cell">{t("Best")}</Th>
            </Tr>
          </THead>
          <TBody>
            {rows.map((r) => {
              const delta = r.previousRank != null ? r.previousRank - r.rank : null;
              return (
                <Tr key={r.playerId}>
                  <Td className="text-lg font-semibold tabular-nums">{r.rank}</Td>
                  <Td>
                    {delta == null ? (
                      <Badge variant="default">{t("New")}</Badge>
                    ) : delta > 0 ? (
                      <span className="inline-flex items-center gap-0.5 text-sm text-success tabular-nums" title={t("Up {n}", { n: delta })}>
                        <ArrowUp className="size-4" />
                        {delta}
                      </span>
                    ) : delta < 0 ? (
                      <span className="inline-flex items-center gap-0.5 text-sm text-destructive tabular-nums" title={t("Down {n}", { n: -delta })}>
                        <ArrowDown className="size-4" />
                        {-delta}
                      </span>
                    ) : (
                      <Minus className="size-4 text-muted-foreground" aria-label={t("No change")} />
                    )}
                  </Td>
                  <Td>
                    <Link href={`/admin/players/${r.playerId}`} className="-my-2 inline-flex min-h-9 min-w-8 items-center py-2 font-medium hover:underline">
                      {r.playerName}
                    </Link>
                  </Td>
                  <Td className="text-right font-semibold tabular-nums">{fmt.number(r.points)}</Td>
                  <Td className="hidden text-right tabular-nums sm:table-cell">{r.tournaments}</Td>
                  <Td className="hidden text-right tabular-nums text-muted-foreground md:table-cell">{r.counted}</Td>
                  <Td className="text-right tabular-nums">{r.wins}</Td>
                  <Td className="hidden text-right tabular-nums sm:table-cell">#{r.bestPosition}</Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      )}
    </div>
  );
}
