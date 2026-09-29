"use client";

import { Alert, Badge, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from "@pcos/ui";
import { ClipboardCheck, History, LayoutGrid, Megaphone, Trophy, Users } from "lucide-react";
import { useParams } from "next/navigation";
import { useState } from "react";
import { ActionsLog } from "@/components/floor/actions-log";
import { AnnouncementsPanel } from "@/components/floor/announcements-panel";
import { ClockPanel } from "@/components/floor/clock-panel";
import { EntriesView } from "@/components/floor/entries-view";
import { FloorHeader } from "@/components/floor/floor-header";
import { FloorProvider } from "@/components/floor/floor-context";
import { FloorRequests } from "@/components/floor/floor-requests";
import { RegistrationDesk } from "@/components/floor/registration-desk";
import { ResultsPanel } from "@/components/floor/results-panel";
import { TablesView } from "@/components/floor/tables-view";
import { StatusBadge } from "@/components/status";
import { useT } from "@/lib/i18n";
import { errorMessage, useTournamentSnapshot } from "@/lib/queries";

export default function FloorConsole() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const snap = useTournamentSnapshot(id);
  const status = snap.data?.tournament.status;
  const [tab, setTab] = useState<string | null>(null);
  const defaultTab = status && ["DRAFT", "SCHEDULED", "REGISTRATION_OPEN"].includes(status) ? "registration" : status === "FINISHED" || status === "FINALIZED" ? "results" : "tables";
  const current = tab ?? defaultTab;

  if (snap.isLoading || !snap.data) {
    return (
      <div className="min-h-dvh">
        <FloorHeader back="/floor" title={<Skeleton className="h-5 w-48" />} />
        <main className="grid gap-4 p-4">
          {snap.error ? <Alert variant="destructive">{errorMessage(snap.error)}</Alert> : <Skeleton className="h-64" />}
        </main>
      </div>
    );
  }
  const s = snap.data;
  const unseated = s.entries.filter((e) => e.status === "ACTIVE" && !e.tableId).length;
  const waitlisted = s.registrations.filter((r) => r.status === "WAITLISTED").length;
  const tabs = [
    ["tables", LayoutGrid, t("Tables"), unseated],
    ["registration", ClipboardCheck, t("Registration desk"), waitlisted],
    ["players", Users, t("Players"), 0],
    ["actions", History, t("Actions"), 0],
    ["announce", Megaphone, t("Announcements"), 0],
    ["results", Trophy, t("Results"), 0],
  ] as const;
  return (
    <FloorProvider snapshot={s}>
      <div className="min-h-dvh">
        <FloorHeader
          back="/floor"
          title={
            <>
              <span className="truncate text-base font-semibold">{s.tournament.name}</span>
              <StatusBadge status={s.tournament.status} />
              <span className="hidden text-xs text-muted-foreground sm:inline">v{s.tournament.version}</span>
            </>
          }
        />
        {/*
          Phones and tablets up to 1120 px: one column. Wider, the clock and its controls sit in a sticky left column,
          so they stay in reach while the floor works the tables on the right. minmax(0,1fr) keeps wide rows
          (tabs, table grid) scrolling inside themselves instead of widening the page.
        */}
        <main className="mx-auto grid max-w-[120rem] grid-cols-[minmax(0,1fr)] gap-4 p-3 md:p-4 min-[1120px]:grid-cols-[25rem_minmax(0,1fr)] min-[1120px]:items-start 2xl:grid-cols-[28rem_minmax(0,1fr)] 2xl:px-6">
          <aside className="min-[1120px]:sticky min-[1120px]:top-[4.5rem] min-[1120px]:max-h-[calc(100dvh-5.5rem)] min-[1120px]:overflow-y-auto min-[1120px]:overscroll-contain">
            <ClockPanel />
          </aside>
          <div className="@container grid grid-cols-[minmax(0,1fr)] content-start gap-4">
            <FloorRequests />
            <Tabs value={current} onValueChange={setTab}>
              {/* Phones: a 3×2 grid of icon-over-label tabs, all visible. Tablets and up: one underlined row. */}
              <TabsList className="grid h-auto w-full grid-cols-3 gap-0 sm:flex sm:h-12 sm:justify-start sm:gap-1 sm:overflow-x-auto 2xl:gap-4">
                {tabs.map(([value, Icon, label, count]) => (
                  <TabsTrigger key={value} value={value} className="h-auto flex-col gap-1 py-2 text-xs sm:h-10 sm:flex-row sm:gap-1.5 sm:px-3 sm:py-0 sm:text-sm lg:px-2.5 2xl:px-4">
                    <span className="relative">
                      <Icon className="size-5 sm:size-4" />
                      {count > 0 && (
                        <Badge variant="warning" className="absolute -right-3 -top-2 px-1 sm:hidden">
                          {count}
                        </Badge>
                      )}
                    </span>
                    <span className="max-w-full truncate">{label}</span>
                    {count > 0 && (
                      <Badge variant="warning" className="max-sm:hidden">
                        {count}
                      </Badge>
                    )}
                  </TabsTrigger>
                ))}
              </TabsList>
              <TabsContent value="tables">
                <TablesView />
              </TabsContent>
              <TabsContent value="registration">
                <RegistrationDesk />
              </TabsContent>
              <TabsContent value="players">
                <EntriesView />
              </TabsContent>
              <TabsContent value="actions">
                <ActionsLog />
              </TabsContent>
              <TabsContent value="announce">
                <AnnouncementsPanel />
              </TabsContent>
              <TabsContent value="results">
                <ResultsPanel />
              </TabsContent>
            </Tabs>
          </div>
        </main>
      </div>
    </FloorProvider>
  );
}
