"use client";

import { Badge, Button, EmptyState, Input, PageHeader, Select, Table, TBody, Td, Th, THead, Tr, Tabs, TabsList, TabsTrigger } from "@pcos/ui";
import { TOURNAMENT_STATUSES, topic, type TournamentStatus, type TournamentSummaryView } from "@pcos/types";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Plus, Search, Tablet, Trophy } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CreateFromTemplateDialog } from "@/components/admin-config/create-from-template-dialog";
import { FORMAT_LABEL, GAME_TYPE_LABEL, TOURNAMENT_STATUS_LABEL, VISIBILITY_LABEL } from "@/components/admin-config/labels";
import { cfgKeys, useTemplates, useVenues } from "@/components/admin-config/queries";
import { Pager, QueryError, TableSkeleton, useDebounced } from "@/components/admin-config/ui";
import { useCan, useStaff } from "@/components/staff-guard";
import { StatusBadge } from "@/components/status";
import { get, qs } from "@/lib/api";
import { useFormat, useT } from "@/lib/i18n";
import { useTopicEvents } from "@/lib/realtime-context";

const GROUPS: Record<string, { label: string; statuses: TournamentStatus[] | null }> = {
  all: { label: "All", statuses: null },
  upcoming: { label: "Upcoming", statuses: ["DRAFT", "SCHEDULED", "REGISTRATION_OPEN"] },
  live: { label: "Live", statuses: ["SEATING", "RUNNING", "BREAK", "PAUSED", "HAND_FOR_HAND"] },
  finished: { label: "Finished", statuses: ["FINISHED", "FINALIZED"] },
  cancelled: { label: "Cancelled", statuses: ["CANCELLED"] },
};

const PAGE = 50;

export default function TournamentsPage() {
  const t = useT();
  const fmt = useFormat();
  const can = useCan();
  const me = useStaff();
  const router = useRouter();
  const qc = useQueryClient();
  const venues = useVenues();
  const templates = useTemplates();

  // "group:<key>" or "status:<STATUS>"
  const [filter, setFilter] = useState("group:all");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [venueId, setVenueId] = useState("");
  const [offset, setOffset] = useState(0);
  const [fromTemplate, setFromTemplate] = useState(false);
  const term = useDebounced(search.trim().toLowerCase(), 250);

  const statuses = filter.startsWith("group:") ? GROUPS[filter.slice(6)]?.statuses : [filter.slice(7) as TournamentStatus];
  const params = {
    status: statuses?.join(",") || undefined,
    venueId: venueId || undefined,
    from: from ? new Date(`${from}T00:00`).toISOString() : undefined,
    to: to ? new Date(`${to}T23:59:59`).toISOString() : undefined,
    // The API has no text search: while searching, scan the 200 most recent matches.
    limit: term ? 200 : PAGE,
    offset: term ? 0 : offset,
  };
  const list = useQuery({
    queryKey: cfgKeys.tournamentList(params),
    queryFn: () => get<TournamentSummaryView[]>(`/api/v1/tournaments${qs(params)}`),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });

  // Live refresh when tournaments change on any venue of the organisation.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  useTopicEvents([me.organization ? topic.organization(me.organization.id) : null, ...(venues.data ?? []).map((v) => topic.venue(v.id))], (e) => {
    if (e.name !== "tournament.updated") return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void qc.invalidateQueries({ queryKey: cfgKeys.tournaments }), 500);
  });

  const rows = (list.data ?? []).filter((r) => !term || r.name.toLowerCase().includes(term) || r.slug.includes(term));
  const venueName = (id: string) => venues.data?.find((v) => v.id === id)?.name;
  const resetPage = () => setOffset(0);

  return (
    <div>
      <PageHeader
        title={t("Tournaments")}
        description={t("Schedule, configure and publish tournaments.")}
        actions={
          can("tournament.create") && (
            <>
              {(templates.data?.length ?? 0) > 0 && (
                <Button variant="outline" onClick={() => setFromTemplate(true)}>
                  <Copy /> {t("From template")}
                </Button>
              )}
              <Button asChild>
                <Link href="/admin/tournaments/new">
                  <Plus /> {t("New tournament")}
                </Link>
              </Button>
            </>
          )
        }
      />

      <div className="mb-4 grid gap-3">
        <Tabs
          value={filter.startsWith("group:") ? filter : ""}
          onValueChange={(v) => {
            setFilter(v);
            resetPage();
          }}
        >
          <TabsList>
            {Object.entries(GROUPS).map(([key, g]) => (
              <TabsTrigger key={key} value={`group:${key}`}>
                {t(g.label)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("Search by name")} className="pl-9" aria-label={t("Search by name")} />
          </div>
          <Select
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              resetPage();
            }}
            aria-label={t("Status")}
          >
            <optgroup label={t("Groups")}>
              {Object.entries(GROUPS).map(([key, g]) => (
                <option key={key} value={`group:${key}`}>
                  {key === "all" ? t("All statuses") : t(g.label)}
                </option>
              ))}
            </optgroup>
            <optgroup label={t("Status")}>
              {TOURNAMENT_STATUSES.map((s) => (
                <option key={s} value={`status:${s}`}>
                  {t(TOURNAMENT_STATUS_LABEL[s])}
                </option>
              ))}
            </optgroup>
          </Select>
          <Input
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              resetPage();
            }}
            aria-label={t("From date")}
            title={t("From date")}
          />
          <Input
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              resetPage();
            }}
            aria-label={t("To date")}
            title={t("To date")}
          />
          {(venues.data?.length ?? 0) > 1 ? (
            <Select
              value={venueId}
              onChange={(e) => {
                setVenueId(e.target.value);
                resetPage();
              }}
              aria-label={t("Venue")}
            >
              <option value="">{t("All venues")}</option>
              {venues.data?.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </Select>
          ) : (
            (from || to || search || filter !== "group:all") && (
              <Button
                variant="ghost"
                onClick={() => {
                  setFilter("group:all");
                  setSearch("");
                  setFrom("");
                  setTo("");
                  resetPage();
                }}
              >
                {t("Clear filters")}
              </Button>
            )
          )}
        </div>
        {term && <p className="text-xs text-muted-foreground">{t("Searching the 200 most recent tournaments that match the filters.")}</p>}
      </div>

      {list.isError && <QueryError error={list.error} onRetry={() => void list.refetch()} className="mb-4" />}
      {list.isLoading ? (
        <TableSkeleton rows={6} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Trophy />}
          title={t("No tournaments found")}
          description={term || from || to || filter !== "group:all" ? t("Try different filters.") : t("Create the first tournament to get started.")}
          action={
            can("tournament.create") && (
              <Button asChild>
                <Link href="/admin/tournaments/new">
                  <Plus /> {t("New tournament")}
                </Link>
              </Button>
            )
          }
        />
      ) : (
        <div className="grid gap-3">
          <Table>
            <THead>
              <Tr>
                <Th>{t("Start")}</Th>
                <Th>{t("Tournament")}</Th>
                <Th>{t("Status")}</Th>
                <Th className="hidden md:table-cell">{t("Buy-in")}</Th>
                <Th className="text-right">{t("Players")}</Th>
                <Th className="w-0" />
              </Tr>
            </THead>
            <TBody>
              {rows.map((r) => (
                <Tr key={r.id} className="cursor-pointer" onClick={() => router.push(`/admin/tournaments/${r.id}`)}>
                  <Td className="whitespace-nowrap tabular-nums">{fmt.dateTime(r.startAt)}</Td>
                  <Td className="min-w-48">
                    <Link href={`/admin/tournaments/${r.id}`} className="-my-2 inline-flex min-h-9 min-w-8 items-center py-2 font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
                      {r.name}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {t(FORMAT_LABEL[r.format])} · {t(GAME_TYPE_LABEL[r.gameType])}
                      {(venues.data?.length ?? 0) > 1 && venueName(r.venueId) ? ` · ${venueName(r.venueId)}` : ""}
                    </div>
                  </Td>
                  <Td>
                    <div className="flex flex-wrap items-center gap-1">
                      <StatusBadge status={r.status} />
                      {r.publicVisibility !== "PUBLIC" && <Badge variant="outline">{t(VISIBILITY_LABEL[r.publicVisibility])}</Badge>}
                    </div>
                  </Td>
                  <Td className="hidden whitespace-nowrap tabular-nums md:table-cell">
                    {r.buyIn ? (
                      <>
                        {fmt.money(r.buyIn.amount, r.buyIn.currency)}
                        {r.buyIn.fee > 0 && <span className="text-muted-foreground"> + {fmt.money(r.buyIn.fee, r.buyIn.currency)}</span>}
                      </>
                    ) : (
                      <span className="text-muted-foreground">{t("Free")}</span>
                    )}
                  </Td>
                  <Td className="text-right tabular-nums">
                    {fmt.number(r.registrationCount)}
                    {r.maxPlayers ? <span className="text-muted-foreground">/{fmt.number(r.maxPlayers)}</span> : null}
                  </Td>
                  <Td onClick={(e) => e.stopPropagation()}>
                    <Button asChild variant="ghost" size="sm" title={t("Floor control")}>
                      <Link href={`/floor/${r.id}`}>
                        <Tablet /> <span className="hidden lg:inline">{t("Floor")}</span>
                      </Link>
                    </Button>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
          {!term && <Pager offset={offset} limit={PAGE} count={list.data?.length ?? 0} onChange={setOffset} />}
        </div>
      )}

      <CreateFromTemplateDialog open={fromTemplate} onOpenChange={setFromTemplate} />
    </div>
  );
}
