"use client";

import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Skeleton,
  Switch,
} from "@pcos/ui";
import { ArrowLeft, Check, ChevronLeft, ChevronRight, Copy, Lock } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useFormat, useT } from "@/lib/i18n";
import { errorMessage } from "@/lib/queries";

/** Load error with a retry button. */
export function QueryError({ error, onRetry, title, className }: { error: unknown; onRetry?: () => void; title?: string; className?: string }) {
  const t = useT();
  return (
    <Alert variant="destructive" title={title ?? t("Could not load data")} className={className}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>{errorMessage(error)}</span>
        {onRetry && (
          <Button size="sm" variant="outline" onClick={onRetry}>
            {t("Retry")}
          </Button>
        )}
      </div>
    </Alert>
  );
}

/** Confirmation for destructive or irreversible actions. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive = true,
  loading,
  confirmDisabled,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: ReactNode;
  destructive?: boolean;
  loading?: boolean;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  children?: ReactNode;
}) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>
            {t("Cancel")}
          </Button>
          <Button variant={destructive ? "destructive" : "default"} loading={loading} disabled={confirmDisabled} onClick={onConfirm}>
            {confirmLabel ?? t("Confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Currency amount typed in units (the API stores cents). */
export function MoneyInput({
  value,
  onChange,
  currency,
  disabled,
  id,
  placeholder,
  invalid,
}: {
  value: string;
  onChange: (v: string) => void;
  currency: string;
  disabled?: boolean;
  id?: string;
  placeholder?: string;
  invalid?: boolean;
}) {
  return (
    <div className="relative">
      <Input
        id={id}
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={placeholder ?? "0"}
        aria-invalid={invalid || undefined}
        className="pr-14 tabular-nums"
      />
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">{currency}</span>
    </div>
  );
}

/** Card section with title, optional description and header actions. */
export function Section({
  title,
  description,
  actions,
  children,
  className,
  contentClassName,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </CardHeader>
      {children !== undefined && <CardContent className={cn("grid gap-4", contentClassName)}>{children}</CardContent>}
    </Card>
  );
}

export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="size-4" /> {label}
    </Link>
  );
}

/** Switch with a label and optional description, as a single row. */
export function SwitchRow({
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
  className,
}: {
  label: ReactNode;
  description?: ReactNode;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn("flex items-start justify-between gap-4", className)}>
      <label htmlFor={id} className={cn("grid gap-0.5", disabled ? "cursor-not-allowed opacity-70" : "cursor-pointer")}>
        <span className="text-sm font-medium">{label}</span>
        {description && <span className="text-xs text-muted-foreground">{description}</span>}
      </label>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
    </div>
  );
}

/** Small "locked" marker for fields that cannot change in the current state. */
export function LockedNote({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <Lock className="size-3" /> {children}
    </span>
  );
}

/** Offset pagination: "1–50 of 230" with previous/next. `total` is optional. */
export function Pager({ offset, limit, count, total, onChange }: { offset: number; limit: number; count: number; total?: number | null; onChange: (offset: number) => void }) {
  const t = useT();
  const fmt = useFormat();
  if (count === 0 && offset === 0) return null;
  const from = count === 0 ? 0 : offset + 1;
  const to = offset + count;
  const hasNext = total != null ? to < total : count === limit;
  return (
    <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
      <span className="tabular-nums">
        {total != null ? t("{from}–{to} of {total}", { from: fmt.number(from), to: fmt.number(to), total: fmt.number(total) }) : t("{from}–{to}", { from: fmt.number(from), to: fmt.number(to) })}
      </span>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))} aria-label={t("Previous page")}>
          <ChevronLeft />
        </Button>
        <Button variant="outline" size="sm" disabled={!hasNext} onClick={() => onChange(offset + limit)} aria-label={t("Next page")}>
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}

export function CopyButton({ value, label }: { value: string; label?: string }) {
  const t = useT();
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const id = setTimeout(() => setDone(false), 1500);
    return () => clearTimeout(id);
  }, [done]);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
        } catch {
          toast.error(t("Could not copy to the clipboard"));
        }
      }}
    >
      {done ? <Check /> : <Copy />} {label ?? t("Copy")}
    </Button>
  );
}

/** Placeholder rows while a table loads. */
export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="grid gap-2">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-11" />
      ))}
    </div>
  );
}

/** Browser prompt when leaving the page with unsaved edits (reload / close tab). */
export function useUnsavedChangesWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
}

/** Bring the first invalid input into view after a failed validation. */
export function scrollToFirstInvalid() {
  requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.scrollIntoView({ block: "center", behavior: "smooth" }));
}

/** Debounced copy of a value. */
export function useDebounced<V>(value: V, delayMs = 300): V {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return v;
}

/** Sticky bottom bar for long forms with unsaved changes. */
export function SaveBar({
  dirty,
  saving,
  onSave,
  onDiscard,
  saveLabel,
  disabled,
  children,
  className,
}: {
  dirty: boolean;
  saving?: boolean;
  onSave: () => void;
  onDiscard?: () => void;
  saveLabel?: string;
  disabled?: boolean;
  children?: ReactNode;
  className?: string;
}) {
  const t = useT();
  return (
    <div className={cn("sticky bottom-0 z-20 -mx-4 mt-6 border-t border-border bg-background/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">{children ?? (dirty ? <span className="text-warning">{t("Unsaved changes")}</span> : t("All changes saved"))}</div>
        <div className="flex items-center gap-2">
          {onDiscard && (
            <Button variant="ghost" onClick={onDiscard} disabled={!dirty || saving}>
              {t("Discard changes")}
            </Button>
          )}
          <Button onClick={onSave} loading={saving} disabled={disabled}>
            {saveLabel ?? t("Save")}
          </Button>
        </div>
      </div>
    </div>
  );
}
