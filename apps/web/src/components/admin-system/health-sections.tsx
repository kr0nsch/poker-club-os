"use client";

import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  Label,
  Table,
  TBody,
  Td,
  Textarea,
  Th,
  THead,
  Tr,
  cn,
} from "@pcos/ui";
import { SYNC_CONFLICT_RESOLUTIONS, type SyncConflictResolution } from "@pcos/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CloudCog, DatabaseBackup, GitCompareArrows, Loader2, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { get, post } from "@/lib/api";
import { useFormat, useT } from "@/lib/i18n";
import { errorMessage } from "@/lib/queries";
import { lbl, useSysLabels } from "./labels";
import { sysKeys } from "./queries";
import type { BackupRun, SyncConflictRow, SyncStatusView } from "./types";
import { ErrorState, InfoList, InfoRow, JsonBlock, RowsSkeleton, formatBytes, toDate, useLocaleTag } from "./ui";

function formatDuration(ms: number | null, t: ReturnType<typeof useT>) {
  if (ms == null || ms < 0) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return t("{n} s", { n: s });
  const m = Math.floor(s / 60);
  return t("{m} min {s} s", { m, s: s % 60 });
}

const isBusy = (b: BackupRun) => b.status === "REQUESTED" || b.status === "RUNNING";

// --- backups (spec §18, §80) ---------------------------------------------------------------------

export function BackupsCard() {
  const t = useT();
  const fmt = useFormat();
  const tag = useLocaleTag();
  const L = useSysLabels();
  const qc = useQueryClient();
  const backups = useQuery({
    queryKey: sysKeys.backups,
    queryFn: () => get<BackupRun[]>("/api/v1/edge/backups"),
    // poll quickly while a backup is queued or running
    refetchInterval: (q) => (q.state.data?.some(isBusy) ? 3_000 : 30_000),
  });
  const busy = !!backups.data?.some(isBusy);
  const wasBusy = useRef(busy);
  useEffect(() => {
    // A finished backup changes the "backup" health component.
    if (wasBusy.current && !busy) void qc.invalidateQueries({ queryKey: sysKeys.health });
    wasBusy.current = busy;
  }, [busy, qc]);

  const run = useMutation({
    mutationFn: () => post<BackupRun>("/api/v1/edge/backups"),
    onSuccess: () => {
      toast.success(t("Backup queued. The edge server's worker starts it shortly."));
      void qc.invalidateQueries({ queryKey: sysKeys.backups });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const lastOk = backups.data?.find((b) => b.status === "SUCCEEDED");
  const rows = backups.data ?? [];

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <DatabaseBackup className="size-4 text-primary" /> {t("Backups")}
          </CardTitle>
          <CardDescription>
            {t("Local database dumps on the edge server (scheduled and manual). Keep an off-site copy for disaster recovery.")}
            {backups.data && (
              <span className={cn("mt-1 block", lastOk ? "text-foreground/80" : "text-warning")}>
                {lastOk ? t("Last successful backup {when}", { when: fmt.relative(lastOk.finishedAt) }) : t("No successful backup yet")}
              </span>
            )}
          </CardDescription>
        </div>
        <Button onClick={() => run.mutate()} loading={run.isPending} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : <Play />}
          {busy ? t("Backup in progress…") : t("Run backup now")}
        </Button>
      </CardHeader>
      <CardContent>
        {backups.isLoading ? (
          <RowsSkeleton rows={3} />
        ) : backups.error ? (
          <ErrorState error={backups.error} onRetry={() => void backups.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState icon={<DatabaseBackup />} title={t("No backups yet")} description={t("Run the first backup now; scheduled backups start automatically.")} />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("Status")}</Th>
                <Th>{t("Trigger")}</Th>
                <Th>{t("Started")}</Th>
                <Th>{t("Duration")}</Th>
                <Th>{t("File")}</Th>
                <Th className="text-right">{t("Size")}</Th>
                <Th>{t("Off-site copy")}</Th>
                <Th>{t("Error")}</Th>
              </Tr>
            </THead>
            <TBody>
              {rows.map((b) => {
                const started = toDate(b.startedAt);
                const finished = toDate(b.finishedAt);
                return (
                  <Tr key={b.id}>
                    <Td>
                      <Badge variant={b.status === "SUCCEEDED" ? "success" : b.status === "FAILED" ? "destructive" : b.status === "RUNNING" ? "default" : "muted"}>
                        {b.status === "RUNNING" && <Loader2 className="size-3 animate-spin" />}
                        {lbl(L.backupStatus, b.status)}
                      </Badge>
                    </Td>
                    <Td>{b.trigger === "MANUAL" ? t("Manual") : b.trigger === "SCHEDULE" ? t("Scheduled") : b.trigger}</Td>
                    <Td className="whitespace-nowrap">{fmt.dateTime(b.startedAt ?? b.requestedAt)}</Td>
                    <Td className="whitespace-nowrap tabular-nums">{started && finished ? formatDuration(finished.getTime() - started.getTime(), t) : "—"}</Td>
                    <Td className="max-w-56 truncate font-mono text-xs" title={b.fileName ?? undefined}>
                      {b.fileName ?? "—"}
                    </Td>
                    <Td className="text-right whitespace-nowrap tabular-nums">{formatBytes(b.sizeBytes, tag)}</Td>
                    <Td>
                      {!b.offsiteStatus ? (
                        <span className="text-muted-foreground" title={t("No off-site copy command is configured on the edge server")}>
                          —
                        </span>
                      ) : b.offsiteStatus === "COPIED" ? (
                        <Badge variant="success">{t("Copied")}</Badge>
                      ) : (
                        <Badge variant="destructive" title={b.offsiteStatus}>
                          {t("Failed")}
                        </Badge>
                      )}
                    </Td>
                    <Td className="max-w-64 truncate text-xs text-destructive" title={b.error ?? undefined}>
                      {b.error ?? ""}
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
}

// --- cloud sync (spec §7-8) ----------------------------------------------------------------------

export function SyncCard() {
  const t = useT();
  const fmt = useFormat();
  const sync = useQuery({ queryKey: sysKeys.sync, queryFn: () => get<SyncStatusView>("/api/v1/edge/sync"), refetchInterval: 15_000 });
  const s = sync.data;
  const oldest = toDate(s?.counts?.oldest_pending ?? null);
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <CloudCog className="size-4 text-primary" /> {t("Cloud sync")}
          </CardTitle>
          <CardDescription>
            {s?.enabled
              ? t("Local changes are sent to the cloud whenever the Internet is available. Nothing is ever discarded.")
              : t("Cloud sync is off. The venue works fully offline; changes are kept in the local outbox.")}
          </CardDescription>
        </div>
        {s && <Badge variant={s.enabled ? "success" : "muted"}>{s.enabled ? t("On") : t("Off")}</Badge>}
      </CardHeader>
      <CardContent className="grid gap-4">
        {sync.isLoading ? (
          <RowsSkeleton rows={3} />
        ) : sync.error ? (
          <ErrorState error={sync.error} onRetry={() => void sync.refetch()} />
        ) : s ? (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <MiniStat label={t("Pending")} value={s.counts?.pending ?? 0} tone={(s.counts?.pending ?? 0) > 0 && s.enabled ? "warning" : undefined} />
              <MiniStat label={t("Failed")} value={s.counts?.failed ?? 0} tone={(s.counts?.failed ?? 0) > 0 ? "destructive" : undefined} />
              <MiniStat label={t("Synced")} value={s.counts?.synced ?? 0} />
              <MiniStat label={t("Open conflicts")} value={s.openConflicts} tone={s.openConflicts > 0 ? "warning" : undefined} />
            </div>
            <InfoList>
              <InfoRow label={t("Oldest unsent change")}>{oldest ? <span title={fmt.dateTime(oldest)}>{fmt.relative(oldest.toISOString())}</span> : "—"}</InfoRow>
              <InfoRow label={t("Cloud address")}>{s.cloudUrl ? <code className="font-mono text-xs">{s.cloudUrl}</code> : <span className="text-muted-foreground">{t("Not configured")}</span>}</InfoRow>
            </InfoList>
            {s.cursors.length > 0 && (
              <Table>
                <THead>
                  <Tr>
                    <Th>{t("Consumer")}</Th>
                    <Th className="text-right">{t("Position")}</Th>
                    <Th>{t("Updated")}</Th>
                    <Th>{t("Last error")}</Th>
                  </Tr>
                </THead>
                <TBody>
                  {s.cursors.map((c) => (
                    <Tr key={c.consumer}>
                      <Td className="font-mono text-xs">{c.consumer}</Td>
                      <Td className="text-right tabular-nums">{c.position}</Td>
                      <Td className="whitespace-nowrap">{fmt.relative(c.updatedAt)}</Td>
                      <Td className="max-w-56 truncate text-xs text-destructive" title={c.lastError ?? undefined}>
                        {c.lastError ?? <span className="text-muted-foreground">—</span>}
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: number | string; tone?: "warning" | "destructive" }) {
  return (
    <div className="rounded-lg border border-border px-3 py-2">
      <div className="eyebrow">{label}</div>
      <div className={cn("text-lg font-semibold tabular-nums", tone === "warning" && "text-warning", tone === "destructive" && "text-destructive")}>{value}</div>
    </div>
  );
}

// --- sync conflicts --------------------------------------------------------------------------------

export function ConflictsCard() {
  const t = useT();
  const fmt = useFormat();
  const L = useSysLabels();
  const [showResolved, setShowResolved] = useState(false);
  const [open, setOpen] = useState<SyncConflictRow | null>(null);
  const conflicts = useQuery({ queryKey: sysKeys.conflicts, queryFn: () => get<SyncConflictRow[]>("/api/v1/edge/sync/conflicts"), refetchInterval: 30_000 });
  const all = conflicts.data ?? [];
  const openCount = all.filter((c) => !c.resolvedAt).length;
  const rows = all.filter((c) => showResolved || !c.resolvedAt);

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <GitCompareArrows className="size-4 text-primary" /> {t("Sync conflicts")}
            {openCount > 0 && <Badge variant="warning">{openCount}</Badge>}
          </CardTitle>
          <CardDescription>{t("The cloud and this venue changed the same record. Live tournament data always wins locally until you decide.")}</CardDescription>
        </div>
        {all.length > openCount && <Checkbox checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} label={t("Show resolved")} className="text-muted-foreground" />}
      </CardHeader>
      <CardContent>
        {conflicts.isLoading ? (
          <RowsSkeleton rows={2} />
        ) : conflicts.error ? (
          <ErrorState error={conflicts.error} onRetry={() => void conflicts.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState icon={<GitCompareArrows />} title={t("No open conflicts")} description={t("Nothing needs a decision.")} className="p-6" />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("Detected")}</Th>
                <Th>{t("Record")}</Th>
                <Th>{t("Versions")}</Th>
                <Th>{t("Reason")}</Th>
                <Th className="text-right">{t("Status")}</Th>
              </Tr>
            </THead>
            <TBody>
              {rows.map((c) => (
                <Tr key={c.id} className="cursor-pointer" onClick={() => setOpen(c)}>
                  <Td className="whitespace-nowrap">{fmt.dateTime(c.detectedAt)}</Td>
                  <Td>
                    <div className="font-medium">{c.entityType}</div>
                    <code className="text-xs text-muted-foreground">{c.entityId.slice(0, 8)}</code>
                  </Td>
                  <Td className="whitespace-nowrap text-xs tabular-nums">
                    {t("local v{l} · cloud v{r}", { l: c.localVersion ?? "—", r: c.remoteVersion ?? "—" })}
                  </Td>
                  <Td className="max-w-56 truncate text-xs" title={c.reason}>
                    {c.reason}
                  </Td>
                  <Td className="text-right">
                    {c.resolvedAt ? (
                      <Badge variant="muted">{lbl(L.resolution, c.resolution)}</Badge>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpen(c);
                        }}
                      >
                        {t("Resolve")}
                      </Button>
                    )}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </CardContent>
      {open && <ConflictDialog conflict={open} onClose={() => setOpen(null)} />}
    </Card>
  );
}

/** Fields the cloud version carries whose value differs from the local record. */
function changedFields(local: unknown, remote: unknown): string[] {
  if (!remote || typeof remote !== "object" || Array.isArray(remote)) return [];
  const l = (local && typeof local === "object" ? local : {}) as Record<string, unknown>;
  return Object.keys(remote as Record<string, unknown>).filter((k) => JSON.stringify(l[k]) !== JSON.stringify((remote as Record<string, unknown>)[k]));
}

function ConflictDialog({ conflict, onClose }: { conflict: SyncConflictRow; onClose(): void }) {
  const t = useT();
  const fmt = useFormat();
  const L = useSysLabels();
  const qc = useQueryClient();
  const [resolution, setResolution] = useState<SyncConflictResolution>("KEEP_LOCAL");
  const [note, setNote] = useState("");
  const resolved = !!conflict.resolvedAt;
  const changed = changedFields(conflict.localPayload, conflict.remotePayload);

  const resolve = useMutation({
    mutationFn: () => post(`/api/v1/edge/sync/conflicts/${conflict.id}/resolve`, { resolution, note: note.trim() || undefined }),
    onSuccess: () => {
      toast.success(t("Conflict resolved"));
      void qc.invalidateQueries({ queryKey: sysKeys.conflicts });
      void qc.invalidateQueries({ queryKey: sysKeys.sync });
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const options: Record<SyncConflictResolution, string> = {
    KEEP_LOCAL: t("Keep this venue's version and send it to the cloud again."),
    ACCEPT_REMOTE: t("Apply the cloud version here. Applied automatically for player records only; update other records by hand."),
    MANUAL: t("Mark as handled without an automatic change, e.g. after fixing the record by hand."),
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent wide className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>{t("Sync conflict: {type}", { type: conflict.entityType })}</DialogTitle>
          <DialogDescription>{conflict.reason}</DialogDescription>
        </DialogHeader>
        <InfoList className="sm:grid-cols-2">
          <InfoRow label={t("Record ID")}>
            <code className="font-mono text-xs">{conflict.entityId}</code>
          </InfoRow>
          <InfoRow label={t("Detected")}>{fmt.dateTime(conflict.detectedAt)}</InfoRow>
        </InfoList>
        {changed.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-sm">
            <span className="text-muted-foreground">{t("Different fields:")}</span>
            {changed.map((k) => (
              <Badge key={k} variant="warning" className="font-mono">
                {k}
              </Badge>
            ))}
          </div>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          <div className="grid min-w-0 content-start gap-1.5">
            <Label>
              {t("Local (this venue)")} <span className="text-muted-foreground">v{conflict.localVersion ?? "—"}</span>
            </Label>
            <JsonBlock value={conflict.localPayload ?? null} className="max-h-80" />
          </div>
          <div className="grid min-w-0 content-start gap-1.5">
            <Label>
              {t("Remote (cloud)")} <span className="text-muted-foreground">v{conflict.remoteVersion ?? "—"}</span>
            </Label>
            <JsonBlock value={conflict.remotePayload ?? null} className="max-h-80" />
          </div>
        </div>
        {resolved ? (
          <Alert variant="success" title={t("Resolved: {resolution}", { resolution: lbl(L.resolution, conflict.resolution) })}>
            {fmt.dateTime(conflict.resolvedAt)}
            {conflict.note ? ` · ${conflict.note}` : ""}
          </Alert>
        ) : (
          <div className="grid gap-3">
            <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label={t("Resolution")}>
              {SYNC_CONFLICT_RESOLUTIONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  role="radio"
                  aria-checked={resolution === r}
                  onClick={() => setResolution(r)}
                  className={cn("rounded-lg border p-3 text-left text-sm transition-colors", resolution === r ? "border-primary bg-primary/10" : "border-border hover:bg-accent")}
                >
                  <div className="font-medium">{lbl(L.resolution, r)}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{options[r]}</div>
                </button>
              ))}
            </div>
            <Field label={t("Note")} hint={t("Optional, stored in the audit log.")}>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} />
            </Field>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {resolved ? t("Close") : t("Cancel")}
          </Button>
          {!resolved && (
            <Button onClick={() => resolve.mutate()} loading={resolve.isPending}>
              {t("Resolve conflict")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
