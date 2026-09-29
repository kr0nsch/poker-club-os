"use client";

import * as React from "react";
import { cn } from "./cn.js";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, type, ...props }, ref) => (
  <input
    type={type}
    ref={ref}
    className={cn(
      "flex h-9 w-full rounded-md border border-white/[0.09] bg-white/[0.025] px-3 py-2 text-sm shadow-[inset_0_1px_2px_rgb(0_0_0/0.25)] transition-[border-color,box-shadow,background-color] placeholder:text-muted-foreground/70 hover:border-white/[0.14] focus-visible:border-gold/60 focus-visible:bg-white/[0.035] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-destructive/70 pointer-coarse:h-11",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "flex min-h-20 w-full rounded-md border border-white/[0.09] bg-white/[0.025] px-3 py-2 text-sm shadow-[inset_0_1px_2px_rgb(0_0_0/0.25)] transition-[border-color,box-shadow,background-color] placeholder:text-muted-foreground/70 hover:border-white/[0.14] focus-visible:border-gold/60 focus-visible:bg-white/[0.035] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/20 disabled:opacity-50",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";

/** Native select: accessible and fast on tablets and phones. */
export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      "flex h-9 w-full rounded-md border border-white/[0.09] bg-white/[0.025] px-3 py-1.5 text-sm shadow-[inset_0_1px_2px_rgb(0_0_0/0.25)] transition-[border-color,box-shadow] hover:border-white/[0.14] focus-visible:border-gold/60 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/20 disabled:opacity-50 pointer-coarse:h-11 [&>option]:bg-popover",
      className,
    )}
    {...props}
  >
    {children}
  </select>
));
Select.displayName = "Select";

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-[13px] font-medium leading-none text-foreground/85", className)} {...props} />;
}

export function Field({ label, hint, error, children, className, htmlFor }: { label?: React.ReactNode; hint?: React.ReactNode; error?: string | null; children: React.ReactNode; className?: string; htmlFor?: string }) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      {label && <Label htmlFor={htmlFor}>{label}</Label>}
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function Checkbox({ label, className, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label?: React.ReactNode }) {
  return (
    // The label is the hit area: at least 32 px under a mouse, 40 px on touch screens.
    <label className={cn("inline-flex min-h-8 min-w-8 cursor-pointer items-center justify-center gap-2 text-sm pointer-coarse:min-h-10 pointer-coarse:min-w-10", className)}>
      <input type="checkbox" className="size-4 accent-[var(--gold)] pointer-coarse:size-5" {...props} />
      {label}
    </label>
  );
}
