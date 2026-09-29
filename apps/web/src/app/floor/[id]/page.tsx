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
        {/* minmax(0,1fr): a wide row (tabs, table grid) scrolls inside itself instead of widening the page. */}
        <main className="mx-auto grid max-w-[1600px] grid-cols-[minmax(0,1fr)] gap-4 p-3 md:p-4">
          <ClockPanel />
          <FloorRequests />
          <Tabs value={current} onValueChange={setTab}>
            <TabsList className="h-12 w-full justify-start overflow-x-auto">
              <TabsTrigger value="tables" className="h-10 px-4">
                <LayoutGrid className="size-4" /> {t("Tables")}
                {unseated > 0 && <Badge variant="warning">{unseated}</Badge>}
              </TabsTrigger>
              <TabsTrigger value="registration" className="h-10 px-4">
                <ClipboardCheck className="size-4" /> {t("Registration desk")}
                {waitlisted > 0 && <Badge variant="warning">{waitlisted}</Badge>}
              </TabsTrigger>
              <TabsTrigger value="players" className="h-10 px-4">
                <Users className="size-4" /> {t("Players")}
              </TabsTrigger>
              <TabsTrigger value="actions" className="h-10 px-4">
                <History className="size-4" /> {t("Actions")}
              </TabsTrigger>
              <TabsTrigger value="announce" className="h-10 px-4">
                <Megaphone className="size-4" /> {t("Announcements")}
              </TabsTrigger>
              <TabsTrigger value="results" className="h-10 px-4">
                <Trophy className="size-4" /> {t("Results")}
              </TabsTrigger>
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
        </main>
      </div>
    </FloorProvider>
  );
}
