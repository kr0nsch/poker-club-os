"use client";

import { Button, EmptyState, Skeleton } from "@pcos/ui";
import type { TournamentSummaryView } from "@pcos/types";
import { useQuery } from "@tanstack/react-query";
import { LayoutGrid } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { FloorHeader } from "@/components/floor/floor-header";
import { StatusBadge } from "@/components/status";
import { get } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useTournamentSnapshot } from "@/lib/queries";

/** Dealer tablet: pick the running tournament and the table you deal. */
export default function DealerPicker() {
  const t = useT();
  const [tid, setTid] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ["tournaments", "dealer"],
    queryFn: () => get<TournamentSummaryView[]>("/api/v1/tournaments?status=SEATING,RUNNING,BREAK,PAUSED,HAND_FOR_HAND&limit=20"),
    refetchInterval: 20_000,
  });
  const selected = tid ?? (list.data?.length === 1 ? list.data[0]!.id : null);
  const snap = useTournamentSnapshot(selected);
  return (
    <div className="min-h-dvh">
      <FloorHeader back="/" width="max-w-3xl" title={<span className="font-semibold">{t("Dealer")}</span>} />
      <main className="mx-auto grid max-w-3xl gap-4 p-4">
        {list.isLoading && <Skeleton className="h-20" />}
        {list.data?.length === 0 && <EmptyState icon={<LayoutGrid />} title={t("No running tournament")} description={t("Tables appear here once seating has started.")} />}
        {list.data && list.data.length > 1 && (
          <div className="grid gap-2">
            {list.data.map((x) => (
              <Button key={x.id} size="xl" variant={x.id === selected ? "default" : "secondary"} className="justify-between" onClick={() => setTid(x.id)}>
                <span className="truncate">{x.name}</span>
                <StatusBadge status={x.status} />
              </Button>
            ))}
          </div>
        )}
        {selected && snap.data && (
          <section className="grid gap-3">
            <h2 className="text-lg font-semibold tracking-tight">{t("Choose your table")}</h2>
            {/* Big square targets: the table number reads from arm's length, with how full it is below. */}
            <div className="grid grid-cols-2 gap-3 min-[480px]:grid-cols-3 sm:grid-cols-4">
              {snap.data.tables
                .filter((x) => x.status !== "CLOSED")
                .map((table) => (
                  <Link
                    key={table.id}
                    href={`/dealer/${selected}/${table.id}`}
                    className="edge-light group grid aspect-square content-between rounded-xl border border-border bg-card p-4 transition-colors hover:border-border-strong hover:bg-accent/40 active:bg-accent"
                  >
                    <span className="text-sm text-muted-foreground">{t("Table")}</span>
                    <span className="text-6xl font-semibold leading-none tabular-nums">{table.tableNumber}</span>
                    <span className="grid gap-1.5">
                      <span className="text-sm tabular-nums text-muted-foreground">
                        {table.occupied} / {table.capacity}
                      </span>
                      <span className="h-1 overflow-hidden rounded-full bg-muted">
                        <span className="block h-full w-full origin-left bg-gold/80" style={{ transform: `scaleX(${table.capacity ? table.occupied / table.capacity : 0})` }} />
                      </span>
                    </span>
                  </Link>
                ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
