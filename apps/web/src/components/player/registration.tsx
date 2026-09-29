"use client";

import type { RegistrationStatus } from "@pcos/types";
import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, cn } from "@pcos/ui";
import { ChevronRight, Maximize2, Radio } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { StatusBadge } from "@/components/status";
import { useFormat, useT } from "@/lib/i18n";
import { isLiveStatus, type MyRegistration } from "./api";
import { QrCode } from "./qr-code";

/** Registration states in which the player still has to check in with the QR code. */
export const NEEDS_CHECK_IN: readonly RegistrationStatus[] = ["REGISTERED", "RESERVED"];

/** QR thumbnail; tapping opens a large, high-contrast version for the desk scanner or kiosk. */
export function CheckInQr({ code, title, size = 96, className }: { code: string; title?: string; size?: number; className?: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn("group relative shrink-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}
        aria-label={t("Show QR code")}
      >
        <QrCode value={code} size={size} label={t("Check-in code")} />
        <span className="absolute -bottom-1.5 -right-1.5 grid size-6 place-items-center rounded-full bg-primary text-primary-foreground shadow ring-2 ring-card">
          <Maximize2 className="size-3.5" />
        </span>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{title ?? t("Check-in code")}</DialogTitle>
            <DialogDescription>{t("Show this QR code at the registration desk or kiosk")}</DialogDescription>
          </DialogHeader>
          <div className="grid place-items-center gap-3 py-2">
            <QrCode value={code} size={260} className="max-w-full" label={t("Check-in code")} />
            <div className="rounded-md bg-muted px-3 py-1.5 font-mono text-lg font-semibold tracking-[0.2em]">{code}</div>
            <p className="text-center text-xs text-muted-foreground">{t("Tip: turn up the screen brightness for faster scanning.")}</p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Card in "My registrations": tournament, status, waitlist position and check-in QR. */
export function RegistrationTicket({ reg, org }: { reg: MyRegistration; org: string }) {
  const t = useT();
  const f = useFormat();
  const live = isLiveStatus(reg.tournamentStatus) || reg.tournamentStatus === "SEATING";
  const showQr = !!reg.checkInCode && NEEDS_CHECK_IN.includes(reg.status);
  return (
    <div className="flex items-center gap-4 rounded-xl border border-border bg-card p-4">
      <div className="min-w-0 flex-1">
        <Link href={`/p/${org}/t/${reg.slug}`} className="group flex items-center gap-1 font-semibold leading-tight hover:text-primary">
          <span className="truncate">{reg.name}</span>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground group-hover:text-primary" />
        </Link>
        <div className="mt-0.5 text-sm text-muted-foreground">{f.dateTime(reg.startAt)}</div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <StatusBadge status={reg.status} />
          {reg.status === "WAITLISTED" && reg.waitlistPosition != null && <span className="text-xs text-muted-foreground">{t("Position {n}", { n: reg.waitlistPosition })}</span>}
        </div>
        {showQr && <div className="mt-2 font-mono text-xs tracking-widest text-muted-foreground">{reg.checkInCode}</div>}
        {live && (
          <Button asChild variant="link" size="sm" className="mt-1 h-auto px-0">
            <Link href={`/p/${org}/live/${reg.slug}`}>
              <Radio /> {t("Live page")}
            </Link>
          </Button>
        )}
      </div>
      {showQr && reg.checkInCode && <CheckInQr code={reg.checkInCode} title={reg.name} />}
    </div>
  );
}
