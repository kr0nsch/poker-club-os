"use client";

// Small shared building blocks for the venue & system administration pages.

import {
  Alert,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Skeleton,
  cn,
  type ButtonProps,
} from "@pcos/ui";
import { Check, Copy, RefreshCw } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import { useI18n, useT } from "@/lib/i18n";
import { errorMessage } from "@/lib/queries";
import type { ComponentState } from "./types";

export type TFn = ReturnType<typeof useT>;

/** Intl locale tag matching useFormat(). */
export function useLocaleTag() {
  const { locale } = useI18n();
  return locale === "ru" ? "ru-RU" : "en-GB";
}

/**
 * Timestamps from raw SQL arrive as "2026-09-28 17:34:44.801+03" instead of
 * ISO strings; normalise them before handing them to Date.
 */
export function toDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  let s = v.trim();
  if (/^\d{4}-\d{2}-\d{2} \d/.test(s)) s = s.replace(" ", "T");
  s = s.replace(/([+-]\d{2})$/, "$1:00");
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export const toIso = (v: string | Date | null | undefined) => toDate(v)?.toISOString() ?? null;

/** round(...)::numeric columns are serialised as strings. */
export function num(v: number | string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function formatBytes(n: number | null | undefined, tag: string): string {
  if (n == null) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toLocaleString(tag, { maximumFractionDigits: i === 0 ? 0 : 1 })} ${units[i]}`;
}

export function shortId(id: string | null | undefined, n = 8) {
  return id ? id.slice(0, n) : "—";
}

export function prettyJson(v: unknown): string {
  if (v === undefined) return "—";
  try {
    return JSON.stringify(v, null, 2) ?? "null";
  } catch {
    return String(v);
  }
}

/**
 * Copy text to the clipboard. navigator.clipboard needs a secure context,
 * which a venue LAN address over plain HTTP is not — fall back to execCommand.
 * The helper textarea is placed inside an open dialog so its focus trap does
 * not steal the selection.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall back below */
  }
  try {
    const host = (document.activeElement?.closest('[role="dialog"]') as HTMLElement | null) ?? document.body;
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.left = "0";
    ta.style.opacity = "0";
    host.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    host.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([prettyJson(data)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function CopyButton({
  value,
  label,
  size = "sm",
  variant = "outline",
  className,
}: {
  value: string;
  label?: string;
  size?: ButtonProps["size"];
  variant?: ButtonProps["variant"];
  className?: string;
}) {
  const t = useT();
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const id = setTimeout(() => setDone(false), 1_500);
    return () => clearTimeout(id);
  }, [done]);
  return (
    <Button
      type="button"
      size={size}
      variant={variant}
      className={cn(!label && "px-2", className)}
      title={t("Copy")}
      aria-label={label ?? t("Copy")}
      onClick={async () => {
        if (await copyText(value)) {
          setDone(true);
          toast.success(t("Copied to clipboard"));
        } else {
          toast.error(t("Could not copy. Select the text and copy it manually."));
        }
      }}
    >
      {done ? <Check className="text-success" /> : <Copy />}
      {label}
    </Button>
  );
}

/** Read-only value with a copy button (URLs, IDs). */
export function CopyField({ value, className, mono = true }: { value: string; className?: string; mono?: boolean }) {
  return (
    <div className={cn("flex min-w-0 items-center gap-2", className)}>
      <code className={cn("min-w-0 flex-1 truncate rounded-md border border-border bg-background/60 px-2.5 py-1.5 text-sm", mono && "font-mono")} title={value}>
        {value}
      </code>
      <CopyButton value={value} />
    </div>
  );
}

export function JsonBlock({ value, className }: { value: unknown; className?: string }) {
  const text = useMemo(() => prettyJson(value), [value]);
  return (
    <pre className={cn("max-h-96 overflow-auto rounded-lg border border-border bg-background/60 p-3 font-mono text-xs leading-relaxed whitespace-pre text-foreground/90", className)}>
      {text}
    </pre>
  );
}

/** Client-side QR code (the `qrcode` package; nothing leaves the LAN). */
export function useQrCode(text: string | null | undefined, width = 320): string | null {
  const [state, setState] = useState<{ text: string; url: string } | null>(null);
  useEffect(() => {
    if (!text) return;
    let alive = true;
    QRCode.toDataURL(text, { margin: 1, width, errorCorrectionLevel: "M" })
      .then((url) => {
        if (alive) setState({ text, url });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [text, width]);
  return text && state?.text === text ? state.url : null;
}

/** QR image on a white quiet zone (dark-on-light is what phone cameras expect). */
export function QrImage({ value, dataUrl, size = 192, alt }: { value: string; dataUrl?: string | null; size?: number; alt: string }) {
  const generated = useQrCode(dataUrl ? null : value);
  const src = dataUrl ?? generated;
  return (
    <div className="rounded-xl bg-white p-2.5 shadow-sm" style={{ width: size + 20, height: size + 20 }}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- data: URL generated locally
        <img src={src} alt={alt} width={size} height={size} className="block" style={{ imageRendering: "pixelated" }} />
      ) : (
        <Skeleton className="size-full bg-neutral-200" />
      )}
    </div>
  );
}

export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  const t = useT();
  const forbidden = error instanceof ApiError && error.status === 403;
  const network = error instanceof ApiError && error.isNetwork;
  return (
    <Alert
      variant={forbidden ? "warning" : "destructive"}
      className={className}
      title={forbidden ? t("You do not have permission to view this") : network ? t("Local server unreachable") : t("Could not load data")}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="break-words">{errorMessage(error)}</span>
        {onRetry && !forbidden && (
          <Button size="sm" variant="outline" onClick={onRetry}>
            <RefreshCw /> {t("Retry")}
          </Button>
        )}
      </div>
    </Alert>
  );
}

/** Shown instead of a section the current role may not use. */
export function NoAccess({ permission, className }: { permission: string; className?: string }) {
  const t = useT();
  return (
    <Alert variant="warning" className={className} title={t("You do not have permission to view this")}>
      {t("Ask an owner or manager for the “{permission}” permission.", { permission })}
    </Alert>
  );
}

export function RowsSkeleton({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("grid gap-2", className)}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-9" />
      ))}
    </div>
  );
}

const STATE_TONE: Record<ComponentState, "success" | "warning" | "destructive" | "muted"> = {
  OK: "success",
  DEGRADED: "warning",
  DOWN: "destructive",
  DISABLED: "muted",
};

export function StateBadge({ state, className }: { state: string; className?: string }) {
  const t = useT();
  const labels: Record<string, string> = { OK: t("OK"), DEGRADED: t("Degraded"), DOWN: t("Down"), DISABLED: t("Disabled") };
  return (
    <Badge variant={STATE_TONE[state as ComponentState] ?? "outline"} className={className}>
      {labels[state] ?? state}
    </Badge>
  );
}

export function LiveDot({ on, className, title }: { on: boolean; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={cn("inline-block size-2 shrink-0 rounded-full", on ? "bg-success shadow-[0_0_0_3px_color-mix(in_oklab,var(--success)_25%,transparent)]" : "bg-muted-foreground/40", className)}
    />
  );
}

/** Label/value rows for detail panels. */
export function InfoList({ children, className }: { children: ReactNode; className?: string }) {
  return <dl className={cn("grid gap-2.5 text-sm", className)}>{children}</dl>;
}

export function InfoRow({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("grid grid-cols-[minmax(7rem,40%)_1fr] items-start gap-3", className)}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

/** Horizontal CSS bar (no chart library). */
export function Bar({ value, max, className, tone = "primary" }: { value: number; max: number; className?: string; tone?: "primary" | "warning" | "destructive" | "muted" | "gold" }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const color = { primary: "bg-primary", warning: "bg-warning", destructive: "bg-destructive", muted: "bg-muted-foreground/50", gold: "bg-gold" }[tone];
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-muted", className)}>
      <div className={cn("h-full rounded-full transition-[width] duration-500", color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

// --- confirmation dialog -------------------------------------------------------------------------

export interface ConfirmOptions {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  action: () => Promise<unknown>;
}

/**
 * Imperative confirmation for destructive actions:
 *   const { confirm, dialog } = useConfirm(); … confirm({ title, action }) … {dialog}
 */
export function useConfirm() {
  const t = useT();
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const [busy, setBusy] = useState(false);
  const dialog = (
    <Dialog
      open={!!opts}
      onOpenChange={(open) => {
        if (!open && !busy) setOpts(null);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{opts?.title}</DialogTitle>
          {opts?.description && <DialogDescription asChild={typeof opts.description !== "string"}>{typeof opts.description === "string" ? opts.description : <div>{opts.description}</div>}</DialogDescription>}
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={() => setOpts(null)}>
            {t("Cancel")}
          </Button>
          <Button
            variant={opts?.destructive === false ? "default" : "destructive"}
            loading={busy}
            onClick={async () => {
              if (!opts) return;
              setBusy(true);
              try {
                await opts.action();
                setOpts(null);
              } catch (e) {
                toast.error(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {opts?.confirmLabel ?? t("Confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
  return { confirm: setOpts, dialog };
}
