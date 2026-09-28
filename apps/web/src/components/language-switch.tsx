"use client";

import { cn } from "@pcos/ui";
import { useI18n } from "@/lib/i18n";

export function LanguageSwitchClient({ className }: { className?: string }) {
  const { locale, setLocale } = useI18n();
  return (
    <div className={cn("inline-flex rounded-md border border-border p-0.5 text-xs", className)} role="group" aria-label="Language">
      {(["en", "ru"] as const).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLocale(l)}
          className={cn("rounded px-2 py-1 font-medium uppercase", locale === l ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
