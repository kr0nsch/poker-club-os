"use client";

import type { NotificationType } from "@pcos/types";
import { Button, cn, EmptyState, Skeleton, Switch } from "@pcos/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Armchair, Bell, CalendarClock, CheckCheck, ChevronRight, Megaphone, Ticket, Trophy, TriangleAlert } from "lucide-react";
import Link from "next/link";
import type { ComponentType } from "react";
import { toast } from "sonner";
import { post, put } from "@/lib/api";
import { useFormat, useT } from "@/lib/i18n";
import { PREF_CHANNELS, playerKeys, useInbox, useNotificationPrefs, type InboxItem, type NotificationPreference, type PrefChannel } from "./api";
import { useFriendlyError } from "./labels";

export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  REGISTRATION_CONFIRMED: "Registration confirmed",
  REGISTRATION_CANCELLED: "Registration cancelled",
  TOURNAMENT_REMINDER: "Tournament reminder",
  TOURNAMENT_CHANGED: "Tournament changed",
  TOURNAMENT_CANCELLED: "Tournament cancelled",
  REGISTRATION_OPENING: "Registration opened",
  LATE_REGISTRATION_CLOSING: "Late registration closing",
  SEAT_ASSIGNED: "Seat assigned",
  TABLE_MOVE: "Table move",
  RESULTS_FINALIZED: "Final results",
  LEAGUE_POSITION_CHANGED: "League position",
  ANNOUNCEMENT: "Announcement",
  STAFF_ALERT: "Staff alert",
};

/** Types that the club may also send by email (see the notification service). */
const EMAIL_TYPES: readonly NotificationType[] = ["REGISTRATION_CONFIRMED", "TOURNAMENT_CANCELLED", "TOURNAMENT_CHANGED", "RESULTS_FINALIZED"];

const str = (v: unknown) => (v == null ? "" : String(v));

interface Rendered {
  title: string;
  body: string;
  icon: ComponentType<{ className?: string }>;
  tone: "default" | "gold" | "warning" | "destructive";
  href: string | null;
}

/** Client-side rendering of a notification (type + payload), localized. */
export function useNotificationText(org: string) {
  const t = useT();
  const f = useFormat();
  return (n: InboxItem): Rendered => {
    const p = n.payload;
    const name = str(p.tournamentName) || t("the tournament");
    const start = typeof p.startAt === "string" ? f.dateTime(p.startAt) : str(p.startLabel);
    const tid = typeof p.tournamentId === "string" ? p.tournamentId : null;
    const details = tid ? `/p/${org}/t/${tid}` : null;
    const live = tid ? `/p/${org}/live/${tid}` : null;
    const title = t(NOTIFICATION_TYPE_LABELS[n.type] ?? n.type);
    switch (n.type) {
      case "REGISTRATION_CONFIRMED":
        return p.status === "WAITLISTED"
          ? { title, body: t("You are on the waitlist (#{n}) for {tournament}.", { n: str(p.waitlistPosition), tournament: name }), icon: Ticket, tone: "warning", href: details }
          : { title, body: start ? t("You are registered for {tournament} — {start}.", { tournament: name, start }) : t("You are registered for {tournament}.", { tournament: name }), icon: Ticket, tone: "default", href: details };
      case "REGISTRATION_CANCELLED":
        return { title, body: t("Your registration for {tournament} was cancelled.", { tournament: name }), icon: Ticket, tone: "warning", href: details };
      case "TOURNAMENT_REMINDER":
        return { title, body: t("{tournament} starts {start}. See you at the tables!", { tournament: name, start }), icon: CalendarClock, tone: "default", href: details };
      case "TOURNAMENT_CHANGED":
        return { title, body: start ? t("{tournament} was updated: now starts {start}.", { tournament: name, start }) : t("{tournament} was updated.", { tournament: name }), icon: CalendarClock, tone: "warning", href: details };
      case "TOURNAMENT_CANCELLED":
        return {
          title,
          body: `${t("{tournament} has been cancelled.", { tournament: name })}${p.reason ? ` ${t("Reason")}: ${str(p.reason)}` : ""}`,
          icon: TriangleAlert,
          tone: "destructive",
          href: details,
        };
      case "REGISTRATION_OPENING":
        return { title, body: t("Registration for {tournament} ({start}) is now open.", { tournament: name, start }), icon: Ticket, tone: "default", href: details };
      case "LATE_REGISTRATION_CLOSING":
        return { title, body: t("Late registration for {tournament} closes in about {minutes} min.", { tournament: name, minutes: str(p.minutes) }), icon: CalendarClock, tone: "warning", href: live };
      case "SEAT_ASSIGNED":
        return { title, body: t("{tournament}: table {table}, seat {seat}.", { tournament: name, table: str(p.tableNumber), seat: str(p.seatNumber) }), icon: Armchair, tone: "gold", href: live };
      case "TABLE_MOVE":
        return { title, body: t("Please move to table {table}, seat {seat} ({tournament}).", { tournament: name, table: str(p.tableNumber), seat: str(p.seatNumber) }), icon: Armchair, tone: "gold", href: live };
      case "RESULTS_FINALIZED":
        return {
          title,
          body: `${t("{tournament}: you finished #{position} of {players}.", { tournament: name, position: str(p.position), players: str(p.players) })}${typeof p.points === "number" ? ` ${t("Points")}: ${f.number(p.points)}` : ""}`,
          icon: Trophy,
          tone: "gold",
          href: live,
        };
      case "LEAGUE_POSITION_CHANGED":
        return {
          title,
          body: t("You are now #{rank} in {league} with {points} points.", { rank: str(p.rank), league: str(p.leagueName) || t("the league"), points: typeof p.points === "number" ? f.number(p.points) : str(p.points) }),
          icon: Trophy,
          tone: "gold",
          href: `/p/${org}/leaderboard`,
        };
      case "ANNOUNCEMENT":
        return { title: str(p.tournamentName) || title, body: str(p.body), icon: Megaphone, tone: "default", href: details };
      default:
        return { title, body: str(p.body), icon: Bell, tone: "default", href: null };
    }
  };
}

const TONE: Record<Rendered["tone"], string> = {
  default: "bg-primary/15 text-primary",
  gold: "bg-gold/15 text-gold",
  warning: "bg-warning/15 text-warning",
  destructive: "bg-destructive/15 text-destructive",
};

export function Inbox({ org }: { org: string }) {
  const t = useT();
  const f = useFormat();
  const qc = useQueryClient();
  const inbox = useInbox(true);
  const render = useNotificationText(org);
  const unread = inbox.data?.filter((n) => !n.readAt).length ?? 0;
  const markAll = useMutation({
    mutationFn: () => post("/api/v1/me/notifications/read", { ids: "all" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: playerKeys.inbox }),
  });

  if (inbox.isLoading) return <Skeleton className="h-48 w-full" />;
  const items = inbox.data ?? [];
  if (items.length === 0) return <EmptyState icon={<Bell />} title={t("No notifications yet")} description={t("Registration confirmations, seat assignments and results will appear here.")} />;

  return (
    <div className="grid gap-3">
      {unread > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <span className="whitespace-nowrap text-sm text-muted-foreground">{t("Unread: {n}", { n: unread })}</span>
          <Button variant="ghost" size="sm" className="-mr-2 ml-auto" loading={markAll.isPending} onClick={() => markAll.mutate()}>
            <CheckCheck /> {t("Mark all as read")}
          </Button>
        </div>
      )}
      <ul className="grid gap-2">
        {items.map((n) => {
          const r = render(n);
          const Icon = r.icon;
          const body = (
            <>
              <span className={cn("grid size-10 shrink-0 place-items-center rounded-full", TONE[r.tone])}>
                <Icon className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className={cn("truncate font-semibold", n.readAt && "font-medium text-foreground/80")}>{r.title}</span>
                  {!n.readAt && <span className="size-2 shrink-0 rounded-full bg-primary" aria-label={t("Unread")} />}
                </span>
                {r.body && <span className="mt-0.5 block text-sm text-muted-foreground">{r.body}</span>}
                <span className="mt-1 block text-xs text-muted-foreground/80">{f.relative(n.createdAt)}</span>
              </span>
              {r.href && <ChevronRight className="mt-2.5 size-4 shrink-0 text-muted-foreground" />}
            </>
          );
          const cls = cn("flex gap-3 rounded-xl border p-3", n.readAt ? "border-border bg-card/60" : "border-primary/30 bg-card");
          return <li key={n.id}>{r.href ? <Link href={r.href} className={cn(cls, "hover:border-primary/50")}>{body}</Link> : <div className={cls}>{body}</div>}</li>;
        })}
      </ul>
    </div>
  );
}

const CHANNEL_LABELS: Record<PrefChannel, string> = { IN_APP: "App", TELEGRAM: "Telegram", EMAIL: "Email" };

export function NotificationPreferences() {
  const t = useT();
  const qc = useQueryClient();
  const friendly = useFriendlyError();
  const prefs = useNotificationPrefs(true);
  const save = useMutation({
    mutationFn: (v: { type: NotificationType; channel: PrefChannel; enabled: boolean }) => put("/api/v1/me/notification-preferences", v),
    onMutate: (v) => {
      const prev = qc.getQueryData<NotificationPreference[]>(playerKeys.prefs);
      if (prev) qc.setQueryData<NotificationPreference[]>(playerKeys.prefs, prev.map((p) => (p.type === v.type ? { ...p, channels: { ...p.channels, [v.channel]: v.enabled } } : p)));
      return { prev };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(playerKeys.prefs, ctx.prev);
      toast.error(friendly(e).title);
    },
  });

  if (prefs.isLoading) return <Skeleton className="h-64 w-full" />;
  const rows = (prefs.data ?? []).filter((p) => p.type !== "STAFF_ALERT");
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <div className="grid grid-cols-[1fr_repeat(3,3.75rem)] items-center gap-x-1 border-b border-border bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground">
        <span>{t("Notification")}</span>
        {PREF_CHANNELS.map((c) => (
          <span key={c} className="text-center">
            {t(CHANNEL_LABELS[c])}
          </span>
        ))}
      </div>
      {rows.map((p) => (
        <div key={p.type} className="grid grid-cols-[1fr_repeat(3,3.75rem)] items-center gap-x-1 border-b border-border px-3 py-2.5 text-sm last:border-0">
          <span className="min-w-0 pr-2">{t(NOTIFICATION_TYPE_LABELS[p.type] ?? p.type)}</span>
          {PREF_CHANNELS.map((c) =>
            c === "EMAIL" && !EMAIL_TYPES.includes(p.type) ? (
              <span key={c} className="text-center text-muted-foreground/50">
                —
              </span>
            ) : (
              <span key={c} className="flex justify-center">
                <Switch
                  checked={p.channels[c]}
                  onCheckedChange={(enabled) => save.mutate({ type: p.type, channel: c, enabled })}
                  aria-label={`${t(NOTIFICATION_TYPE_LABELS[p.type] ?? p.type)} · ${t(CHANNEL_LABELS[c])}`}
                />
              </span>
            ),
          )}
        </div>
      ))}
    </div>
  );
}
