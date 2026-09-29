"use client";

import { Alert, Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, PageHeader, Skeleton, Table, TBody, Td, Th, THead, Tr, Tabs, TabsContent, TabsList, TabsTrigger } from "@pcos/ui";
import { BarChart3, CalendarRange, Calculator, ListOrdered, Pencil, Plus, Trophy } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { LeagueDialog, ScoreRuleDialog, SeasonDialog, SeriesDialog } from "@/components/admin-config/league-dialogs";
import { useLeagues, useScoreRules, useSeries } from "@/components/admin-config/queries";
import type { League, ScoreRule, Season, Series } from "@/components/admin-config/types";
import { QueryError, TableSkeleton } from "@/components/admin-config/ui";
import { todayIsoDate } from "@/components/admin-config/utils";
import { useCan } from "@/components/staff-guard";
import { useFormat, useT } from "@/lib/i18n";

const TABS = ["leagues", "score-rules", "series"] as const;

export default function LeaguesPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <LeaguesHome />
    </Suspense>
  );
}

function LeaguesHome() {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const param = useSearchParams().get("tab");
  const tab = (TABS as readonly string[]).includes(param ?? "") ? (param as (typeof TABS)[number]) : "leagues";
  return (
    <div>
      <PageHeader title={t("Leagues")} description={t("Seasons, point rules, series and leaderboards.")} />
      <Tabs value={tab} onValueChange={(v) => router.replace(`${pathname}?tab=${v}`, { scroll: false })}>
        <TabsList>
          <TabsTrigger value="leagues">
            <Trophy className="size-4" /> {t("Leagues")}
          </TabsTrigger>
          <TabsTrigger value="score-rules">
            <Calculator className="size-4" /> {t("Score rules")}
          </TabsTrigger>
          <TabsTrigger value="series">
            <CalendarRange className="size-4" /> {t("Series")}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="leagues">
          <LeaguesTab />
        </TabsContent>
        <TabsContent value="score-rules">
          <ScoreRulesTab />
        </TabsContent>
        <TabsContent value="series">
          <SeriesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ruleSummary(r: ScoreRule, t: ReturnType<typeof useT>): string {
  if (r.kind === "FORMULA") return r.config.expression;
  const head = r.config.points
    .slice(0, 5)
    .map((p, i) => `${i + 1}: ${p}`)
    .join(" · ");
  return r.config.points.length > 5 ? `${head} · … (${t("{n} places", { n: r.config.points.length })})` : head;
}

// --- leagues ------------------------------------------------------------------------------------------------

function LeaguesTab() {
  const t = useT();
  const fmt = useFormat();
  const can = useCan();
  const leagues = useLeagues();
  const rules = useScoreRules();
  const manage = can("league.manage");
  const [leagueDialog, setLeagueDialog] = useState<{ open: boolean; league: League | null }>({ open: false, league: null });
  const [seasonDialog, setSeasonDialog] = useState<{ open: boolean; league: League | null; season: Season | null }>({ open: false, league: null, season: null });
  const today = todayIsoDate();

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{t("Points are awarded when a tournament's results are finalized.")}</p>
        {manage && (
          <Button onClick={() => setLeagueDialog({ open: true, league: null })}>
            <Plus /> {t("New league")}
          </Button>
        )}
      </div>
      {leagues.isError && <QueryError error={leagues.error} onRetry={() => void leagues.refetch()} />}
      {leagues.isLoading ? (
        <Skeleton className="h-48" />
      ) : (leagues.data ?? []).length === 0 ? (
        <EmptyState
          icon={<Trophy />}
          title={t("No leagues yet")}
          description={t("Create a score rule, then a league with a season, and assign tournaments to the season.")}
          action={
            manage && (
              <Button onClick={() => setLeagueDialog({ open: true, league: null })}>
                <Plus /> {t("New league")}
              </Button>
            )
          }
        />
      ) : (
        leagues.data?.map((l) => {
          const rule = rules.data?.find((r) => r.id === l.scoreRuleId);
          return (
            <Card key={l.id}>
              <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
                <div className="grid gap-1">
                  <CardTitle className="flex flex-wrap items-center gap-2">
                    {l.name}
                    {l.status !== "ACTIVE" && <Badge variant="muted">{t("Archived")}</Badge>}
                  </CardTitle>
                  <CardDescription>
                    {t("Score rule")}: {rule?.name ?? "—"} · {l.bestResultsCount ? t("best {n} results count", { n: l.bestResultsCount }) : t("all results count")}
                  </CardDescription>
                  {l.description && <p className="text-sm text-muted-foreground">{l.description}</p>}
                </div>
                {manage && (
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setLeagueDialog({ open: true, league: l })}>
                      <Pencil /> {t("Edit")}
                    </Button>
                    <Button size="sm" onClick={() => setSeasonDialog({ open: true, league: l, season: null })}>
                      <Plus /> {t("Add season")}
                    </Button>
                  </div>
                )}
              </CardHeader>
              <CardContent>
                {l.seasons.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("No seasons yet.")}</p>
                ) : (
                  <Table>
                    <THead>
                      <Tr>
                        <Th>{t("Season")}</Th>
                        <Th>{t("Dates")}</Th>
                        <Th className="w-0" />
                      </Tr>
                    </THead>
                    <TBody>
                      {l.seasons.map((s) => {
                        const current = s.startsOn <= today && today <= s.endsOn;
                        return (
                          <Tr key={s.id}>
                            <Td>
                              <Link href={`/admin/leagues/seasons/${s.id}`} className="-my-2 inline-flex min-h-9 min-w-8 items-center py-2 font-medium hover:underline">
                                {s.name}
                              </Link>
                              {current && (
                                <Badge variant="success" className="ml-2">
                                  {t("Current")}
                                </Badge>
                              )}
                            </Td>
                            <Td className="whitespace-nowrap tabular-nums text-muted-foreground">
                              {fmt.date(s.startsOn)} – {fmt.date(s.endsOn)}
                            </Td>
                            <Td className="whitespace-nowrap">
                              <div className="flex gap-1">
                                <Button asChild variant="outline" size="sm">
                                  <Link href={`/admin/leagues/seasons/${s.id}`}>
                                    <ListOrdered /> {t("Leaderboard")}
                                  </Link>
                                </Button>
                                {manage && (
                                  <Button variant="ghost" size="sm" aria-label={t("Edit season")} onClick={() => setSeasonDialog({ open: true, league: l, season: s })}>
                                    <Pencil />
                                  </Button>
                                )}
                              </div>
                            </Td>
                          </Tr>
                        );
                      })}
                    </TBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          );
        })
      )}
      <LeagueDialog open={leagueDialog.open} onOpenChange={(o) => setLeagueDialog((d) => ({ ...d, open: o }))} league={leagueDialog.league} />
      <SeasonDialog open={seasonDialog.open} onOpenChange={(o) => setSeasonDialog((d) => ({ ...d, open: o }))} league={seasonDialog.league} season={seasonDialog.season} />
    </div>
  );
}

// --- score rules -------------------------------------------------------------------------------------------------

function ScoreRulesTab() {
  const t = useT();
  const fmt = useFormat();
  const can = useCan();
  const rules = useScoreRules();
  const leagues = useLeagues();
  const manage = can("league.manage");
  const [dialog, setDialog] = useState<{ open: boolean; rule: ScoreRule | null }>({ open: false, rule: null });
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{t("A points table per place, or a formula based on field size and finishing place.")}</p>
        {manage && (
          <Button onClick={() => setDialog({ open: true, rule: null })}>
            <Plus /> {t("New score rule")}
          </Button>
        )}
      </div>
      {!manage && <Alert>{t("You can view score rules; changing them requires league management rights.")}</Alert>}
      {rules.isError && <QueryError error={rules.error} onRetry={() => void rules.refetch()} />}
      {rules.isLoading ? (
        <TableSkeleton />
      ) : (rules.data ?? []).length === 0 ? (
        <EmptyState icon={<Calculator />} title={t("No score rules yet")} />
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>{t("Name")}</Th>
              <Th>{t("Type")}</Th>
              <Th className="hidden md:table-cell">{t("Rule")}</Th>
              <Th className="hidden sm:table-cell">{t("Used by")}</Th>
              <Th className="w-0" />
            </Tr>
          </THead>
          <TBody>
            {rules.data?.map((r) => {
              const used = leagues.data?.filter((l) => l.scoreRuleId === r.id) ?? [];
              return (
                <Tr key={r.id}>
                  <Td className="font-medium">
                    {r.name}
                    <div className="text-xs text-muted-foreground">{fmt.date(r.updatedAt)}</div>
                  </Td>
                  <Td>
                    <Badge variant="secondary">{r.kind === "FORMULA" ? t("Formula") : t("Points table")}</Badge>
                  </Td>
                  <Td className={r.kind === "FORMULA" ? "hidden max-w-md truncate font-mono text-xs md:table-cell" : "hidden max-w-md truncate text-xs tabular-nums md:table-cell"}>{ruleSummary(r, t)}</Td>
                  <Td className="hidden text-sm text-muted-foreground sm:table-cell">{used.length ? used.map((l) => l.name).join(", ") : "—"}</Td>
                  <Td>
                    {manage && (
                      <Button variant="ghost" size="sm" onClick={() => setDialog({ open: true, rule: r })}>
                        <Pencil /> <span className="hidden sm:inline">{t("Edit")}</span>
                      </Button>
                    )}
                  </Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      )}
      <ScoreRuleDialog open={dialog.open} onOpenChange={(o) => setDialog((d) => ({ ...d, open: o }))} rule={dialog.rule} />
    </div>
  );
}

// --- series ---------------------------------------------------------------------------------------------------------

function SeriesTab() {
  const t = useT();
  const fmt = useFormat();
  const can = useCan();
  const series = useSeries();
  const leagues = useLeagues();
  const manage = can("league.manage");
  const [dialog, setDialog] = useState<{ open: boolean; series: Series | null }>({ open: false, series: null });
  const seasonName = (id: string | null) => {
    for (const l of leagues.data ?? []) {
      const s = l.seasons.find((x) => x.id === id);
      if (s) return `${l.name} — ${s.name}`;
    }
    return null;
  };
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{t("Group related tournaments, e.g. a festival week.")}</p>
        {manage && (
          <Button onClick={() => setDialog({ open: true, series: null })}>
            <Plus /> {t("New series")}
          </Button>
        )}
      </div>
      {series.isError && <QueryError error={series.error} onRetry={() => void series.refetch()} />}
      {series.isLoading ? (
        <TableSkeleton />
      ) : (series.data ?? []).length === 0 ? (
        <EmptyState icon={<BarChart3 />} title={t("No series yet")} />
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>{t("Name")}</Th>
              <Th className="hidden sm:table-cell">{t("Season")}</Th>
              <Th>{t("Dates")}</Th>
              <Th className="w-0" />
            </Tr>
          </THead>
          <TBody>
            {series.data?.map((s) => (
              <Tr key={s.id}>
                <Td className="font-medium">{s.name}</Td>
                <Td className="hidden text-muted-foreground sm:table-cell">{seasonName(s.seasonId) ?? "—"}</Td>
                <Td className="whitespace-nowrap tabular-nums text-muted-foreground">{s.startsOn || s.endsOn ? `${fmt.date(s.startsOn)} – ${fmt.date(s.endsOn)}` : "—"}</Td>
                <Td>
                  {manage && (
                    <Button variant="ghost" size="sm" onClick={() => setDialog({ open: true, series: s })}>
                      <Pencil /> <span className="hidden sm:inline">{t("Edit")}</span>
                    </Button>
                  )}
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
      <SeriesDialog open={dialog.open} onOpenChange={(o) => setDialog((d) => ({ ...d, open: o }))} series={dialog.series} />
    </div>
  );
}
