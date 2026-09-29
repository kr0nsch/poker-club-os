"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import * as React from "react";
import { cn } from "./cn.js";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("edge-light rounded-lg border border-border bg-card text-card-foreground", className)} {...props} />;
}
export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1 p-5 pb-3", className)} {...props} />;
}
export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-[15px] font-semibold leading-tight [&_svg]:text-muted-foreground", className)} {...props} />;
}
export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm text-muted-foreground", className)} {...props} />;
}
export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-5 pt-0", className)} {...props} />;
}
export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-center gap-2 p-5 pt-0", className)} {...props} />;
}

// Status tags: square-ish, hairline border in the status colour, no filled pills.
export const badgeVariants = cva("inline-flex items-center gap-1.5 rounded-[5px] border px-1.5 py-px text-xs font-medium leading-4 whitespace-nowrap [&_svg]:size-3", {
  variants: {
    variant: {
      default: "border-gold/35 bg-gold/8 text-gold",
      secondary: "border-border-strong bg-secondary text-secondary-foreground",
      outline: "border-border-strong text-foreground/85",
      success: "border-success/35 bg-success/8 text-success",
      warning: "border-warning/35 bg-warning/8 text-warning",
      destructive: "border-destructive/40 bg-destructive/8 text-destructive",
      muted: "border-border bg-transparent text-muted-foreground",
    },
  },
  defaultVariants: { variant: "default" },
});

export function Badge({ className, variant, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-sm text-muted-foreground", className)} role="status">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {label}
    </span>
  );
}

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("sheen rounded-md bg-muted", className)} {...props} />;
}

export function EmptyState({ icon, title, description, action, className }: { icon?: React.ReactNode; title: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border-strong px-6 py-12 text-center", className)}>
      {icon && <div className="mb-1 text-muted-foreground/70 [&_svg]:size-7 [&_svg]:stroke-[1.5]">{icon}</div>}
      <p className="font-medium">{title}</p>
      {description && <p className="max-w-md text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Stat({ label, value, hint, className }: { label: React.ReactNode; value: React.ReactNode; hint?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("edge-light rounded-lg border border-border bg-card px-4 py-3.5", className)}>
      <div className="eyebrow">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function Separator({ className }: { className?: string }) {
  return <div role="separator" className={cn("h-px w-full bg-border", className)} />;
}

export function Kbd({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return <kbd className={cn("rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px]", className)} {...props} />;
}

export function PageHeader({ title, description, actions, className }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5", className)}>
      <div className="min-w-0">
        <h1 className="text-[26px] font-semibold leading-tight">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Alert({ variant = "default", title, children, className }: { variant?: "default" | "warning" | "destructive" | "success"; title?: React.ReactNode; children?: React.ReactNode; className?: string }) {
  // A faint tint of the state colour; the title carries the colour, the text stays readable.
  const tone = {
    default: "border-border-strong bg-card",
    warning: "border-warning/30 bg-warning/[0.07] [&_[data-title]]:text-warning",
    destructive: "border-destructive/35 bg-destructive/[0.08] [&_[data-title]]:text-destructive",
    success: "border-success/30 bg-success/[0.07] [&_[data-title]]:text-success",
  }[variant];
  return (
    <div role="alert" className={cn("rounded-lg border px-4 py-3 text-sm", tone, className)}>
      {title && (
        <div data-title className="font-semibold">
          {title}
        </div>
      )}
      {children && <div className={cn(title && "mt-1", "text-foreground/85")}>{children}</div>}
    </div>
  );
}
