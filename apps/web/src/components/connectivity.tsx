"use client";

import { Badge, cn } from "@pcos/ui";
import { CloudOff, RefreshCw, Server, ServerOff, WifiOff } from "lucide-react";
import { useT } from "@/lib/i18n";
import { useRealtimeState } from "@/lib/realtime-context";

/**
 * Connection indicator (spec §17, §76). A missing Internet connection is
 * shown as information, never as a fatal error.
 */
export function ConnectivityBadge({ compact = false, className }: { compact?: boolean; className?: string }) {
  const t = useT();
  const s = useRealtimeState();
  const map = {
    LOCAL_CONNECTED: { icon: Server, label: t("LOCAL"), variant: "success" as const, title: t("Local server connected") },
    WAN_OFFLINE: { icon: CloudOff, label: `${t("LOCAL")} · ${t("OFFLINE")}`, variant: "warning" as const, title: `${t("Local server connected")} · ${t("Internet unavailable")} · ${t("Telegram notifications paused")} · ${t("Tournament operations fully available")}` },
    SYNC_PENDING: { icon: RefreshCw, label: `${t("LOCAL")} · ${t("SYNCING")}`, variant: "default" as const, title: t("Sync pending") },
    SERVER_UNREACHABLE: { icon: ServerOff, label: t("Reconnecting…"), variant: "destructive" as const, title: t("Local server unreachable") },
    LAN_DISCONNECTED: { icon: WifiOff, label: t("OFFLINE"), variant: "destructive" as const, title: t("No network on this device") },
  }[s.connectivity];
  const Icon = map.icon;
  return (
    <Badge variant={map.variant} title={map.title} className={cn("gap-1.5", className)}>
      <Icon className={cn("size-3.5", s.connectivity === "SERVER_UNREACHABLE" && "animate-pulse-soft")} />
      {!compact && map.label}
    </Badge>
  );
}

/** Banner for staff surfaces explaining degraded modes in plain language. */
export function ConnectivityBanner() {
  const t = useT();
  const s = useRealtimeState();
  if (s.connectivity === "LOCAL_CONNECTED" || s.connectivity === "SYNC_PENDING") return null;
  if (s.connectivity === "WAN_OFFLINE") {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-warning/30 bg-warning/10 px-4 py-1.5 text-xs text-warning">
        <CloudOff className="size-3.5" />
        <span className="font-medium">{t("Local server connected")}</span>
        <span>·</span>
        <span>{t("Internet unavailable")}</span>
        <span>·</span>
        <span>{t("Telegram notifications paused")}</span>
        <span>·</span>
        <span className="font-medium">{t("Tournament operations fully available")}</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 border-b border-destructive/30 bg-destructive/10 px-4 py-1.5 text-xs text-destructive">
      {s.connectivity === "LAN_DISCONNECTED" ? <WifiOff className="size-3.5" /> : <ServerOff className="size-3.5 animate-pulse-soft" />}
      <span className="font-medium">{s.connectivity === "LAN_DISCONNECTED" ? t("No network on this device") : t("Local server unreachable")}</span>
      <span>· {t("Reconnecting…")}</span>
    </div>
  );
}
