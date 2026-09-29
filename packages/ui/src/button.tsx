"use client";

import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import * as React from "react";
import { cn } from "./cn.js";

export const buttonVariants = cva(
  // Press feedback is a 1.5% dip with an expo-out release; colours change, layout never moves.
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-[background-color,border-color,color,opacity,transform] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] select-none active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-45 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.35)] hover:bg-primary/90 active:bg-primary/80",
        secondary: "edge-light border border-border-strong bg-secondary text-secondary-foreground hover:border-input hover:bg-accent",
        outline: "border border-border-strong bg-transparent hover:border-input hover:bg-accent hover:text-accent-foreground",
        ghost: "text-foreground/85 hover:bg-accent hover:text-accent-foreground",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90 active:bg-destructive/80",
        success: "bg-success text-success-foreground hover:bg-success/90 active:bg-success/80",
        warning: "bg-warning text-warning-foreground hover:bg-warning/90 active:bg-warning/80",
        gold: "bg-gold text-gold-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.28)] hover:bg-gold/90 active:bg-gold/80",
        link: "text-gold underline-offset-4 hover:underline active:scale-100",
      },
      size: {
        // Small buttons grow to a finger-sized target on touch screens (floor and dealer tablets).
        sm: "h-8 px-3 text-sm pointer-coarse:h-10 [&_svg]:size-4",
        md: "h-10 px-4 text-sm [&_svg]:size-4",
        lg: "h-12 px-6 text-base [&_svg]:size-5",
        // Floor tablets: large touch targets for fast operation during play.
        xl: "h-16 px-8 text-lg [&_svg]:size-6",
        icon: "h-10 w-10 [&_svg]:size-5",
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
