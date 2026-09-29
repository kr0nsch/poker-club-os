"use client";

import { formatClock } from "@pcos/domain";
import type { PlayerSelfUpdateInput } from "@pcos/types";
import { Alert, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, Field, Input, Select, Skeleton, Switch } from "@pcos/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, History, KeyRound, LogOut, Send, Unlink } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/status";
import { del, patch, post, setCsrfToken } from "@/lib/api";
import { useFormat, useI18n, useT } from "@/lib/i18n";
import { keys } from "@/lib/queries";
import { useServerNow } from "@/lib/realtime-context";
import { playerKeys, useTelegramLink, type PlayerProfile } from "./api";
import { useFriendlyError } from "./labels";
import { RankBadge } from "./leaderboard";

export function ProfileHeader({ profile, org }: { profile: PlayerProfile; org: string }) {
  const t = useT();
  const qc = useQueryClient();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function signOut() {
    setBusy(true);
    await post("/api/v1/auth/logout").catch(() => undefined);
    setCsrfToken(null);
    qc.clear();
    router.replace(`/p/${org}`);
  }
  const initials = `${profile.firstName.charAt(0)}${profile.lastName.charAt(0)}`.toUpperCase() || "?";
  return (
    <div className="flex items-center gap-4">
      <span className="grid size-14 shrink-0 place-items-center rounded-full bg-primary/15 text-lg font-bold text-primary">{initials}</span>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-xl font-semibold leading-tight">{profile.displayName}</h1>
        <div className="mt-0.5 flex flex-wrap gap-x-3 text-sm text-muted-foreground">
          {profile.memberNumber && (
            <span>
              {t("Member number")}: <span className="font-medium text-foreground tabular-nums">{profile.memberNumber}</span>
            </span>
          )}
          <span className="font-mono text-xs leading-5">{profile.externalPublicId}</span>
        </div>
      </div>
      <Button variant="ghost" size="sm" onClick={signOut} loading={busy} className="shrink-0">
        <LogOut /> <span className="hidden sm:inline">{t("Sign out")}</span>
      </Button>
    </div>
  );
}

/** 6-digit one-time code for the self check-in kiosk (valid 15 minutes, single use). */
export function KioskCodeCard() {
  const t = useT();
  const friendly = useFriendlyError();
  const now = useServerNow(1000);
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const issue = useMutation({
    mutationFn: () => post<{ code: string; expiresAt: string }>("/api/v1/me/one-time-code"),
    onSuccess: setCode,
    onError: (e) => toast.error(friendly(e).title),
  });
  const left = code ? Date.parse(code.expiresAt) - now : 0;
  const valid = !!code && left > 0;
  return (
    <Card className="felt border-primary/25">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="size-4 text-primary" /> {t("Kiosk check-in code")}
        </CardTitle>
        <CardDescription>{t("No QR code at hand? Get a one-time code and type it at the self check-in kiosk.")}</CardDescription>
      </CardHeader>
      <CardContent>
        {valid && code ? (
          <div className="grid gap-3 text-center">
            <div className="clock-digits text-5xl font-bold tracking-[0.15em] text-primary" aria-label={code.code.split("").join(" ")}>
              {code.code.slice(0, 3)}&thinsp;{code.code.slice(3)}
            </div>
            <div className="text-sm text-muted-foreground">
              {t("Valid for {time}", { time: formatClock(left) })} · {t("single use")}
            </div>
            <Button variant="outline" onClick={() => issue.mutate()} loading={issue.isPending}>
              {t("Get a new code")}
            </Button>
          </div>
        ) : (
          <div className="grid gap-2">
            {code && <p className="text-sm text-warning">{t("The code has expired.")}</p>}
            <Button size="lg" onClick={() => issue.mutate()} loading={issue.isPending}>
              {t("Get a one-time code")}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "ru", label: "Русский" },
];

export function ProfileForm({ profile }: { profile: PlayerProfile }) {
  const t = useT();
  const { locale, setLocale } = useI18n();
  const qc = useQueryClient();
  const friendly = useFriendlyError();
  // No stored language yet: suggest the current UI language.
  const initial = {
    nickname: profile.nickname ?? "",
    phone: profile.phone ?? "",
    language: profile.language ?? locale,
    marketingConsent: profile.marketingConsent,
    publicProfileEnabled: profile.publicProfileEnabled,
  };
  const [v, setV] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof initial>(k: K, value: (typeof initial)[K]) => setV((p) => ({ ...p, [k]: value }));

  const changes: PlayerSelfUpdateInput = {};
  if (v.nickname.trim() !== initial.nickname) changes.nickname = v.nickname.trim() || null;
  if (v.phone.trim() !== initial.phone) changes.phone = v.phone.trim() || null;
  if (v.language && v.language !== initial.language) changes.language = v.language;
  if (v.marketingConsent !== initial.marketingConsent) changes.marketingConsent = v.marketingConsent;
  if (v.publicProfileEnabled !== initial.publicProfileEnabled) changes.publicProfileEnabled = v.publicProfileEnabled;
  const dirty = Object.keys(changes).length > 0;

  const save = useMutation({
    mutationFn: () => patch("/api/v1/me/profile", changes),
    onSuccess: () => {
      toast.success(t("Profile saved"));
      if (changes.language === "en" || changes.language === "ru") setLocale(changes.language);
      void qc.invalidateQueries({ queryKey: playerKeys.profile });
      void qc.invalidateQueries({ queryKey: keys.me });
    },
    onError: (e) => setError(friendly(e).title),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (v.phone.trim() && !/^[+0-9 ()-]{3,32}$/.test(v.phone.trim())) {
      setError(t("Digits, spaces, +, - and ( ) only"));
      return;
    }
    save.mutate();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("Profile")}</CardTitle>
        <CardDescription>
          {profile.firstName} {profile.lastName}
          {profile.email ? ` · ${profile.email}` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-4">
          {error && <Alert variant="destructive">{error}</Alert>}
          <Field label={t("Nickname")} htmlFor="nickname" hint={t("Shown on seating lists and results instead of your name.")}>
            <Input id="nickname" value={v.nickname} maxLength={40} onChange={(e) => set("nickname", e.target.value)} className="h-11 text-base" autoComplete="nickname" />
          </Field>
          <Field label={t("Phone")} htmlFor="phone">
            <Input id="phone" type="tel" inputMode="tel" value={v.phone} maxLength={32} onChange={(e) => set("phone", e.target.value)} className="h-11 text-base" autoComplete="tel" />
          </Field>
          <Field label={t("Language of notifications")} htmlFor="language">
            <Select id="language" value={v.language} onChange={(e) => set("language", e.target.value)} className="h-11 text-base">
              {LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </Select>
          </Field>
          <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-border p-3">
            <span>
              <span className="block text-sm font-medium">{t("News and offers")}</span>
              <span className="block text-xs text-muted-foreground">{t("Receive news about tournaments and events from the club.")}</span>
            </span>
            <Switch checked={v.marketingConsent} onCheckedChange={(c) => set("marketingConsent", c)} />
          </label>
          <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-border p-3">
            <span>
              <span className="block text-sm font-medium">{t("Public profile")}</span>
              <span className="block text-xs text-muted-foreground">{t("Allow the club to show your results publicly.")}</span>
            </span>
            <Switch checked={v.publicProfileEnabled} onCheckedChange={(c) => set("publicProfileEnabled", c)} />
          </label>
          <Button type="submit" size="lg" disabled={!dirty} loading={save.isPending}>
            {t("Save")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export function TelegramCard() {
  const t = useT();
  const qc = useQueryClient();
  const friendly = useFriendlyError();
  const link = useTelegramLink(true);
  const [code, setCode] = useState("");
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: playerKeys.telegram });

  const connect = useMutation({
    mutationFn: () => post<{ url: string; expiresAt: string }>("/api/v1/telegram/link"),
    onMutate: () => {
      // Open the tab synchronously (inside the tap) so pop-up blockers allow it.
      const w = typeof window !== "undefined" ? window.open("about:blank", "_blank") : null;
      if (w) w.opener = null;
      return { w };
    },
    onSuccess: (res, _v, ctx) => {
      setDeepLink(res.url);
      if (ctx?.w && !ctx.w.closed) ctx.w.location.href = res.url;
    },
    onError: (e, _v, ctx) => {
      ctx?.w?.close();
      toast.error(friendly(e).title);
    },
  });
  const withCode = useMutation({
    mutationFn: () => post<{ ok: boolean; name: string }>("/api/v1/telegram/link/code", { code }),
    onSuccess: () => {
      setCode("");
      toast.success(t("Telegram connected"));
      refresh();
    },
    onError: (e) => toast.error(friendly(e).title),
  });
  const unlink = useMutation({
    mutationFn: () => del("/api/v1/telegram/link"),
    onSuccess: () => {
      toast.success(t("Telegram disconnected"));
      refresh();
    },
    onError: (e) => toast.error(friendly(e).title),
  });

  const s = link.data;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Send className="size-4 text-sky-400" /> Telegram
        </CardTitle>
        <CardDescription>{t("Get your seat, table moves and results in Telegram.")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {link.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : !s ? (
          <Alert variant="destructive">{friendly(link.error).title}</Alert>
        ) : s.linked ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm">
              <div className="font-medium text-primary">{t("Connected")}</div>
              {s.telegramUsername && <div className="text-muted-foreground">@{s.telegramUsername}</div>}
            </div>
            <Button variant="outline" size="sm" loading={unlink.isPending} onClick={() => unlink.mutate()}>
              <Unlink /> {t("Disconnect")}
            </Button>
          </div>
        ) : !s.available ? (
          <p className="text-sm text-muted-foreground">{t("Telegram notifications are not enabled at this club.")}</p>
        ) : (
          <>
            <Button size="lg" onClick={() => connect.mutate()} loading={connect.isPending}>
              <Send /> {t("Connect Telegram")}
            </Button>
            {deepLink && (
              <a href={deepLink} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-1.5 text-sm text-primary underline-offset-4 hover:underline">
                {t("Telegram did not open? Tap here")} <ExternalLink className="size-3.5" />
              </a>
            )}
            <form
              className="grid gap-2 border-t border-border pt-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (code.length === 8) withCode.mutate();
              }}
            >
              <Field
                label={t("Or enter the code from the bot")}
                htmlFor="tg-code"
                hint={s.botUsername ? t("Send /link to @{bot} to get an 8-character code.", { bot: s.botUsername }) : t("Send /link to the club's bot to get an 8-character code.")}
              >
                <div className="flex gap-2">
                  <Input
                    id="tg-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8))}
                    className="h-11 font-mono text-base uppercase tracking-[0.3em]"
                    autoComplete="one-time-code"
                    autoCapitalize="characters"
                    spellCheck={false}
                    placeholder="ABCD1234"
                  />
                  <Button type="submit" size="lg" variant="secondary" disabled={code.length !== 8} loading={withCode.isPending}>
                    {t("Link account")}
                  </Button>
                </div>
              </Field>
            </form>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function HistoryList({ profile, org }: { profile: PlayerProfile; org: string }) {
  const t = useT();
  const f = useFormat();
  const items = profile.history;
  if (items.length === 0) return <EmptyState icon={<History />} title={t("No tournaments yet")} description={t("Your tournament history and results will appear here.")} />;
  const played = items.filter((h) => h.position != null);
  const wins = played.filter((h) => h.position === 1).length;
  const best = played.reduce<number | null>((b, h) => (h.position != null && (b == null || h.position < b) ? h.position : b), null);
  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-3 gap-2 text-center">
        {[
          [t("Tournaments"), f.number(items.length)],
          [t("Wins"), f.number(wins)],
          [t("Best finish"), best != null ? `#${best}` : "—"],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-border bg-card p-3">
            <div className="text-xl font-semibold tabular-nums">{value}</div>
            <div className="text-xs text-muted-foreground">{label}</div>
          </div>
        ))}
      </div>
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {items.map((h) => (
          <li key={`${h.tournamentId}-${h.registrationStatus}`}>
            <Link href={`/p/${org}/t/${h.tournamentId}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40">
              {h.position != null ? <RankBadge rank={h.position} /> : <span className="size-7" />}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{h.name}</span>
                <span className="text-xs text-muted-foreground">{f.date(h.startAt)}</span>
              </span>
              {h.points != null && <span className="text-sm font-semibold tabular-nums">{t("{n} pts", { n: f.number(h.points) })}</span>}
              {h.position == null && <StatusBadge status={h.registrationStatus} />}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
