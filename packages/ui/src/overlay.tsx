"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as DropdownPrimitive from "@radix-ui/react-dropdown-menu";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { X } from "lucide-react";
import * as React from "react";
import { cn } from "./cn.js";

// --- Dialog --------------------------------------------------------------------

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({ className, children, wide, ...props }: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { wide?: boolean }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fade-in fixed inset-0 z-50 bg-black/65 backdrop-blur-[3px]" />
      {/* Centred by a plain wrapper so the entrance transform on the panel cannot fight the centring. */}
      <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center p-4">
        <DialogPrimitive.Content
          className={cn(
            "rise-in pointer-events-auto relative grid max-h-[90dvh] w-full gap-4 overflow-y-auto rounded-2xl border border-white/[0.08] bg-popover p-6 shadow-[inset_0_1px_0_rgb(255_255_255/0.05),0_32px_80px_-16px_rgb(0_0_0/0.75)]",
            wide ? "max-w-3xl" : "max-w-lg",
            className,
          )}
          {...props}
        >
          {children}
          <DialogPrimitive.Close className="absolute right-3.5 top-3.5 grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <X className="size-[18px]" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </div>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1.5 pr-6", className)} {...props} />;
}
export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  // Sticks to the bottom of a dialog that scrolls (long forms on a phone), so the actions stay in reach.
  return <div className={cn("sticky -bottom-6 z-10 -mx-6 -mb-6 flex flex-col-reverse gap-2 bg-popover px-6 pb-6 pt-3 sm:flex-row sm:justify-end", className)} {...props} />;
}
export function DialogTitle({ className, ...props }: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn("text-lg font-semibold tracking-[-0.018em]", className)} {...props} />;
}
export function DialogDescription({ className, ...props }: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

// --- Dropdown menu ------------------------------------------------------------------

export const DropdownMenu = DropdownPrimitive.Root;
export const DropdownMenuTrigger = DropdownPrimitive.Trigger;

export function DropdownMenuContent({ className, sideOffset = 4, ...props }: React.ComponentPropsWithoutRef<typeof DropdownPrimitive.Content>) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.Content
        sideOffset={sideOffset}
        className={cn("fade-in z-50 min-w-48 overflow-hidden rounded-xl border border-white/[0.08] bg-popover p-1 text-popover-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.05),0_16px_48px_-12px_rgb(0_0_0/0.7)]", className)}
        {...props}
      />
    </DropdownPrimitive.Portal>
  );
}

export function DropdownMenuItem({ className, destructive, ...props }: React.ComponentPropsWithoutRef<typeof DropdownPrimitive.Item> & { destructive?: boolean }) {
  return (
    <DropdownPrimitive.Item
      className={cn(
        "relative flex cursor-pointer select-none items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] outline-none focus:bg-white/[0.07] data-[disabled]:pointer-events-none data-[disabled]:opacity-50 pointer-coarse:py-2.5 [&_svg]:size-4 [&_svg]:text-muted-foreground",
        destructive && "text-destructive focus:bg-destructive/15",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({ className }: { className?: string }) {
  return <DropdownPrimitive.Separator className={cn("-mx-1 my-1 h-px bg-white/[0.06]", className)} />;
}

export function DropdownMenuLabel({ className, ...props }: React.ComponentPropsWithoutRef<typeof DropdownPrimitive.Label>) {
  return <DropdownPrimitive.Label className={cn("px-2.5 py-1.5 text-xs font-medium text-muted-foreground", className)} {...props} />;
}

// --- Tabs ------------------------------------------------------------------------------

export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }: React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>) {
  // A segmented control: a recessed track with the active tab lifted onto it. Scrolls sideways on a
  // phone when the labels do not fit.
  return (
    <TabsPrimitive.List
      className={cn("inline-flex h-9 max-w-full items-center gap-0.5 overflow-x-auto rounded-lg border border-white/[0.06] bg-white/[0.03] p-0.5 text-muted-foreground [scrollbar-width:none] pointer-coarse:h-11", className)}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "inline-flex h-full min-w-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 text-[13px] font-medium transition-[color,background-color,box-shadow] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50 data-[state=active]:bg-secondary data-[state=active]:text-foreground data-[state=active]:shadow-[inset_0_1px_0_rgb(255_255_255/0.05),0_1px_2px_rgb(0_0_0/0.4)] [&_svg]:size-4",
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn("fade-in mt-4 focus-visible:outline-none", className)} {...props} />;
}

// --- Switch ------------------------------------------------------------------------------

export function Switch({ className, ...props }: React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        // Touch screens get a thumb-sized switch (48×28); a mouse keeps the compact one. The ::after
        // box extends the hit area 8 px on every side without changing the layout.
        "peer relative inline-flex h-5 w-9 shrink-0 after:absolute after:-inset-2 cursor-pointer items-center rounded-full border border-border-strong transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-transparent data-[state=checked]:bg-gold data-[state=unchecked]:bg-white/[0.1] pointer-coarse:h-7 pointer-coarse:w-12",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block size-4 rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.45)] ring-0 transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] data-[state=checked]:translate-x-[17px] data-[state=unchecked]:translate-x-px pointer-coarse:size-6 pointer-coarse:data-[state=checked]:translate-x-[21px]" />
    </SwitchPrimitive.Root>
  );
}
