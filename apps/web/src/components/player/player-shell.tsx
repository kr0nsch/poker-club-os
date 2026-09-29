"use client";

import { Button, cn, EmptyState } from "@pcos/ui";
import { Radio, Spade, Trophy, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { LanguageSwitch, SpadeMark } from "@/components/brand";
import { ConnectivityBadge } from "@/components/connectivity";
import { useT } from "@/lib/i18n";
import { RealtimeProvider } from "@/lib/realtime-context";
import { isLiveStatus, isNotFound, useInbox, usePlayerSession, usePublicTournaments } from "./api";

/** Player PWA frame: one realtime connection, header, and a thumb-friendly bottom navigation. */
export function PlayerLayout({ org, children }: { org: string; children: ReactNode }) {
  return (
    <RealtimeProvider>
      <PlayerShell org={org}>{children}</PlayerShell>
    </RealtimeProvider>
  );
}

function PlayerShell({ org, children }: { org: string; children: ReactNode }) {
  const t = useT();
  const path = usePathname() ?? "";
  const base = `/p/${org}`;
  const list = usePublicTournaments(org);
  const { isPlayer } = usePlayerSession(org);
  const inbox = useInbox(isPlayer);
  const unread = inbox.data?.filter((n) => !n.readAt).length ?? 0;
  const clubName = list.data?.organization.name;

  useEffect(() => {
    if (clubName) document.title = clubName;
  }, [clubName]);

  const live = (list.data?.tournaments ?? []).filter((x) => isLiveStatus(x.status) || x.status === "SEATING");
  const liveHref = live.length === 1 && live[0] ? `${base}/live/${live[0].slug}` : `${base}/live`;
  const authPage = path.startsWith(`${base}/login`) || path.startsWith(`${base}/signup`);

  const items = [
    { href: base, label: t("Tournaments"), icon: Trophy, active: path === base || path.startsWith(`${base}/t/`) || path.startsWith(`${base}/leaderboard`) },
    { href: liveHref, label: t("Live"), icon: Radio, active: path.startsWith(`${base}/live`), dot: live.some((x) => isLiveStatus(x.status)) },
    { href: `${base}/me`, label: t("Me"), icon: UserRound, active: path.startsWith(`${base}/me`) || authPage, badge: unread },
  ];

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-background/80 pt-[env(safe-area-inset-top)] backdrop-blur-xl">
        {/* Phone-first column; from lg the frame widens so pages can lay out two columns. */}
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center gap-2 px-4 lg:max-w-6xl">
          <Link href={base} className="flex h-10 min-w-0 items-center gap-2 font-semibold tracking-tight">
            <span className="grid size-7 shrink-0 place-items-center rounded-[8px] bg-gradient-to-b from-gold to-gold/75 text-gold-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.35),0_1px_3px_rgb(0_0_0/0.5)]">
              <SpadeMark className="size-3.5" />
            </span>
            <span className="truncate">{clubName ?? t("Poker Club")}</span>
          </Link>
          <nav className="ml-4 hidden items-center gap-1 md:flex">
            {items.map((i) => (
              <Link
                key={i.label}
                href={i.href}
                className={cn("relative rounded-md px-3 py-1.5 text-sm font-medium transition-colors", i.active ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                {i.label}
                {!!i.badge && <span className="ml-1.5 rounded-sm bg-gold px-1.5 text-[10px] font-bold text-gold-foreground">{i.badge}</span>}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <ConnectivityBadge compact />
            <LanguageSwitch />
            {isPlayer ? (
              <Button asChild variant="ghost" size="icon" aria-label={t("Profile")}>
                <Link href={`${base}/me`}>
                  <UserRound />
                </Link>
              </Button>
            ) : (
              !authPage && (
                <Button asChild variant="outline" size="sm">
                  <Link href={`${base}/login?next=${encodeURIComponent(path || base)}`}>{t("Sign in")}</Link>
                </Button>
              )
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-28 pt-4 md:pb-12 md:pt-6 lg:max-w-6xl lg:pt-8">
        {isNotFound(list.error) ? (
          <EmptyState icon={<Spade />} title={t("Club not found")} description={t("Check the address or scan the QR code at the venue again.")} className="mt-10" />
        ) : (
          children
        )}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-white/[0.06] bg-background/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden" aria-label={t("Main navigation")}>
        <div className="mx-auto grid max-w-3xl grid-cols-3">
          {items.map((i) => {
            const Icon = i.icon;
            return (
              <Link
                key={i.label}
                href={i.href}
                aria-current={i.active ? "page" : undefined}
                className={cn("relative flex flex-col items-center gap-1 py-2.5 text-xs font-medium transition-colors", i.active ? "text-gold" : "text-muted-foreground active:text-foreground")}
              >
                <span className="relative">
                  <Icon className="size-[22px]" strokeWidth={i.active ? 2 : 1.6} />
                  {i.dot && <span className="absolute -right-1 -top-0.5 size-2.5 rounded-full bg-destructive ring-2 ring-background" />}
                  {!!i.badge && (
                    <span className="absolute -right-2.5 -top-1.5 min-w-4.5 rounded-sm bg-gold px-1 text-center text-[10px] font-bold leading-4.5 text-gold-foreground ring-2 ring-background">
                      {i.badge > 9 ? "9+" : i.badge}
                    </span>
                  )}
                </span>
                {i.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
