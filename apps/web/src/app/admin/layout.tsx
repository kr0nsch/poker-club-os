"use client";

import { Button, cn } from "@pcos/ui";
import type { Permission } from "@pcos/types";
import {
  Activity,
  BarChart3,
  Cable,
  ClipboardList,
  Gauge,
  Layers,
  LayoutDashboard,
  Menu,
  MonitorPlay,
  Send,
  Settings,
  ShieldCheck,
  Tablet,
  Trophy,
  Users,
  UsersRound,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Brand } from "@/components/brand";
import { ConnectivityBadge, ConnectivityBanner } from "@/components/connectivity";
import { StaffGuard, useCan } from "@/components/staff-guard";
import { UserMenu } from "@/components/user-menu";
import { useT } from "@/lib/i18n";
import { RealtimeProvider } from "@/lib/realtime-context";

interface NavItem {
  href: string;
  label: string;
  icon: typeof Gauge;
  permission?: Permission;
}

function Nav({ onNavigate }: { onNavigate?: () => void }) {
  const t = useT();
  const path = usePathname();
  const can = useCan();
  const groups: { title: string; items: NavItem[] }[] = [
    {
      title: t("Operations"),
      items: [
        { href: "/admin", label: t("Dashboard"), icon: LayoutDashboard },
        { href: "/floor", label: t("Floor control"), icon: Tablet, permission: "tournament.read" },
        { href: "/admin/tournaments", label: t("Tournaments"), icon: Trophy, permission: "tournament.read" },
        { href: "/admin/structures", label: t("Structures & templates"), icon: Layers, permission: "tournament.read" },
        { href: "/admin/players", label: t("Players"), icon: Users, permission: "player.read" },
        { href: "/admin/leagues", label: t("Leagues"), icon: BarChart3, permission: "tournament.read" },
      ],
    },
    {
      title: t("Venue"),
      items: [
        { href: "/admin/displays", label: t("Displays & kiosks"), icon: MonitorPlay, permission: "display.manage" },
        { href: "/admin/network", label: t("Local network"), icon: Cable, permission: "edge.read" },
        { href: "/admin/devices", label: t("Devices"), icon: Tablet, permission: "device.manage" },
        { href: "/admin/health", label: t("Health & backups"), icon: Activity, permission: "edge.read" },
      ],
    },
    {
      title: t("Administration"),
      items: [
        { href: "/admin/telegram", label: "Telegram", icon: Send, permission: "telegram.manage" },
        { href: "/admin/staff", label: t("Staff"), icon: UsersRound, permission: "staff.manage" },
        { href: "/admin/analytics", label: t("Analytics"), icon: Gauge, permission: "analytics.read" },
        { href: "/admin/audit", label: t("Audit log"), icon: ClipboardList, permission: "audit.read" },
        { href: "/admin/settings", label: t("Settings"), icon: Settings, permission: "settings.manage" },
      ],
    },
  ];
  return (
    <nav className="grid gap-5 text-sm">
      {groups.map((g) => {
        const items = g.items.filter((i) => !i.permission || can(i.permission));
        if (items.length === 0) return null;
        return (
          <div key={g.title} className="grid gap-0.5">
            <div className="px-3 pb-1 text-xs font-medium text-muted-foreground/80">{g.title}</div>
            {items.map((i) => {
              const active = i.href === "/admin" ? path === "/admin" : path.startsWith(i.href);
              const Icon = i.icon;
              return (
                <Link
                  key={i.href}
                  href={i.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-3 py-2 transition-colors",
                    active ? "edge-light bg-accent font-medium text-foreground [&_svg]:text-gold" : "text-foreground/75 hover:bg-accent/60 hover:text-foreground [&_svg]:text-muted-foreground",
                  )}
                >
                  <Icon className="size-4 transition-colors" />
                  {i.label}
                </Link>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-6 overflow-y-auto border-r border-border bg-card/40 p-4 lg:flex">
        <Link href="/admin" className="flex h-10 items-center">
          <Brand />
        </Link>
        <Nav />
        <div className="mt-auto flex items-center gap-2 px-3 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5" /> Venue Edge Server
        </div>
      </aside>
      {open && (
        <div className="fade-in fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={() => setOpen(false)}>
          <aside className="h-full w-72 overflow-y-auto border-r border-border bg-card p-4" onClick={(e) => e.stopPropagation()}>
            <div className="mb-6 flex items-center justify-between">
              <Brand />
              <Button variant="ghost" size="icon" onClick={() => setOpen(false)}>
                <X />
              </Button>
            </div>
            <Nav onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-border bg-background">
          <ConnectivityBanner />
          {/* Same column as <main> so the header edges line up with the page on wide screens. */}
          <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-3 px-4 md:px-6 min-[1800px]:max-w-[96rem]">
            <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(true)}>
              <Menu />
            </Button>
            <div className="flex-1" />
            <ConnectivityBadge />
            <UserMenu />
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 p-4 md:p-6 min-[1800px]:max-w-[96rem]">{children}</main>
      </div>
    </div>
  );
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <StaffGuard>
      <RealtimeProvider>
        <Shell>{children}</Shell>
      </RealtimeProvider>
    </StaffGuard>
  );
}
