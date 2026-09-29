"use client";

import { EmptyState, Skeleton } from "@pcos/ui";
import type { TournamentSummaryView } from "@pcos/types";
import { useQuery } from "@tanstack/react-query";
import { Trophy } from "lucide-react";
import { DashSection, LIVE_STATUSES, LiveTournamentTile, Schedule } from "@/components/admin-dashboard";
import { FloorHeader } from "@/components/floor/floor-header";
import { get } from "@/lib/api";
import { useT } from "@/lib/i18n";

/** Floor entry point: running tournaments as live tiles first, everything else by day below. */
export default function FloorPicker() {
  const t = useT();
  const list = useQuery({
    queryKey: ["tournaments", "floor"],
    queryFn: () => get<TournamentSummaryView[]>("/api/v1/tournaments?status=DRAFT,SCHEDULED,REGISTRATION_OPEN,SEATING,RUNNING,BREAK,PAUSED,HAND_FOR_HAND,FINISHED&limit=50"),
    refetchInterval: 15_000,
  });
  const items = list.data ?? [];
  const live = items.filter((x) => LIVE_STATUSES.includes(x.status));
  const rest = items.filter((x) => !LIVE_STATUSES.includes(x.status));
  return (
    <div className="min-h-dvh">
      <FloorHeader back="/admin" width="max-w-6xl" title={<span className="font-semibold">{t("Floor control")}</span>} />
      <main className="mx-auto grid max-w-6xl gap-8 p-4 md:p-6">
        {list.isLoading && <Skeleton className="h-56 rounded-xl" />}
        {list.data && items.length === 0 && <EmptyState icon={<Trophy />} title={t("No tournaments to run")} description={t("Create a tournament in the back office first.")} />}
        {live.length > 0 && (
          <DashSection title={t("In play now")}>
            <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(100%,24rem),1fr))]">
              {live.map((x) => (
                <LiveTournamentTile key={x.id} tour={x} />
              ))}
            </div>
          </DashSection>
        )}
        {rest.length > 0 && (
          <DashSection title={t("Schedule")}>
            <Schedule tournaments={rest} href={(x) => `/floor/${x.id}`} />
          </DashSection>
        )}
      </main>
    </div>
  );
}
