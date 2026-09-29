"use client";

import { Alert, Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, PageHeader, Skeleton, Spinner, cn } from "@pcos/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Cable, CloudCog, CloudOff, Database, DatabaseBackup, Download, FileJson, HardDrive, MemoryStick, RefreshCw, Send, Server, Wifi, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { BackupsCard, ConflictsCard, SyncCard } from "@/components/admin-system/health-sections";
import { lbl, useSysLabels, type SysLabels } from "@/components/admin-system/labels";
import { sysKeys, useEdgeHealth } from "@/components/admin-system/queries";
import type { EdgeHealth, HealthComponent } from "@/components/admin-system/types";
import { CopyButton, ErrorState, InfoList, InfoRow, JsonBlock, NoAccess, StateBadge, downloadJson, prettyJson } from "@/components/admin-system/ui";
import { useCan } from "@/components/staff-guard";
import { get } from "@/lib/api";
import { useFormat, useT } from "@/lib/i18n";

/** Edge health, backups, cloud sync and diagnostics (spec §18, §80-82). */
export default function HealthPage() {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const readable = can("edge.read");
  const health = useEdgeHealth(readable);

  return (
    <div className="grid gap-6">
      <PageHeader
        className="mb-0"
        title={t("Health & backups")}
        description={t("State of the venue edge server, local backups and the optional cloud sync.")}
        actions={
          readable && (
            <Button variant="outline" onClick={() => void qc.invalidateQueries({ queryKey: ["sys"] })} loading={health.isFetching && !health.isLoading}>
              <RefreshCw /> {t("Refresh")}
            </Button>
          )
        }
      />
      {!readable ? (
        <NoAccess permission="edge.read" />
      ) : (
        <>
          <WanNote health={health.data} />
          <div className="grid gap-4 lg:grid-cols-3">
            <OverviewCard health={health.data} loading={health.isLoading} error={health.error} onRetry={() => void health.refetch()} className="lg:col-span-2" />
            <EdgeNodeCard health={health.data} />
          </div>
          {can("backup.manage") && <BackupsCard />}
          <div className={cn("grid gap-4", can("sync.manage") && "xl:grid-cols-2")}>
            <SyncCard />
            {can("sync.manage") && <ConflictsCard />}
          </div>
          <DiagnosticsCard />
        </>
      )}
    </div>
  );
}

function WanNote({ health }: { health?: EdgeHealth }) {
  const t = useT();
  const offline = health?.components.some((c) => c.name === "wan" && c.state !== "OK");
  return (
    <Alert variant={offline ? "warning" : "default"} title={offline ? t("Internet unavailable: degraded, not down") : t("Internet loss means “degraded”, never “down”")}>
      <span className="flex items-start gap-2">
        {offline && <CloudOff className="mt-0.5 size-4 shrink-0" />}
        {t("Without the Internet, Telegram messages, cloud sync and off-site backups wait. Tournaments, registration, check-in, displays and every other local operation keep working on the venue network.")}
      </span>
    </Alert>
  );
}

const ICONS: Record<string, LucideIcon> = {
  postgres: Database,
  redis: MemoryStick,
  websocket: Cable,
  disk: HardDrive,
  backup: DatabaseBackup,
  wan: Wifi,
  telegram: Send,
  cloud_sync: CloudCog,
};

/** Server-provided component details are English; translate the known phrases. */
function componentDetail(c: HealthComponent, t: ReturnType<typeof useT>, L: SysLabels, relative: (iso: string) => string): string | null {
  const d = c.detail;
  if (!d) return null;
  if (c.name === "telegram") return lbl(L.telegramStatus, d);
  let m: RegExpExecArray | null;
  if ((m = /^(\d+) connections?$/.exec(d))) return t("{n} connections", { n: m[1] });
  if ((m = /^([\d.]+) GB free$/.exec(d))) return t("{n} GB free", { n: m[1] });
  if ((m = /^last success (.+)$/.exec(d))) return t("Last success {when}", { when: relative(m[1]!) });
  if ((m = /^(\d+) pending(?:, last error: (.+))?$/.exec(d))) return m[2] ? t("{n} pending, last error: {error}", { n: m[1], error: m[2] }) : t("{n} pending", { n: m[1] });
  const known: Record<string, string> = {
    "no successful backup yet": t("No successful backup yet"),
    "Internet reachable": t("Internet reachable"),
    "Internet unavailable — local operations unaffected": t("Internet unavailable, local operations unaffected"),
    "not configured (in-process fallbacks active)": t("Not configured (in-process fallbacks active)"),
    "unreachable — using in-process fallbacks": t("Unreachable, using in-process fallbacks"),
  };
  return known[d] ?? d;
}

function OverviewCard({ health, loading, error, onRetry, className }: { health?: EdgeHealth; loading: boolean; error: unknown; onRetry(): void; className?: string }) {
  const t = useT();
  const fmt = useFormat();
  const L = useSysLabels();
  const overallText = {
    OK: t("All components are working."),
    DEGRADED: t("Some components need attention. Local tournament operations are not affected."),
    DOWN: t("The local database is unavailable. Tournament operations stop until it recovers."),
  };
  return (
    <Card className={className}>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Activity className="size-4 text-primary" /> {t("Overall status")}
          </CardTitle>
          <CardDescription>{health ? overallText[health.overall] : t("Checking the edge server…")}</CardDescription>
        </div>
        {health && (
          <Badge variant={health.overall === "OK" ? "success" : health.overall === "DEGRADED" ? "warning" : "destructive"} className="px-3 py-1 text-sm">
            {health.overall === "OK" ? t("OK") : health.overall === "DEGRADED" ? t("Degraded") : t("Down")}
          </Badge>
        )}
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        ) : error ? (
          <ErrorState error={error} onRetry={onRetry} />
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {health?.components.map((c) => {
              const Icon = ICONS[c.name] ?? Server;
              const detail = componentDetail(c, t, L, (iso) => fmt.relative(iso));
              return (
                <div
                  key={c.name}
                  className={cn(
                    "flex items-start justify-between gap-3 rounded-lg border p-3",
                    c.state === "DEGRADED" ? "border-warning/40 bg-warning/5" : c.state === "DOWN" ? "border-destructive/40 bg-destructive/5" : "border-border",
                  )}
                >
                  <div className="flex min-w-0 gap-2.5">
                    <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{lbl(L.component, c.name)}</div>
                      {detail && <div className="mt-0.5 text-xs break-words text-muted-foreground">{detail}</div>}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <StateBadge state={c.state} />
                    {c.latencyMs != null && <span className="text-[11px] text-muted-foreground tabular-nums">{t("{n} ms", { n: c.latencyMs })}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EdgeNodeCard({ health }: { health?: EdgeHealth }) {
  const t = useT();
  const fmt = useFormat();
  const L = useSysLabels();
  const e = health?.edge;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Server className="size-4 text-primary" /> {t("Edge node")}
        </CardTitle>
        <CardDescription>{t("The server in the venue that runs everything locally.")}</CardDescription>
      </CardHeader>
      <CardContent>
        {!e ? (
          <div className="grid gap-2">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-5" />
            ))}
          </div>
        ) : (
          <InfoList>
            <InfoRow label={t("Node ID")}>
              <code className="font-mono text-xs">{e.nodeId}</code>
            </InfoRow>
            <InfoRow label={t("Status")}>
              <Badge variant={e.status === "ONLINE" ? "success" : "warning"}>{lbl(L.edgeStatus, e.status)}</Badge>
            </InfoRow>
            <InfoRow label={t("Internet (WAN)")}>{e.wanOnline ? <span className="text-success">{t("Online")}</span> : <span className="text-warning">{t("Offline")}</span>}</InfoRow>
            <InfoRow label={t("Last Internet contact")}>{e.lastWanSeenAt ? fmt.relative(e.lastWanSeenAt) : "—"}</InfoRow>
            <InfoRow label="Telegram">{lbl(L.telegramStatus, e.telegram)}</InfoRow>
            <InfoRow label={t("Cloud sync")}>
              {e.cloudSync.enabled ? `${t("On")} · ${t("{n} pending", { n: e.cloudSync.pending })}` : <span className="text-muted-foreground">{t("Off (optional)")}</span>}
            </InfoRow>
            <InfoRow label={t("Last cloud sync")}>{e.cloudSync.lastSyncAt ? fmt.relative(e.cloudSync.lastSyncAt) : "—"}</InfoRow>
            <InfoRow label={t("Server time")}>{fmt.dateTime(e.serverTime)}</InfoRow>
          </InfoList>
        )}
      </CardContent>
    </Card>
  );
}

// --- diagnostics bundle (spec §82) ---------------------------------------------------------------

function DiagnosticsCard() {
  const t = useT();
  const [requested, setRequested] = useState(false);
  const diag = useQuery({
    queryKey: sysKeys.diagnostics,
    queryFn: () => get<Record<string, unknown> & { generatedAt?: string; edge?: { nodeId?: string } }>("/api/v1/edge/diagnostics"),
    enabled: requested,
    staleTime: Infinity,
  });
  const data = diag.data;
  const filename = () => `pcos-diagnostics-${data?.edge?.nodeId ?? "edge"}-${(data?.generatedAt ?? new Date().toISOString()).replace(/[:.]/g, "-")}.json`;

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <FileJson className="size-4 text-primary" /> {t("Diagnostics bundle")}
          </CardTitle>
          <CardDescription>{t("For support: component states, runtime, connected clients and configuration. Secrets are redacted on the server.")}</CardDescription>
        </div>
        {data ? (
          <div className="flex flex-wrap gap-2">
            <CopyButton value={prettyJson(data)} label={t("Copy to clipboard")} />
            <Button size="sm" variant="outline" onClick={() => downloadJson(filename(), data)}>
              <Download /> {t("Download JSON")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void diag.refetch()} loading={diag.isFetching}>
              <RefreshCw /> {t("Regenerate")}
            </Button>
          </div>
        ) : (
          <Button onClick={() => setRequested(true)} loading={diag.isFetching}>
            <FileJson /> {t("Generate bundle")}
          </Button>
        )}
      </CardHeader>
      {requested && (
        <CardContent>
          {diag.isLoading ? (
            <Spinner label={t("Collecting diagnostics…")} />
          ) : diag.error ? (
            <ErrorState error={diag.error} onRetry={() => void diag.refetch()} />
          ) : (
            <JsonBlock value={data} className="max-h-[32rem]" />
          )}
        </CardContent>
      )}
    </Card>
  );
}
