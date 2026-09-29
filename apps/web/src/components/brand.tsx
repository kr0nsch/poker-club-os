import { cn } from "@pcos/ui";
import type { CSSProperties } from "react";
import { LanguageSwitchClient } from "./language-switch";

/** Spade drawn as a single path so it renders crisply at small sizes on TVs and tablets. */
export function SpadeMark({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} style={style} fill="currentColor">
      <path d="M12 2.5c-.4 0-.8.2-1.1.5C8.1 6 4 9.3 4 13.2 4 15.9 6 18 8.5 18c1.1 0 2.1-.4 2.8-1.1-.2 1.6-.9 3-2.1 4.1-.3.3-.1.9.4.9h4.8c.5 0 .7-.6.4-.9-1.2-1.1-1.9-2.5-2.1-4.1.7.7 1.7 1.1 2.8 1.1 2.5 0 4.5-2.1 4.5-4.8 0-3.9-4.1-7.2-6.9-10.2-.3-.3-.7-.5-1.1-.5Z" />
    </svg>
  );
}

export function Brand({ className, name = "Poker Club OS" }: { className?: string; name?: string }) {
  return (
    <div className={cn("flex min-w-0 items-center gap-2.5", className)}>
      <span className="grid size-7 shrink-0 place-items-center rounded-md border border-gold/45 text-gold">
        <SpadeMark className="size-3.5" />
      </span>
      <span className="truncate text-[15px] font-semibold tracking-tight">{name}</span>
    </div>
  );
}

export const LanguageSwitch = LanguageSwitchClient;
