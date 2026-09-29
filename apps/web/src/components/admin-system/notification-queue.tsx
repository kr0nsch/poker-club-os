"use client";

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Label,
  Select,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
  cn,
} from "@pcos/ui";
import { NOTIFICATION_CHANNELS, NOTIFICATION_STATUSES } from "@pcos/types";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Inbox, RefreshCw } from "lucide-react";
import { useState } from "react";
import { get, qs } from "@/lib/api";
import { useFormat, useT } from "@/lib/i18n";
import { lbl, useSysLabels } from "./labels";
import { sysKeys } from "./queries";
import type { NotificationQueueView, NotificationRow, TelegramDeliveryRow } from "./types";
import { ErrorState, InfoList, InfoRow, JsonBlock, RowsSkeleton } from "./ui";

const STATUS_TONE: Record<string, "default" | "success" | "warning" | "destructive" | "muted"> = {
  PENDING: "warning",
  SENDING: "default",
  SENT: "success",
  FAILED: "destructive",
  EXPIRED: "muted",
  CANCELLED: "muted",
};

export function NotificationStatusBadge({ status }: { status: string }) {
  const L = useSysLabels();
  return <Badge variant={STATUS_TONE[status] ?? "outline"}>{lbl(L.notificationStatus, status)}</Badge>;
}

/** Outgoing notification queue (Telegram, email…). In-app notifications are excluded unless chosen. */
export function NotificationQueueCard() {
  const t = useT();
  const fmt = useFormat();
  const L = useSysLabels();
  const [status, setStatus] = useState("");
  const [channel, setChannel] = useState("");
  const [open, setOpen] = useState<NotificationRow | null>(null);
  const queue = useQuery({
    queryKey: sysKeys.notifications(status, channel),
    queryFn: () => get<NotificationQueueView>(`/api/v1/notifications/queue${qs({ status, channel, limit: 200 })}`),
    refetchInterval: 15_000,
    placeholderData: keepPreviousData,
  });
  const counts = queue.data?.counts;
  const items = queue.data?.items ?? [];
  const tiles: { key: string; label: string; value: number | undefined; tone: string }[] = [
    { key: "PENDING", label: t("Pending"), value: counts?.pending, tone: "text-warning" },
    { key: "SENT", label: t("Sent"), value: counts?.sent, tone: "text-success" },
    { key: "FAILED", label: t("Failed"), value: counts?.failed, tone: "text-destructive" },
    { key: "EXPIRED", label: t("Expired"), value: counts?.expired, tone: "text-muted-foreground" },
  ];

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Inbox className="size-4 text-primary" /> {t("Notification queue")}
          </CardTitle>
          <CardDescription>{t("Messages wait here while the Internet is down and are retried automatically. Messages that are no longer relevant expire instead of arriving late.")}</CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={() => void queue.refetch()} loading={queue.isFetching}>
          <RefreshCw /> {t("Refresh")}
        </Button>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {tiles.map((x) => (
            <button
              key={x.key}
              type="button"
              onClick={() => setStatus((s) => (s === x.key ? "" : x.key))}
              aria-pressed={status === x.key}
              className={cn("rounded-lg border px-3 py-2 text-left transition-colors", status === x.key ? "border-primary bg-primary/10" : "border-border hover:bg-accent")}
            >
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{x.label}</div>
              <div className={cn("text-xl font-semibold tabular-nums", x.value ? x.tone : "")}>{x.value ?? "—"}</div>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="nq-status">{t("Status")}</Label>
            <Select id="nq-status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-44">
              <option value="">{t("All statuses")}</option>
              {NOTIFICATION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {lbl(L.notificationStatus, s)}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="nq-channel">{t("Channel")}</Label>
            <Select id="nq-channel" value={channel} onChange={(e) => setChannel(e.target.value)} className="w-48">
              <option value="">{t("All outgoing channels")}</option>
              {NOTIFICATION_CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {lbl(L.channel, c)}
                </option>
              ))}
            </Select>
          </div>
          <p className="pb-2 text-xs text-muted-foreground">{t("Counters cover all outgoing channels; the list shows the latest 200 matching messages.")}</p>
        </div>
        {queue.isLoading ? (
          <RowsSkeleton rows={4} />
        ) : queue.error ? (
          <ErrorState error={queue.error} onRetry={() => void queue.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState icon={<Inbox />} title={t("No messages")} description={status || channel ? t("Nothing matches the filters.") : t("Nothing has been queued yet.")} className="p-6" />
        ) : (
          <Table className={cn(queue.isPlaceholderData && "opacity-60")}>
            <THead>
              <Tr>
                <Th>{t("Created")}</Th>
                <Th>{t("Type")}</Th>
                <Th>{t("Channel")}</Th>
                <Th>{t("Recipient")}</Th>
                <Th>{t("Status")}</Th>
                <Th className="text-right">{t("Attempts")}</Th>
                <Th>{t("Expires")}</Th>
                <Th>{t("Last error")}</Th>
              </Tr>
            </THead>
            <TBody>
              {items.map((n) => (
                <Tr key={n.id} className="cursor-pointer" onClick={() => setOpen(n)}>
                  <Td className="whitespace-nowrap">{fmt.dateTime(n.createdAt)}</Td>
                  <Td>{lbl(L.notificationType, n.type)}</Td>
                  <Td>{lbl(L.channel, n.channel)}</Td>
                  <Td className="font-mono text-xs">{n.recipient ?? "—"}</Td>
                  <Td>
                    <NotificationStatusBadge status={n.status} />
                  </Td>
                  <Td className="text-right tabular-nums">{n.attemptCount}</Td>
                  <Td className="whitespace-nowrap text-muted-foreground" title={fmt.dateTime(n.expiresAt)}>
                    {n.expiresAt ? fmt.relative(n.expiresAt) : "—"}
                  </Td>
                  <Td className="max-w-56 truncate text-xs text-destructive" title={n.lastError ?? undefined}>
                    {n.lastError ?? ""}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </CardContent>
      {open && <NotificationDialog n={open} onClose={() => setOpen(null)} />}
    </Card>
  );
}

function NotificationDialog({ n, onClose }: { n: NotificationRow; onClose(): void }) {
  const t = useT();
  const fmt = useFormat();
  const L = useSysLabels();
  const deliveries = useQuery({ queryKey: sysKeys.deliveries(n.id), queryFn: () => get<TelegramDeliveryRow[]>(`/api/v1/notifications/${n.id}/deliveries`) });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent wide>
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {lbl(L.notificationType, n.type)} <NotificationStatusBadge status={n.status} />
          </DialogTitle>
          <DialogDescription>
            {lbl(L.channel, n.channel)} · <code className="font-mono">{n.recipient ?? "—"}</code>
          </DialogDescription>
        </DialogHeader>
        <InfoList className="sm:grid-cols-2">
          <InfoRow label={t("Created")}>{fmt.dateTime(n.createdAt)}</InfoRow>
          <InfoRow label={t("Attempts")}>{n.attemptCount}</InfoRow>
          <InfoRow label={t("Next attempt")}>{n.status === "PENDING" && n.nextAttemptAt ? fmt.relative(n.nextAttemptAt) : "—"}</InfoRow>
          <InfoRow label={t("Expires")}>{fmt.dateTime(n.expiresAt)}</InfoRow>
          <InfoRow label={t("Sent")}>{fmt.dateTime(n.sentAt)}</InfoRow>
          <InfoRow label={t("Deduplication key")}>
            <code className="font-mono text-xs break-all">{n.dedupeKey ?? "—"}</code>
          </InfoRow>
        </InfoList>
        {n.lastError && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            <span className="font-medium">{t("Last error")}:</span> {n.lastError}
          </div>
        )}
        <div className="grid gap-1.5">
          <Label>{t("Payload")}</Label>
          <JsonBlock value={n.payload} className="max-h-60" />
        </div>
        <div className="grid gap-1.5">
          <Label>{t("Delivery attempts")}</Label>
          {deliveries.isLoading ? (
            <RowsSkeleton rows={2} />
          ) : deliveries.error ? (
            <ErrorState error={deliveries.error} onRetry={() => void deliveries.refetch()} />
          ) : (deliveries.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">{n.channel === "TELEGRAM" ? t("No delivery attempts recorded yet.") : t("Delivery attempts are recorded for Telegram messages only.")}</p>
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th>{t("Time")}</Th>
                  <Th>{t("Chat")}</Th>
                  <Th>{t("Message ID")}</Th>
                  <Th>{t("Status")}</Th>
                  <Th>HTTP</Th>
                  <Th>{t("Error")}</Th>
                </Tr>
              </THead>
              <TBody>
                {(deliveries.data ?? []).map((d) => (
                  <Tr key={d.id}>
                    <Td className="whitespace-nowrap">{fmt.dateTime(d.createdAt)}</Td>
                    <Td className="font-mono text-xs">{d.chatId}</Td>
                    <Td className="font-mono text-xs">{d.messageId ?? "—"}</Td>
                    <Td>{d.status}</Td>
                    <Td className="tabular-nums">{d.httpStatus ?? "—"}</Td>
                    <Td className="max-w-64 text-xs break-words text-destructive">{d.error ?? ""}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t("Close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
