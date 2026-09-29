"use client";

import { cn } from "@pcos/ui";
import { CloudOff, ServerOff, WifiOff } from "lucide-react";
import { useT } from "@/lib/i18n";
import { useRealtimeState } from "@/lib/realtime-context";

/**
 * Connection indicator (spec §17, §76). A missing Internet connection is
 * shown as information, never as a fatal error: a quiet dot and a word, not an alarm.
 */
export function ConnectivityBadge({ compact = false, className }: { compact?: boolean; className?: string }) {
  const t = useT();
  const s = useRealtimeState();
  const map = {
    LOCAL_CONNECTED: { label: t("Local"), tone: "text-muted-foreground", dot: "bg-success", title: t("Local server connected") },
    WAN_OFFLINE: { label: t("Local · no Internet"), tone: "text-muted-foreground", dot: "bg-warning", title: `${t("Local server connected")} · ${t("Internet unavailable")} · ${t("Telegram notifications paused")} · ${t("Tournament operations fully available")}` },
    SYNC_PENDING: { label: t("Syncing…"), tone: "text-muted-foreground", dot: "bg-gold", title: t("Sync pending") },
    SERVER_UNREACHABLE: { label: t("Reconnecting…"), tone: "text-destructive", dot: "bg-destructive", title: t("Local server unreachable") },
    LAN_DISCONNECTED: { label: t("No network"), tone: "text-destructive", dot: "bg-destructive", title: t("No network on this device") },
  }[s.connectivity];
  return (
    <span role="status" title={map.title} className={cn("inline-flex items-center gap-2 whitespace-nowrap text-xs font-medium", map.tone, className)}>
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", map.dot)} />
      {/* On phones the dot alone carries the state; the words return from the sm breakpoint. */}
      <span className={compact ? "sr-only" : "max-sm:sr-only"}>{map.label}</span>
    </span>
  );
}

/** Banner for staff surfaces explaining degraded modes in plain language. */
export function ConnectivityBanner() {
  const t = useT();
  const s = useRealtimeState();
  if (s.connectivity === "LOCAL_CONNECTED" || s.connectivity === "SYNC_PENDING") return null;
  if (s.connectivity === "WAN_OFFLINE") {
    return (
      <div className="fade-in flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-warning/25 bg-warning/[0.07] px-4 py-1.5 text-xs text-warning">
        <CloudOff className="size-3.5" />
        <span className="font-medium">{t("Local server connected")}</span>
        <span className="text-warning/50">·</span>
        <span>{t("Internet unavailable")}</span>
        <span className="text-warning/50">·</span>
        <span>{t("Telegram notifications paused")}</span>
        <span className="text-warning/50">·</span>
        <span className="font-medium">{t("Tournament operations fully available")}</span>
      </div>
    );
  }
  return (
    <div className="fade-in flex items-center gap-2 border-b border-destructive/30 bg-destructive/[0.08] px-4 py-1.5 text-xs text-destructive">
      {s.connectivity === "LAN_DISCONNECTED" ? <WifiOff className="size-3.5" /> : <ServerOff className="size-3.5" />}
      <span className="font-medium">{s.connectivity === "LAN_DISCONNECTED" ? t("No network on this device") : t("Local server unreachable")}</span>
      <span>· {t("Reconnecting…")}</span>
    </div>
  );
}
