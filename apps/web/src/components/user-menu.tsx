"use client";

import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@pcos/ui";
import { useQueryClient } from "@tanstack/react-query";
import { Languages, LogOut, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { post } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useMe } from "@/lib/queries";

export function UserMenu() {
  const { t, locale, setLocale } = useI18n();
  const me = useMe();
  const qc = useQueryClient();
  const router = useRouter();
  async function signOut() {
    await post("/api/v1/auth/logout").catch(() => undefined);
    qc.clear();
    router.replace("/login");
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2">
          <UserRound />
          <span className="hidden max-w-32 truncate sm:inline">{me.data?.user?.displayName}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>
          {me.data?.user?.email}
          <div className="mt-0.5 font-normal">{me.data?.roles.join(", ")}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setLocale(locale === "ru" ? "en" : "ru")}>
          <Languages /> {t("Language")}: {locale === "ru" ? "Русский" : "English"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive onSelect={signOut}>
          <LogOut /> {t("Sign out")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
