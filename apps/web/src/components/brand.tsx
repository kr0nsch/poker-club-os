import { cn } from "@pcos/ui";
import { Spade } from "lucide-react";
import { LanguageSwitchClient } from "./language-switch";

export function Brand({ className, name = "Poker Club OS" }: { className?: string; name?: string }) {
  return (
    <div className={cn("flex items-center gap-2 font-semibold tracking-tight", className)}>
      <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
        <Spade className="size-4.5" fill="currentColor" />
      </span>
      <span>{name}</span>
    </div>
  );
}

export const LanguageSwitch = LanguageSwitchClient;
