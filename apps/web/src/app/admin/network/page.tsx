"use client";

import { Alert, Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, PageHeader, Skeleton, cn } from "@pcos/ui";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Circle,
  CloudOff,
  LayoutDashboard,
  MonitorPlay,
  Network,
  RefreshCw,
  Router,
  Smartphone,
  Tablet,
  Wifi,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { lbl, useSysLabels } from "@/components/admin-system/labels";
import { sysKeys, useEdgeHealth, useStaffList, useTelegramIntegration, useTournamentOptions, useVenues } from "@/components/admin-system/queries";
import type { BackupRun, NetworkInfo } from "@/components/admin-system/types";
import { Bar, CopyButton, CopyField, ErrorState, InfoList, InfoRow, LiveDot, QrImage, RowsSkeleton, useLocaleTag } from "@/components/admin-system/ui";
import { useCan, useStaff } from "@/components/staff-guard";
import { UrlText } from "@/components/url-text";
import { get } from "@/lib/api";
import { useFormat, useT } from "@/lib/i18n";
import { useRealtimeState, useServerNow } from "@/lib/realtime-context";

/** Local network (spec §9, §101): staff should never type IP addresses. */
export default function NetworkPage() {
  // useSearchParams() needs a Suspense boundary for prerendering.
  return (
    <Suspense fallback={<RowsSkeleton rows={6} />}>
      <NetworkContent />
    </Suspense>
  );
}

function NetworkContent() {
  const t = useT();
  const params = useSearchParams();
  const welcome = params.get("welcome") === "1";
  const network = useQuery({ queryKey: sysKeys.network, queryFn: () => get<NetworkInfo>("/api/v1/edge/network"), refetchInterval: 10_000 });
  const n = network.data;

  return (
    <div className="grid gap-6">
      <PageHeader
        className="mb-0"
        title={t("Local network")}
        description={t("Staff never type IP addresses: scan a QR code or open the local address. Everything works on the venue network without the Internet.")}
        actions={
          <Button variant="outline" onClick={() => void network.refetch()} loading={network.isFetching && !network.isLoading}>
            <RefreshCw /> {t("Refresh")}
          </Button>
        }
      />
      {welcome && <FirstRunChecklist network={n} />}
      {network.error && <ErrorState error={network.error} onRetry={() => void network.refetch()} />}

      <div className="grid gap-4 md:grid-cols-3">
        <QrCard icon={Tablet} title={t("Staff app")} description={t("Floor tablets and phones: tournament control, registration, seating.")} url={n?.urls.staff} qr={n?.qr.staff} loading={network.isLoading} />
        <QrCard icon={Smartphone} title={t("Player page")} description={t("Players on the venue Wi-Fi: schedule, registration, live clock.")} url={n?.urls.player} qr={n?.qr.player} loading={network.isLoading} />
        <QrCard icon={LayoutDashboard} title={t("Admin")} description={t("Back office on a PC or laptop.")} url={n?.urls.admin} qr={n?.qr.admin} loading={network.isLoading} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <AddressesCard n={n} loading={network.isLoading} />
        <EdgeStatusCard />
      </div>

      <SetupHelpCard n={n} />
    </div>
  );
}

function QrCard({ icon: Icon, title, description, url, qr, loading }: { icon: LucideIcon; title: string; description: string; url?: string | null; qr?: string | null; loading: boolean }) {
  const t = useT();
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon className="size-4 text-primary" /> {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col items-center justify-center gap-3">
        {loading ? (
          <Skeleton className="size-[220px] rounded-xl" />
        ) : url ? (
          <>
            <QrImage value={url} dataUrl={qr} size={200} alt={t("QR code: {title}", { title })} />
            <a href={url} target="_blank" rel="noreferrer" className="max-w-full py-1.5 text-center font-mono text-sm text-primary [overflow-wrap:anywhere] hover:underline">
              <UrlText url={url} />
            </a>
            <CopyButton value={url} label={t("Copy link")} />
          </>
        ) : (
          <div className="grid justify-items-center gap-3 py-6 text-center text-sm text-muted-foreground">
            <Network className="size-8" />
            <p>{t("No local address yet. Set the venue's local hostname to get this QR code.")}</p>
            <Button asChild size="sm" variant="outline">
              <Link href="/admin/settings">{t("Open settings")}</Link>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AddressesCard({ n, loading }: { n?: NetworkInfo; loading: boolean }) {
  const t = useT();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Router className="size-4 text-primary" /> {t("Server addresses")}
        </CardTitle>
        <CardDescription>{t("How devices on the venue network reach this edge server.")}</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <RowsSkeleton rows={5} />
        ) : (
          <InfoList>
            <InfoRow label={t("Local hostname")}>
              {n?.localHostname ? (
                <code className="font-mono">{n.localHostname}</code>
              ) : (
                <span className="text-warning">
                  {t("Not set")} ·{" "}
                  <Link href="/admin/settings" className="underline">
                    {t("Set in Settings → Venues")}
                  </Link>
                </span>
              )}
            </InfoRow>
            <InfoRow label={t("Local address")}>{n?.localUrl ? <CopyField value={n.localUrl} /> : "—"}</InfoRow>
            <InfoRow label={t("IP fallback")}>
              {n?.urls.ipFallback ? (
                <div className="grid gap-1">
                  <CopyField value={n.urls.ipFallback} />
                  <span className="text-xs text-muted-foreground">{t("Only if the local name does not resolve on a device. The browser may warn about the certificate.")}</span>
                </div>
              ) : (
                "—"
              )}
            </InfoRow>
            <InfoRow label={t("Public address")}>{n?.publicUrl ? <CopyField value={n.publicUrl} /> : <span className="text-muted-foreground">{t("Not configured: local-only operation")}</span>}</InfoRow>
            <InfoRow label={t("Edge node")}>
              <code className="font-mono">{n?.nodeId ?? "—"}</code>
            </InfoRow>
            <InfoRow label={t("Connected clients")}>
              <span className="inline-flex items-center gap-2 tabular-nums">
                <LiveDot on={(n?.connectedClients ?? 0) > 0} />
                {n?.connectedClients ?? 0}
                <span className="text-xs text-muted-foreground">{t("live connections (tablets, TVs, browsers)")}</span>
              </span>
            </InfoRow>
          </InfoList>
        )}
      </CardContent>
    </Card>
  );
}

function EdgeStatusCard() {
  const t = useT();
  const fmt = useFormat();
  const tag = useLocaleTag();
  const L = useSysLabels();
  const s = useRealtimeState();
  const now = useServerNow(1_000);
  const e = s.edge;
  const socketOpen = s.socket === "open";
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wifi className="size-4 text-primary" /> {t("Edge status")}
        </CardTitle>
        <CardDescription>{t("Live status pushed by the edge server.")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {e && !e.wanOnline && (
          <Alert variant="warning" title={t("Internet unavailable")}>
            {t("Telegram and cloud sync wait for the connection. Tournaments, registration, displays and all local operations keep working.")}
          </Alert>
        )}
        <InfoList>
          <InfoRow label={t("This device")}>
            {socketOpen ? (
              <span className="inline-flex items-center gap-2">
                <LiveDot on /> {t("Connected to the edge server")}
              </span>
            ) : (
              <span className="inline-flex items-center gap-2 text-destructive">
                <LiveDot on={false} /> {t("Reconnecting…")}
              </span>
            )}
          </InfoRow>
          <InfoRow label={t("Edge server")}>{e ? <Badge variant={e.status === "ONLINE" ? "success" : "warning"}>{lbl(L.edgeStatus, e.status)}</Badge> : "—"}</InfoRow>
          <InfoRow label={t("Internet (WAN)")}>
            {e ? (
              e.wanOnline ? (
                <Badge variant="success">{t("Online")}</Badge>
              ) : (
                <span className="inline-flex flex-wrap items-center gap-2">
                  <Badge variant="warning">
                    <CloudOff className="size-3" /> {t("Offline")}
                  </Badge>
                  <span className="text-xs text-muted-foreground">{t("local operations unaffected")}</span>
                </span>
              )
            ) : (
              "—"
            )}
          </InfoRow>
          <InfoRow label={t("Last Internet contact")}>{e?.lastWanSeenAt ? <span title={fmt.dateTime(e.lastWanSeenAt)}>{fmt.relative(e.lastWanSeenAt)}</span> : "—"}</InfoRow>
          <InfoRow label="Telegram">{e ? lbl(L.telegramStatus, e.telegram) : "—"}</InfoRow>
          <InfoRow label={t("Cloud sync")}>
            {e ? (
              e.cloudSync.enabled ? (
                <span>
                  {t("On")} · {t("{n} pending", { n: e.cloudSync.pending })}
                  {e.cloudSync.lastSyncAt && <span className="text-muted-foreground"> · {t("last sync {when}", { when: fmt.relative(e.cloudSync.lastSyncAt) })}</span>}
                </span>
              ) : (
                <span className="text-muted-foreground">{t("Off (optional)")}</span>
              )
            ) : (
              "—"
            )}
          </InfoRow>
          <InfoRow label={t("Server time")}>
            <span className="tabular-nums">{new Date(now).toLocaleTimeString(tag, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
            <span className="ml-2 text-xs text-muted-foreground">{t("this device's clock differs by {ms} ms", { ms: s.offsetMs })}</span>
          </InfoRow>
        </InfoList>
      </CardContent>
    </Card>
  );
}

function SetupHelpCard({ n }: { n?: NetworkInfo }) {
  const t = useT();
  const host = n?.localHostname ?? "poker.club.example";
  const ip = n?.ip ?? "192.168.1.10";
  const steps: { icon: LucideIcon; title: string; body: ReactNode }[] = [
    { icon: Router, title: t("Static address for the edge server"), body: t("Reserve a fixed IP address for the edge server in the router's DHCP settings (static lease). Current address: {ip}.", { ip }) },
    { icon: Network, title: t("Local DNS name"), body: t("Add a local DNS record {host} → {ip} on the router or local DNS server, so devices open the name instead of an IP address.", { host, ip }) },
    {
      icon: Wifi,
      title: t("Staff Wi-Fi and guest Wi-Fi"),
      body: t("Keep staff tablets, TVs and kiosks on the staff Wi-Fi. Players and guests use the guest Wi-Fi; let it reach the edge server only if players should open the local player pages."),
    },
    {
      icon: MonitorPlay,
      title: t("TV displays"),
      body: (
        <>
          {t("Each TV opens its own link /display/<token>.")}{" "}
          <Link href="/admin/displays" className="text-primary hover:underline">
            {t("Create display links")}
          </Link>
        </>
      ),
    },
    {
      icon: Tablet,
      title: t("Dealer tablets"),
      body: (
        <>
          {t("Dealer tablets open /dealer and sign in; assign their table on the Devices page.")}{" "}
          <Link href="/admin/devices" className="text-primary hover:underline">
            {t("Devices")}
          </Link>
        </>
      ),
    },
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("Venue network setup")}</CardTitle>
        <CardDescription>{t("One-time checklist for the venue's router and Wi-Fi.")}</CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {steps.map((s, i) => (
            <li key={s.title} className="flex gap-3 rounded-lg border border-border p-3">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/15 text-xs font-semibold text-primary">{i + 1}</span>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-sm font-medium">
                  <s.icon className="size-3.5 text-muted-foreground" /> {s.title}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

// --- first-run checklist (spec §101) --------------------------------------------------------------

interface ChecklistItem {
  key: string;
  title: string;
  detail: string;
  /** null = unknown (loading or not visible for this role) */
  state: "done" | "warn" | "todo" | null;
  optional?: boolean;
  href?: string;
  action?: string;
}

function FirstRunChecklist({ network }: { network?: NetworkInfo }) {
  const t = useT();
  const fmt = useFormat();
  const L = useSysLabels();
  const can = useCan();
  const me = useStaff();
  const router = useRouter();
  const venues = useVenues();
  const health = useEdgeHealth(can("edge.read"));
  const telegram = useTelegramIntegration(can("telegram.manage"));
  const backups = useQuery({ queryKey: sysKeys.backups, queryFn: () => get<BackupRun[]>("/api/v1/edge/backups"), enabled: can("backup.manage") });
  const staff = useStaffList(can("staff.manage"));
  const tournaments = useTournamentOptions(can("tournament.read"));

  const lastBackup = backups.data?.find((b) => b.status === "SUCCEEDED");
  const degraded = health.data?.components.filter((c) => c.state === "DEGRADED" || c.state === "DOWN") ?? [];
  const items: ChecklistItem[] = [
    { key: "org", title: t("Organization"), detail: me.organization?.name ?? "", state: "done" },
    { key: "venue", title: t("Venue"), detail: venues.data?.map((v) => v.name).join(", ") ?? "", state: venues.data ? (venues.data.length > 0 ? "done" : "todo") : null, href: "/admin/settings" },
    { key: "edge", title: t("Edge node"), detail: network?.nodeId ?? "", state: network ? "done" : null },
    {
      key: "hostname",
      title: t("Local hostname"),
      detail: network?.localHostname ?? t("Not set: staff would have to use the IP address"),
      state: network ? (network.localHostname ? "done" : "todo") : null,
      href: "/admin/settings",
      action: t("Set hostname"),
    },
    {
      key: "health",
      title: t("Network health"),
      detail: health.data ? (degraded.length ? t("Needs attention: {list}", { list: degraded.map((c) => lbl(L.component, c.name)).join(", ") }) : t("All components OK")) : "",
      state: health.data ? (health.data.overall === "OK" ? "done" : "warn") : null,
      href: "/admin/health",
      action: t("Check"),
    },
    {
      key: "telegram",
      title: "Telegram",
      detail: telegram.data?.enabled && telegram.data.tokenConfigured ? (telegram.data.botUsername ? `@${telegram.data.botUsername}` : t("Configured")) : t("Player notifications and staff alerts"),
      state: telegram.data ? (telegram.data.enabled && telegram.data.tokenConfigured ? "done" : "todo") : null,
      optional: true,
      href: "/admin/telegram",
      action: t("Configure"),
    },
    {
      key: "backups",
      title: t("Backups"),
      detail: lastBackup ? t("Last successful backup {when}", { when: fmt.relative(lastBackup.finishedAt) }) : t("No successful backup yet"),
      state: backups.data ? (lastBackup ? "done" : "todo") : null,
      href: "/admin/health",
      action: t("Run a backup"),
    },
    {
      key: "staff",
      title: t("Staff accounts"),
      detail: staff.data ? t("Staff accounts: {n}", { n: staff.data.length }) : "",
      state: staff.data ? (staff.data.length > 1 ? "done" : "todo") : null,
      href: "/admin/staff",
      action: t("Add staff"),
    },
    {
      key: "tournament",
      title: t("First tournament"),
      detail: tournaments.data ? (tournaments.data.length ? t("Tournaments: {n}", { n: tournaments.data.length >= 200 ? "200+" : tournaments.data.length }) : t("No tournaments yet")) : "",
      state: tournaments.data ? (tournaments.data.length > 0 ? "done" : "todo") : null,
      href: "/admin/tournaments",
      action: t("Create"),
    },
  ];
  const done = items.filter((i) => i.state === "done").length;

  return (
    <Card className="border-primary/40">
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle className="text-lg">{t("Welcome! Your edge server is running")}</CardTitle>
          <CardDescription>{t("Finish these steps to get the venue ready. You can come back to this list at any time.")}</CardDescription>
        </div>
        <Button variant="ghost" size="sm" onClick={() => router.replace("/admin/network")}>
          <X /> {t("Hide checklist")}
        </Button>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex items-center gap-3">
          <Bar value={done} max={items.length} className="h-2.5" />
          <span className="shrink-0 text-sm text-muted-foreground tabular-nums">{t("{done} of {total} done", { done, total: items.length })}</span>
        </div>
        <ul className="grid gap-2 md:grid-cols-2">
          {items.map((i) => {
            const Icon = i.state === "done" ? CheckCircle2 : i.state === "warn" ? AlertTriangle : Circle;
            return (
              <li key={i.key} className={cn("flex items-center gap-3 rounded-lg border p-3", i.state === "done" ? "border-border bg-muted/20" : "border-border")}>
                <Icon className={cn("size-5 shrink-0", i.state === "done" ? "text-success" : i.state === "warn" ? "text-warning" : "text-muted-foreground")} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {i.title}
                    {i.optional && <Badge variant="muted">{t("Optional")}</Badge>}
                  </div>
                  {i.detail && <div className="truncate text-xs text-muted-foreground">{i.detail}</div>}
                </div>
                {i.href && i.state !== "done" && (
                  <Button asChild size="sm" variant={i.state === "warn" ? "outline" : "secondary"}>
                    <Link href={i.href}>
                      {i.action ?? t("Open")} <ArrowRight />
                    </Link>
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
