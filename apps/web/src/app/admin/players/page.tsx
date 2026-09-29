"use client";

import { Badge, Button, EmptyState, Input, PageHeader, Select, Skeleton, Table, TBody, Td, Th, THead, Tr } from "@pcos/ui";
import { PLAYER_STATUSES } from "@pcos/types";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Download, KeyRound, Search, Upload, UserCheck, UserPlus, Users } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { PLAYER_STATUS_LABEL, PLAYER_STATUS_TONE } from "@/components/admin-config/labels";
import { NewPlayerDialog } from "@/components/admin-config/player-form";
import { cfgKeys, usePlayerTags } from "@/components/admin-config/queries";
import type { PlayerSearchResult } from "@/components/admin-config/types";
import { Pager, QueryError, TableSkeleton, useDebounced } from "@/components/admin-config/ui";
import { useCan } from "@/components/staff-guard";
import { get, qs } from "@/lib/api";
import { useFormat, useT } from "@/lib/i18n";

const PAGE = 50;

export default function PlayersPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <PlayersList />
    </Suspense>
  );
}

function PlayersList() {
  const t = useT();
  const fmt = useFormat();
  const can = useCan();
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const tags = usePlayerTags();
  const [newOpen, setNewOpen] = useState(false);

  // Filters live in the URL so "back" from a profile restores the list.
  const [search, setSearch] = useState(sp.get("q") ?? "");
  const q = useDebounced(search.trim(), 300);
  const tag = sp.get("tag") ?? "";
  const status = sp.get("status") ?? "";
  const offset = Math.max(0, Number(sp.get("offset") ?? 0) || 0);
  const setParams = (patch: Record<string, string | number | null>) => {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "" || v === 0) p.delete(k);
      else p.set(k, String(v));
    }
    const s = p.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  };
  useEffect(() => {
    if (q !== (sp.get("q") ?? "")) setParams({ q, offset: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const params = { q: q || undefined, tag: tag || undefined, status: status || undefined, limit: PAGE, offset };
  const list = useQuery({
    queryKey: cfgKeys.playerList(params),
    queryFn: () => get<PlayerSearchResult>(`/api/v1/players${qs(params)}`),
    placeholderData: keepPreviousData,
  });
  const filtered = !!(q || tag || status);

  return (
    <div>
      <PageHeader
        title={t("Players")}
        description={list.data ? t("{n} players", { n: fmt.number(list.data.total) }) : t("Player database of the club.")}
        actions={
          <>
            {can("player.import") && (
              <Button asChild variant="outline">
                <Link href="/admin/players/import">
                  <Upload /> {t("Import CSV")}
                </Link>
              </Button>
            )}
            {can("player.export") && (
              <Button asChild variant="outline">
                <a href="/api/v1/exports/players.csv" download>
                  <Download /> {t("Export CSV")}
                </a>
              </Button>
            )}
            {can("player.create") && (
              <Button onClick={() => setNewOpen(true)}>
                <UserPlus /> {t("New player")}
              </Button>
            )}
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("Name, nickname, phone, email or member number")} className="pl-9" aria-label={t("Search players")} autoFocus />
        </div>
        <Select value={tag} onChange={(e) => setParams({ tag: e.target.value, offset: null })} aria-label={t("Tag")}>
          <option value="">{t("All tags")}</option>
          {tags.data?.map((x) => (
            <option key={x.id} value={x.name}>
              {x.name}
            </option>
          ))}
        </Select>
        <Select value={status} onChange={(e) => setParams({ status: e.target.value, offset: null })} aria-label={t("Status")}>
          <option value="">{t("All except merged")}</option>
          {PLAYER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(PLAYER_STATUS_LABEL[s])}
            </option>
          ))}
        </Select>
      </div>

      {list.isError && <QueryError error={list.error} onRetry={() => void list.refetch()} className="mb-4" />}
      {list.isLoading ? (
        <TableSkeleton rows={8} />
      ) : (list.data?.items.length ?? 0) === 0 ? (
        <EmptyState
          icon={<Users />}
          title={filtered ? t("No players match") : t("No players yet")}
          description={filtered ? t("Try a shorter search or other filters.") : t("Add players one by one or import them from a CSV file.")}
          action={
            !filtered &&
            can("player.create") && (
              <Button onClick={() => setNewOpen(true)}>
                <UserPlus /> {t("New player")}
              </Button>
            )
          }
        />
      ) : (
        <div className={list.isPlaceholderData ? "grid gap-3 opacity-70" : "grid gap-3"}>
          <Table>
            <THead>
              <Tr>
                <Th>{t("Player")}</Th>
                <Th className="hidden md:table-cell">{t("Member / ID")}</Th>
                <Th className="hidden lg:table-cell">{t("Contact")}</Th>
                <Th className="hidden sm:table-cell">{t("Tags")}</Th>
                <Th>{t("Status")}</Th>
              </Tr>
            </THead>
            <TBody>
              {list.data?.items.map((p) => (
                <Tr key={p.id} className="cursor-pointer" onClick={() => router.push(`/admin/players/${p.id}`)}>
                  <Td>
                    <Link href={`/admin/players/${p.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
                      {p.displayName}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {p.firstName} {p.lastName}
                      {p.nickname && p.nickname !== p.displayName ? ` · “${p.nickname}”` : ""}
                    </div>
                  </Td>
                  <Td className="hidden md:table-cell">
                    <div className="font-mono text-sm">{p.memberNumber ?? "—"}</div>
                    <div className="font-mono text-xs text-muted-foreground">{p.externalPublicId}</div>
                  </Td>
                  <Td className="hidden lg:table-cell">
                    <div className="text-sm">{p.phone ?? ""}</div>
                    <div className="text-xs text-muted-foreground">{p.email ?? ""}</div>
                  </Td>
                  <Td className="hidden sm:table-cell">
                    <div className="flex max-w-64 flex-wrap gap-1">
                      {p.tags.map((x) => (
                        <Badge key={x.id} variant="secondary">
                          {x.name}
                        </Badge>
                      ))}
                    </div>
                  </Td>
                  <Td>
                    <div className="flex items-center gap-1.5">
                      <Badge variant={PLAYER_STATUS_TONE[p.status]}>{t(PLAYER_STATUS_LABEL[p.status])}</Badge>
                      {p.hasKioskPin && <KeyRound className="size-3.5 text-muted-foreground" aria-label={t("Kiosk PIN set")} />}
                      {p.hasAccount && <UserCheck className="size-3.5 text-muted-foreground" aria-label={t("Has a player account")} />}
                    </div>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
          <Pager offset={offset} limit={PAGE} count={list.data?.items.length ?? 0} total={list.data?.total} onChange={(o) => setParams({ offset: o })} />
        </div>
      )}

      <NewPlayerDialog open={newOpen} onOpenChange={setNewOpen} onCreated={(p) => router.push(`/admin/players/${p.id}`)} />
    </div>
  );
}
