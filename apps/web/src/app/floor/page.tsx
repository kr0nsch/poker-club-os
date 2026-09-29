"use client";

import { EmptyState, Skeleton } from "@pcos/ui";
import type { TournamentSummaryView } from "@pcos/types";
import { useQuery } from "@tanstack/react-query";
import { Trophy } from "lucide-react";
import Link from "next/link";
import { FloorHeader } from "@/components/floor/floor-header";
import { StatusBadge } from "@/components/status";
import { get } from "@/lib/api";
import { useFormat, useT } from "@/lib/i18n";

export default function FloorPicker() {
  const t = useT();
  const fmt = useFormat();
  const list = useQuery({
    queryKey: ["tournaments", "floor"],
    queryFn: () => get<TournamentSummaryView[]>("/api/v1/tournaments?status=DRAFT,SCHEDULED,REGISTRATION_OPEN,SEATING,RUNNING,BREAK,PAUSED,HAND_FOR_HAND,FINISHED&limit=50"),
    refetchInterval: 15_000,
  });
  const items = (list.data ?? []).slice().sort((a, b) => {
    const live = (s: string) => (["RUNNING", "BREAK", "PAUSED", "HAND_FOR_HAND", "SEATING"].includes(s) ? 0 : s === "REGISTRATION_OPEN" ? 1 : 2);
    return live(a.status) - live(b.status) || a.startAt.localeCompare(b.startAt);
  });
  return (
    <div className="min-h-dvh">
      <FloorHeader back="/admin" width="max-w-3xl" title={<span className="font-semibold">{t("Floor control")}</span>} />
      <main className="mx-auto grid max-w-3xl gap-3 p-4">
        {list.isLoading && <Skeleton className="h-20" />}
        {list.data && items.length === 0 && <EmptyState icon={<Trophy />} title={t("No tournaments to run")} description={t("Create a tournament in the back office first.")} />}
        {items.map((x) => (
          <Link key={x.id} href={`/floor/${x.id}`} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:bg-accent">
            <div className="min-w-0">
              <div className="truncate text-lg font-semibold">{x.name}</div>
              <div className="text-sm text-muted-foreground">
                {fmt.dateTime(x.startAt)} · {x.registrationCount}
                {x.maxPlayers ? `/${x.maxPlayers}` : ""} {t("registered")}
              </div>
            </div>
            <StatusBadge status={x.status} />
          </Link>
        ))}
      </main>
    </div>
  );
}
