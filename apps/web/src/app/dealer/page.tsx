"use client";

import { Button, Card, EmptyState, Skeleton } from "@pcos/ui";
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
      <FloorHeader back="/" title={<span className="font-semibold">{t("Dealer")}</span>} />
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
          <Card className="p-4">
            <div className="mb-3 font-medium">{t("Choose your table")}</div>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
              {snap.data.tables
                .filter((x) => x.status !== "CLOSED")
                .map((table) => (
                  <Button key={table.id} asChild size="xl" variant="secondary" className="h-24 flex-col text-2xl">
                    <Link href={`/dealer/${selected}/${table.id}`}>
                      {table.tableNumber}
                      <span className="text-xs font-normal text-muted-foreground">
                        {table.occupied}/{table.capacity}
                      </span>
                    </Link>
                  </Button>
                ))}
            </div>
          </Card>
        )}
      </main>
    </div>
  );
}
