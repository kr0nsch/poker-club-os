"use client";

import { Badge } from "@pcos/ui";
import { useT } from "@/lib/i18n";

const TONE: Record<string, "default" | "success" | "warning" | "destructive" | "muted" | "secondary" | "outline"> = {
  DRAFT: "muted",
  SCHEDULED: "secondary",
  REGISTRATION_OPEN: "default",
  SEATING: "default",
  RUNNING: "success",
  BREAK: "warning",
  PAUSED: "warning",
  HAND_FOR_HAND: "destructive",
  FINISHED: "secondary",
  FINALIZED: "outline",
  CANCELLED: "destructive",
  RESERVED: "muted",
  REGISTERED: "secondary",
  CHECKED_IN: "default",
  WAITLISTED: "warning",
  PLAYING: "success",
  ELIMINATED: "muted",
  NO_SHOW: "destructive",
  ACTIVE: "success",
  VOIDED: "destructive",
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const t = useT();
  return (
    <Badge variant={TONE[status] ?? "outline"} className={className}>
      {status === "RUNNING" && <span aria-hidden className="size-1.5 rounded-full bg-current" />}
      {/* English has no dictionary entry for the enum keys: show REGISTRATION_OPEN as "REGISTRATION OPEN". */}
      {t(status).replaceAll("_", " ")}
    </Badge>
  );
}
