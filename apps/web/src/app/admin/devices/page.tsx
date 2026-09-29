"use client";

import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Input,
  PageHeader,
  Select,
  Stat,
  Switch,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
  cn,
} from "@pcos/ui";
import { DEVICE_TYPES, topic, type DeviceType, type TournamentSnapshot } from "@pcos/types";
import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { Ban, LogOut, MoreHorizontal, Pencil, RefreshCw, RotateCcw, Search, Tablet } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { DeviceEditDialog } from "@/components/admin-system/device-edit-dialog";
import { useSysLabels } from "@/components/admin-system/labels";
import { sysKeys, useDevices, useLiveTournaments } from "@/components/admin-system/queries";
import type { DeviceRow } from "@/components/admin-system/types";
import { ErrorState, LiveDot, NoAccess, RowsSkeleton, useConfirm } from "@/components/admin-system/ui";
import { useCan, useStaff } from "@/components/staff-guard";
import { get, patch, post } from "@/lib/api";
import { deviceId as currentDeviceId } from "@/lib/device";
import { useFormat, useT } from "@/lib/i18n";
import { errorMessage, keys } from "@/lib/queries";
import { useServerNow, useTopicEvents } from "@/lib/realtime-context";

type StatusFilter = "all" | "online" | "offline" | "revoked";

/** Staff device registry (spec §12-13). Device identity is audit context; staff still sign in. */
export default function DevicesPage() {
  const t = useT();
  const can = useCan();
  const manage = can("device.manage");
  return (
    <div>
      <PageHeader title={t("Devices")} description={t("Tablets, phones and PCs seen by the edge server. Device identity adds audit context; staff still sign in on every device.")} />
      {manage ? <DevicesContent /> : <NoAccess permission="device.manage" />}
    </div>
  );
}

function DevicesContent() {
  const t = useT();
  const fmt = useFormat();
  const L = useSysLabels();
  const me = useStaff();
  const qc = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<DeviceType | "">("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [editing, setEditing] = useState<DeviceRow | null>(null);
  const thisDevice = useMemo(() => currentDeviceId(), []);

  const devices = useDevices(true, 10_000);
  useTopicEvents([me.organization ? topic.organization(me.organization.id) : null], (e) => {
    if (e.name === "device.updated") void qc.invalidateQueries({ queryKey: sysKeys.devices });
  });
  useServerNow(30_000); // keeps "last seen" fresh between refetches

  // Resolve assigned dealer tables (table id → tournament/table number) from live tournaments.
  const live = useLiveTournaments();
  const needTables = (devices.data ?? []).some((d) => d.assignedTableId);
  const snapshots = useQueries({
    queries: (needTables ? (live.data ?? []) : []).map((x) => ({
      queryKey: keys.snapshot(x.id),
      queryFn: () => get<TournamentSnapshot>(`/api/v1/tournaments/${x.id}/snapshot`),
      staleTime: 30_000,
    })),
  });
  const tableMap = new Map<string, { tournamentId: string; tournamentName: string; tableNumber: number }>();
  for (const s of snapshots) {
    const snap = s.data;
    if (!snap) continue;
    for (const tb of snap.tables) tableMap.set(tb.id, { tournamentId: snap.tournament.id, tournamentName: snap.tournament.name, tableNumber: tb.tableNumber });
  }

  const trust = useMutation({
    mutationFn: (v: { id: string; trusted: boolean }) => patch(`/api/v1/devices/${v.id}`, { trusted: v.trusted }),
    onSuccess: (_r, v) => {
      toast.success(v.trusted ? t("Device marked as trusted") : t("Device no longer trusted"));
      void qc.invalidateQueries({ queryKey: sysKeys.devices });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const act = (path: string, success: string) => async () => {
    await post(path);
    toast.success(success);
    await qc.invalidateQueries({ queryKey: sysKeys.devices });
  };

  const revoke = (d: DeviceRow) =>
    confirm({
      title: t("Revoke “{name}”?", { name: d.name }),
      description:
        d.deviceId === thisDevice
          ? t("This is the device you are using now: you will be signed out and cannot sign in again here until the device is restored.")
          : t("All sessions on this device end immediately and nobody can sign in on it until it is restored."),
      confirmLabel: t("Revoke device"),
      action: act(`/api/v1/devices/${d.id}/revoke`, t("Device revoked")),
    });
  const restore = (d: DeviceRow) =>
    confirm({
      title: t("Restore “{name}”?", { name: d.name }),
      description: t("Staff can sign in on this device again. It stays untrusted until you mark it trusted."),
      confirmLabel: t("Restore device"),
      destructive: false,
      action: act(`/api/v1/devices/${d.id}/restore`, t("Device restored")),
    });
  const disconnect = (d: DeviceRow) =>
    confirm({
      title: t("Sign out “{name}”?", { name: d.name }),
      description: t("Ends every session on this device. Staff can sign in again right away."),
      confirmLabel: t("Sign out sessions"),
      action: act(`/api/v1/devices/${d.id}/disconnect`, t("Sessions ended")),
    });

  const all = devices.data ?? [];
  const q = query.trim().toLowerCase();
  const rows = all
    .filter((d) => !typeFilter || d.type === typeFilter)
    .filter((d) => (status === "all" ? true : status === "online" ? d.connected && !d.revoked : status === "offline" ? !d.connected && !d.revoked : d.revoked))
    .filter((d) => !q || [d.name, d.currentUser, d.ip, d.deviceId, L.deviceType[d.type]].some((v) => v?.toLowerCase().includes(q)))
    .sort((a, b) => Number(a.revoked) - Number(b.revoked) || Number(b.connected) - Number(a.connected) || (b.lastSeenAt ?? "").localeCompare(a.lastSeenAt ?? ""));

  if (devices.isLoading) return <RowsSkeleton rows={6} />;
  if (devices.error) return <ErrorState error={devices.error} onRetry={() => void devices.refetch()} />;

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={t("Devices")} value={all.length} />
        <Stat label={t("Online now")} value={<span className="text-success">{all.filter((d) => d.connected && !d.revoked).length}</span>} />
        <Stat label={t("Trusted")} value={all.filter((d) => d.trusted && !d.revoked).length} />
        <Stat label={t("Revoked")} value={all.filter((d) => d.revoked).length} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Search by name, user or IP")} className="pl-9" />
        </div>
        <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as DeviceType | "")} className="w-auto min-w-44" aria-label={t("Type")}>
          <option value="">{t("All types")}</option>
          {DEVICE_TYPES.map((d) => (
            <option key={d} value={d}>
              {L.deviceType[d]}
            </option>
          ))}
        </Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} className="w-auto min-w-36" aria-label={t("Status")}>
          <option value="all">{t("All statuses")}</option>
          <option value="online">{t("Online")}</option>
          <option value="offline">{t("Offline")}</option>
          <option value="revoked">{t("Revoked")}</option>
        </Select>
        <Button variant="outline" onClick={() => void devices.refetch()} loading={devices.isFetching}>
          <RefreshCw /> {t("Refresh")}
        </Button>
      </div>

      {all.length === 0 ? (
        <EmptyState icon={<Tablet />} title={t("No devices yet")} description={t("Devices appear here automatically after staff sign in on them.")} />
      ) : rows.length === 0 ? (
        <EmptyState icon={<Search />} title={t("No devices match the filters")} />
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>{t("Device")}</Th>
              <Th>{t("Connection")}</Th>
              {/* Phones and tablets keep device, connection, last seen and trust; the rest returns on wider screens. */}
              <Th className="max-md:hidden">{t("User")}</Th>
              <Th className="max-lg:hidden">IP</Th>
              <Th>{t("Last seen")}</Th>
              <Th className="max-md:hidden">{t("Dealer table")}</Th>
              <Th className="max-xl:hidden">{t("App version")}</Th>
              <Th>{t("Trusted")}</Th>
              <Th className="text-right">
                <span className="sr-only">{t("Actions")}</span>
              </Th>
            </Tr>
          </THead>
          <TBody>
            {rows.map((d) => {
              const table = d.assignedTableId ? tableMap.get(d.assignedTableId) : undefined;
              const mine = d.deviceId === thisDevice;
              return (
                <Tr key={d.id} className={cn(d.revoked && "opacity-60")}>
                  <Td>
                    <div className="flex items-center gap-2 font-medium">
                      <span className="truncate">{d.name}</span>
                      {mine && <Badge variant="default">{t("This device")}</Badge>}
                      {d.revoked && <Badge variant="destructive">{t("Revoked")}</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground" title={d.deviceId}>
                      {L.deviceType[d.type] ?? d.type}
                    </div>
                  </Td>
                  <Td className="whitespace-nowrap">
                    <span className="inline-flex items-center gap-2">
                      <LiveDot on={d.connected} />
                      {d.connected ? (d.connections > 1 ? t("Online ({n} connections)", { n: d.connections }) : t("Online")) : <span className="text-muted-foreground">{t("Offline")}</span>}
                    </span>
                  </Td>
                  <Td className="max-md:hidden">{d.currentUser ?? <span className="text-muted-foreground">—</span>}</Td>
                  <Td className="font-mono text-xs max-lg:hidden">{d.ip ?? "—"}</Td>
                  <Td className="whitespace-nowrap" title={fmt.dateTime(d.lastSeenAt)}>
                    {d.lastSeenAt ? fmt.relative(d.lastSeenAt) : "—"}
                  </Td>
                  <Td className="max-md:hidden">
                    {table ? (
                      <div>
                        <div>{t("Table {n}", { n: table.tableNumber })}</div>
                        <div className="max-w-44 truncate text-xs text-muted-foreground">{table.tournamentName}</div>
                      </div>
                    ) : d.assignedTableId ? (
                      <span className="text-muted-foreground" title={d.assignedTableId}>
                        {t("Assigned (tournament not running)")}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </Td>
                  <Td className="text-xs text-muted-foreground max-xl:hidden">{d.appVersion ?? "—"}</Td>
                  <Td>
                    <Switch
                      checked={d.trusted}
                      disabled={d.revoked || (trust.isPending && trust.variables?.id === d.id)}
                      onCheckedChange={(v) => trust.mutate({ id: d.id, trusted: v })}
                      aria-label={t("Trusted")}
                    />
                  </Td>
                  <Td className="text-right">
                    {/* non-modal: the menu opens dialogs, avoid stacking two focus traps */}
                    <DropdownMenu modal={false}>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="px-2" aria-label={t("Actions")}>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setEditing(d)} disabled={d.revoked}>
                          <Pencil /> {t("Edit")}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => disconnect(d)} disabled={d.revoked}>
                          <LogOut /> {t("Sign out sessions")}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {d.revoked ? (
                          <DropdownMenuItem onSelect={() => restore(d)}>
                            <RotateCcw /> {t("Restore device")}
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem destructive onSelect={() => revoke(d)}>
                            <Ban /> {t("Revoke device")}
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      )}
      <p className="text-xs text-muted-foreground">
        {t("Trusted marks devices the club owns. Revoking a device ends its sessions and blocks sign-in on it; restoring allows sign-in again.")}
      </p>

      {editing && (
        <DeviceEditDialog
          device={editing}
          liveTournaments={live.data ?? []}
          initialTournamentId={editing.assignedTableId ? (tableMap.get(editing.assignedTableId)?.tournamentId ?? null) : null}
          onClose={() => setEditing(null)}
        />
      )}
      {dialog}
    </div>
  );
}
