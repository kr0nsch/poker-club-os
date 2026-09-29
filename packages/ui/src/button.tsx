"use client";

import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import * as React from "react";
import { cn } from "./cn.js";

export const buttonVariants = cva(
  // Press feedback is a 1.5% dip with an expo-out release; colours change, layout never moves.
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium tracking-[-0.006em] transition-[background-color,border-color,color,opacity,transform,box-shadow] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] select-none active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-45 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // Primary: a light inverse button with a crisp top highlight.
        default: "bg-primary text-primary-foreground shadow-[0_1px_2px_rgb(0_0_0/0.45),inset_0_1px_0_rgb(255_255_255/0.6)] hover:bg-white active:bg-primary/85",
        // Secondary: one step up the surface ladder, hairline edge.
        secondary: "border border-white/[0.07] bg-secondary text-secondary-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.04),0_1px_2px_rgb(0_0_0/0.3)] hover:border-white/[0.11] hover:bg-accent",
        outline: "border border-border-strong bg-transparent text-foreground/90 hover:border-white/[0.14] hover:bg-white/[0.04] hover:text-foreground",
        ghost: "text-muted-foreground hover:bg-white/[0.05] hover:text-foreground",
        destructive: "bg-destructive text-destructive-foreground shadow-[0_1px_2px_rgb(0_0_0/0.4),inset_0_1px_0_rgb(255_255_255/0.2)] hover:bg-destructive/90 active:bg-destructive/80",
        success: "bg-success text-success-foreground shadow-[0_1px_2px_rgb(0_0_0/0.4),inset_0_1px_0_rgb(255_255_255/0.25)] hover:bg-success/90 active:bg-success/80",
        warning: "bg-warning text-warning-foreground shadow-[0_1px_2px_rgb(0_0_0/0.4),inset_0_1px_0_rgb(255_255_255/0.25)] hover:bg-warning/90 active:bg-warning/80",
        gold: "bg-gold text-gold-foreground shadow-[0_1px_2px_rgb(0_0_0/0.4),inset_0_1px_0_rgb(255_255_255/0.3)] hover:bg-gold/90 active:bg-gold/80",
        link: "text-gold underline-offset-4 hover:underline active:scale-100",
      },
      size: {
        // Compact under a mouse; every size grows to a finger-sized target on touch screens.
        sm: "h-8 px-3 text-[13px] pointer-coarse:h-10 [&_svg]:size-4",
        md: "h-9 px-3.5 text-sm pointer-coarse:h-11 [&_svg]:size-4",
        lg: "h-10 px-4 text-[15px] pointer-coarse:h-12 [&_svg]:size-[18px]",
        // Floor tablets and kiosks: large targets for fast operation during play.
        xl: "h-12 px-6 text-base pointer-coarse:h-14 [&_svg]:size-5",
        icon: "size-9 pointer-coarse:size-11 [&_svg]:size-[18px]",
      },
    },
    compoundVariants: [
      // Filled buttons turn into a readable graphite slab when disabled instead of fading to mud.
      {
        variant: ["default", "destructive", "success", "warning", "gold"],
        className: "disabled:bg-secondary disabled:text-muted-foreground disabled:opacity-100 disabled:shadow-none",
      },
    ],
    defaultVariants: { variant: "default", size: "md" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild = false, loading = false, disabled, children, ...props }, ref) => {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp className={cn(buttonVariants({ variant, size }), className)} ref={ref} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
      {asChild ? (
        children
      ) : (
        <>
          {loading && <Loader2 className="animate-spin" aria-hidden />}
          {children}
        </>
      )}
    </Comp>
  );
});
Button.displayName = "Button";
