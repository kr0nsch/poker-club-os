"use client";

import { formatClock } from "@pcos/domain";
import type { AnnouncementView, DisplayWidget, PublicLiveSnapshot } from "@pcos/types";
import { cn } from "@pcos/ui";
import { Coffee, Hand, Pause, Trophy } from "lucide-react";
import { SpadeMark } from "@/components/brand";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useLeaderboards, type PublicLeague } from "@/components/player/api";
import { useTournamentText } from "@/components/player/labels";
import { useLiveClock } from "@/components/player/live-clock";
import { useFormat, useI18n, useT } from "@/lib/i18n";
import { useRealtimeState, useServerNow } from "@/lib/realtime-context";
import { useIdleCursor, useVenueDevice, useWakeLock } from "./device-hooks";
import { isRevoked, safeColor, useDeviceSnapshot, useDeviceState, type DeviceState } from "./device-state";

// Everything is sized in viewport units so the same page reads well on any
// 16:9 TV from across the room. min(vw, vh) keeps odd aspect ratios sane.
const fs = (vw: number, vh: number) => `min(${vw}vw, ${vh}vh)`;

const FALLBACK_WIDGETS: DisplayWidget[] = ["CLOCK", "BLINDS", "NEXT_LEVEL", "ENTRIES", "REMAINING", "AVERAGE_STACK", "ANNOUNCEMENTS"];
const SEATING_ROWS = 12;
const SEATING_COLS = 3;

type Widgets = ReadonlySet<DisplayWidget>;

function Tile({ label, value, sub, accent }: { label: string; value: ReactNode; sub?: ReactNode; accent?: boolean }) {
  return (
    <div className="rounded-[1vh] border border-white/[0.09] px-[1.6vw] py-[1.6vh]">
      <div className="font-mono font-medium uppercase tracking-[0.14em] text-white/50" style={{ fontSize: fs(1.15, 2.1) }}>
        {label}
      </div>
      <div className={cn("mt-[0.6vh] font-mono font-medium leading-tight tracking-tight tabular-nums", accent && "text-[var(--tv-accent)]")} style={{ fontSize: fs(3, 5.4) }}>
        {value}
      </div>
      {sub && (
        <div className="tabular-nums text-white/60" style={{ fontSize: fs(1.5, 2.7) }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function OfflineDot({ offline }: { offline: boolean }) {
  const t = useT();
  if (!offline) return null;
  return <span className="inline-block size-[1.4vh] animate-pulse rounded-full bg-red-500 shadow-[0_0_1vh_rgba(239,68,68,0.9)]" title={t("Local server unreachable")} aria-label={t("Local server unreachable")} />;
}

function Header({ state, snap, now, offline, widgets }: { state: DeviceState; snap: PublicLiveSnapshot | null; now: number; offline: boolean; widgets: Widgets }) {
  const f = useFormat();
  const org = state.organization?.name ?? snap?.tournament.organizationName ?? "";
  return (
    <header className="relative mx-[3vw] flex items-center gap-[1.5vw] border-b border-white/[0.08] pb-[1.8vh] pt-[2.4vh]">
      {widgets.has("LOGO") && (
        <div className="flex min-w-0 items-center gap-[0.8vw]">
          <span className="grid shrink-0 place-items-center rounded-[0.8vh] border-2 border-[color-mix(in_srgb,var(--tv-accent)_55%,transparent)] text-[var(--tv-accent)]" style={{ width: fs(3.4, 6), height: fs(3.4, 6) }}>
            <SpadeMark style={{ width: fs(1.9, 3.4), height: fs(1.9, 3.4) }} />
          </span>
          <span className="truncate font-semibold text-white/85" style={{ fontSize: fs(1.8, 3.2) }}>
            {org}
          </span>
        </div>
      )}
      <div className="min-w-0 flex-1 truncate text-center font-bold tracking-tight" style={{ fontSize: fs(2.6, 4.6) }}>
        {snap?.tournament.name ?? ""}
      </div>
      <div className="flex shrink-0 items-center gap-[0.8vw] tabular-nums text-white/70" style={{ fontSize: fs(2, 3.6) }}>
        <OfflineDot offline={offline} />
        {f.time(new Date(now))}
      </div>
    </header>
  );
}

function Banner({ announcement, sponsor }: { announcement: AnnouncementView | null; sponsor: string | null }) {
  if (!announcement && !sponsor) return null;
  const tone =
    announcement?.severity === "CRITICAL" ? "bg-red-600 text-white" : announcement?.severity === "WARNING" ? "bg-amber-400 text-black" : "bg-[var(--tv-accent)] text-black";
  return (
    <footer className="relative flex items-stretch gap-[1.5vw] px-[3vw] pb-[2.4vh]">
      {announcement ? (
        <div className={cn("flex min-w-0 flex-1 items-center rounded-[1.2vh] px-[1.6vw] py-[1.2vh] font-semibold leading-snug", tone)} style={{ fontSize: fs(2.2, 3.9) }}>
          <span className="line-clamp-2 whitespace-pre-line break-words">{announcement.body}</span>
        </div>
      ) : (
        <div className="flex-1" />
      )}
      {sponsor && (
        <div className="flex max-w-[30vw] shrink-0 items-center truncate text-white/55" style={{ fontSize: fs(1.6, 2.8) }}>
          {sponsor}
        </div>
      )}
    </footer>
  );
}

function LeaderboardPanel({ league, rows = 8 }: { league: PublicLeague; rows?: number }) {
  const t = useT();
  const f = useFormat();
  return (
    <div className="rounded-[1vh] border border-white/[0.09] px-[1.4vw] py-[1.4vh]">
      <div className="truncate font-mono font-medium uppercase tracking-[0.14em] text-white/50" style={{ fontSize: fs(1.15, 2.1) }}>
        {league.league.name}
      </div>
      <ol className="mt-[0.8vh] grid gap-[0.5vh]" style={{ fontSize: fs(1.6, 2.9) }}>
        {league.rows.slice(0, rows).map((r) => (
          <li key={r.playerId} className="flex items-center gap-[0.6vw]">
            <span className={cn("w-[2.2vw] shrink-0 text-right font-bold tabular-nums", r.rank === 1 ? "text-gold" : "text-white/60")}>{r.rank}</span>
            <span className="min-w-0 flex-1 truncate">{r.playerName}</span>
            <span className="shrink-0 font-semibold tabular-nums">{f.number(r.points)}</span>
          </li>
        ))}
        {league.rows.length === 0 && <li className="text-white/50">{t("No results in this season yet.")}</li>}
      </ol>
    </div>
  );
}

function ClockScreen({ snap, widgets, league, now }: { snap: PublicLiveSnapshot; widgets: Widgets; league: PublicLeague | null; now: number }) {
  const t = useT();
  const f = useFormat();
  const tt = useTournamentText();
  const v = useLiveClock(snap);
  const d = v.d;
  if (!d) return null;
  const stats = snap.stats;
  const left: ReactNode[] = [];
  if (widgets.has("ENTRIES")) left.push(<Tile key="e" label={t("Entries")} value={f.number(stats.entries)} sub={stats.reentries > 0 ? `${t("Re-entries")}: ${f.number(stats.reentries)}` : undefined} />);
  if (widgets.has("REMAINING")) left.push(<Tile key="r" label={t("Remaining")} value={f.number(stats.remaining)} />);
  if (widgets.has("AVERAGE_STACK")) left.push(<Tile key="a" label={t("Average stack")} value={f.number(stats.averageStack)} />);
  if (widgets.has("PRIZE_POOL") && stats.prizePool != null) left.push(<Tile key="p" label={t("Prize pool")} value={f.money(stats.prizePool, snap.tournament.buyIn?.currency)} accent />);

  const right: ReactNode[] = [];
  if (widgets.has("NEXT_LEVEL")) {
    const following = v.followingLevel;
    right.push(
      v.isBreak || following?.type !== "BREAK" ? (
        <Tile key="n" label={t("Next level")} value={v.next ? tt.blinds(v.next) : "—"} sub={tt.ante(v.next) ?? undefined} />
      ) : (
        <Tile key="n" label={t("Next level")} value={<span className="text-gold">{t("Break")}</span>} sub={tt.minutes(following.durationSeconds)} />
      ),
    );
  }
  if (widgets.has("NEXT_BREAK") && !v.isBreak) right.push(<Tile key="b" label={t("Next break")} value={d.msUntilNextBreak != null ? formatClock(d.msUntilNextBreak) : "—"} />);
  if (widgets.has("LEADERBOARD") && league) right.push(<LeaderboardPanel key="l" league={league} rows={5} />);

  const sides = left.length > 0 || right.length > 0;
  const long = d.formatted.length > 5;
  const clockSize = sides ? (long ? fs(11, 24) : fs(15, 29)) : long ? fs(16, 30) : fs(22, 36);
  const pct = d.levelDurationMs > 0 ? Math.min(100, (d.elapsedMs / d.levelDurationMs) * 100) : 0;
  const resumeAt = v.isBreak && !v.paused ? new Date(now + d.remainingMs) : null;
  const shownLevel = v.isBreak ? v.next : v.level;

  return (
    <div className={cn("grid h-full items-center gap-[2vw] px-[3vw]", sides ? "grid-cols-[1fr_2.3fr_1fr]" : "grid-cols-1")}>
      {sides && <div className="grid content-center gap-[1.6vh]">{left}</div>}
      <div className="relative flex min-w-0 flex-col items-center justify-center text-center">
        <div className={cn("flex items-center gap-[1vw] font-mono font-medium uppercase tracking-[0.2em]", v.isBreak ? "text-gold" : "text-[var(--tv-accent)]")} style={{ fontSize: fs(2.6, 4.6) }}>
          {v.isBreak ? (
            <>
              <Coffee style={{ width: fs(3, 5.2), height: fs(3, 5.2) }} /> {t("Break")}
            </>
          ) : (
            t("Level {n}", { n: d.playLevelNumber })
          )}
        </div>
        {widgets.has("CLOCK") && (
          <div className="relative w-full">
            <div className={cn("clock-digits font-semibold leading-[1.02] transition-opacity", v.paused && "opacity-40")} style={{ fontSize: clockSize }}>
              {d.formatted}
            </div>
            {v.paused && (
              <div className="absolute inset-0 grid place-items-center">
                <span className="flex items-center gap-[1vw] rounded-[1.5vh] bg-black/70 px-[2vw] py-[1vh] font-black uppercase tracking-[0.2em] text-amber-400 animate-pulse-soft" style={{ fontSize: fs(6, 11) }}>
                  <Pause style={{ width: fs(5, 9), height: fs(5, 9) }} fill="currentColor" /> {t("Paused")}
                </span>
              </div>
            )}
            <div className="mx-auto mt-[1.4vh] h-[0.5vh] w-4/5 overflow-hidden rounded-full bg-white/[0.08]">
              <div className={cn("h-full rounded-full transition-[width] duration-1000", v.paused ? "bg-amber-400" : v.isBreak ? "bg-gold" : "bg-[var(--tv-accent)]")} style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}
        {resumeAt && (
          <div className="mt-[1.2vh] text-white/70" style={{ fontSize: fs(2.2, 3.9) }}>
            {t("Play resumes at {time}", { time: f.time(resumeAt) })}
          </div>
        )}
        {widgets.has("BLINDS") && (
          <div className="mt-[2vh]">
            {v.isBreak && (
              <div className="font-semibold uppercase tracking-[0.18em] text-white/55" style={{ fontSize: fs(1.5, 2.7) }}>
                {t("Next level")}
              </div>
            )}
            <div className="font-bold tabular-nums leading-tight" style={{ fontSize: fs(5.2, 9.5) }}>
              {tt.blinds(shownLevel) || "—"}
            </div>
            {tt.ante(shownLevel) && (
              <div className="font-semibold tabular-nums text-white/70" style={{ fontSize: fs(2.4, 4.3) }}>
                {tt.ante(shownLevel)}
              </div>
            )}
          </div>
        )}
      </div>
      {sides && <div className="grid content-center gap-[1.6vh]">{right}</div>}
    </div>
  );
}

function NotStartedScreen({ snap, now }: { snap: PublicLiveSnapshot; now: number }) {
  const t = useT();
  const f = useFormat();
  const tt = useTournamentText();
  const until = Date.parse(snap.tournament.startAt) - now;
  const first = snap.levels.find((l) => l.type === "PLAY") ?? null;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-[2vh] px-[3vw] text-center">
      <div className="font-bold uppercase tracking-[0.22em] text-[var(--tv-accent)]" style={{ fontSize: fs(3, 5.2) }}>
        {snap.tournament.status === "SEATING" ? t("Seating in progress") : t("Starts at {time}", { time: f.time(snap.tournament.startAt) })}
      </div>
      <div className="clock-digits font-bold leading-none" style={{ fontSize: until > 3_600_000 ? fs(13, 25) : fs(17, 31) }}>
        {until > 0 ? formatClock(until) : t("Soon")}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-x-[3vw] gap-y-[1vh] text-white/75" style={{ fontSize: fs(2.4, 4.3) }}>
        <span>
          {t("Registered")}: <span className="font-bold text-white tabular-nums">{f.number(snap.stats.registrations)}</span>
        </span>
        <span>
          {t("Buy-in")}: <span className="font-bold text-white">{tt.buyIn(snap.tournament.buyIn)}</span>
        </span>
        <span>
          {t("Starting stack")}: <span className="font-bold text-white tabular-nums">{f.number(snap.tournament.startingStack)}</span>
        </span>
      </div>
      {first && (
        <div className="text-white/60" style={{ fontSize: fs(2, 3.6) }}>
          {t("Level {n}", { n: 1 })}: <span className="font-semibold text-white">{tt.blinds(first)}</span> · {tt.minutes(first.durationSeconds)}
        </div>
      )}
    </div>
  );
}

function SeatingScreen({ seating }: { seating: NonNullable<PublicLiveSnapshot["seating"]> }) {
  const t = useT();
  const perPage = SEATING_ROWS * SEATING_COLS;
  const pages = Math.max(1, Math.ceil(seating.length / perPage));
  const [page, setPage] = useState(0);
  useEffect(() => {
    if (pages <= 1) return;
    const id = setInterval(() => setPage((p) => (p + 1) % pages), 10_000);
    return () => clearInterval(id);
  }, [pages]);
  const current = page % pages;
  const rows = seating.slice(current * perPage, (current + 1) * perPage);
  return (
    <div className="flex h-full flex-col px-[3vw] pt-[1.5vh]">
      <div className="flex items-baseline justify-between">
        <div className="font-bold uppercase tracking-[0.2em] text-[var(--tv-accent)]" style={{ fontSize: fs(2.6, 4.6) }}>
          {t("Find your seat")}
        </div>
        {pages > 1 && (
          <div className="tabular-nums text-white/60" style={{ fontSize: fs(1.8, 3.2) }}>
            {t("Page {page} of {pages}", { page: current + 1, pages })}
          </div>
        )}
      </div>
      <div
        key={current}
        className="mt-[1.5vh] grid flex-1 grid-flow-col gap-x-[2.5vw] gap-y-[0.5vh]"
        style={{ gridTemplateRows: `repeat(${SEATING_ROWS}, minmax(0, 1fr))`, gridTemplateColumns: `repeat(${SEATING_COLS}, minmax(0, 1fr))` }}
      >
        {rows.map((r) => (
          <div key={`${r.tableNumber}-${r.seatNumber}`} className="flex items-center justify-between gap-[1vw] border-b border-white/10" style={{ fontSize: fs(1.9, 3.4) }}>
            <span className="min-w-0 truncate font-medium">{r.playerName}</span>
            <span className="shrink-0 font-bold tabular-nums text-white/85">
              {r.tableNumber}
              <span className="text-white/40">·</span>
              {r.seatNumber}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-[1vh] text-right text-white/45" style={{ fontSize: fs(1.4, 2.5) }}>
        {t("Table")} · {t("Seat")}
      </div>
    </div>
  );
}

function FinishedScreen({ snap }: { snap: PublicLiveSnapshot }) {
  const t = useT();
  const top = snap.results.slice(0, 10);
  const winner = top.find((r) => r.position === 1);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-[2.5vh] px-[3vw]">
      <div className="flex items-center gap-[1.2vw] font-bold uppercase tracking-[0.2em] text-gold" style={{ fontSize: fs(3, 5.4) }}>
        <Trophy style={{ width: fs(3.6, 6.4), height: fs(3.6, 6.4) }} /> {t("Tournament finished")}
      </div>
      {winner && (
        <div className="text-center">
          <div className="uppercase tracking-[0.2em] text-white/60" style={{ fontSize: fs(1.6, 2.9) }}>
            {t("Winner")}
          </div>
          <div className="font-black text-gold" style={{ fontSize: fs(6, 11) }}>
            {winner.playerName}
          </div>
        </div>
      )}
      {top.length > 1 && (
        <ol className="grid w-full max-w-[70vw] grid-flow-col grid-cols-2 grid-rows-5 gap-x-[4vw] gap-y-[0.8vh]" style={{ fontSize: fs(2.1, 3.8) }}>
          {top
            .filter((r) => r.position !== 1)
            .map((r) => (
              <li key={`${r.position}-${r.playerName}`} className="flex items-center gap-[1vw] border-b border-white/10 pb-[0.4vh]">
                <span className="w-[3vw] shrink-0 text-right font-bold tabular-nums text-white/60">{r.position}</span>
                <span className="min-w-0 truncate font-medium">{r.playerName}</span>
              </li>
            ))}
        </ol>
      )}
    </div>
  );
}

function IdleScreen({ state, now, league }: { state: DeviceState; now: number; league: PublicLeague | null }) {
  const t = useT();
  const f = useFormat();
  const { locale } = useI18n();
  return (
    <div className="flex h-full items-center justify-center gap-[5vw] px-[3vw]">
      <div className="flex flex-col items-center text-center">
        <span className="grid place-items-center rounded-[1.6vh] border-[0.4vh] border-[color-mix(in_srgb,var(--tv-accent)_55%,transparent)] text-[var(--tv-accent)]" style={{ width: fs(8, 14), height: fs(8, 14) }}>
          <SpadeMark style={{ width: fs(4.2, 7.5), height: fs(4.2, 7.5) }} />
        </span>
        <div className="mt-[3vh] font-bold tracking-tight" style={{ fontSize: fs(4.5, 8) }}>
          {state.organization?.name ?? t("Poker Club")}
        </div>
        {state.venue && (
          <div className="text-white/60" style={{ fontSize: fs(2, 3.6) }}>
            {state.venue.name}
          </div>
        )}
        <div className="clock-digits mt-[3vh] font-bold leading-none" style={{ fontSize: fs(14, 25) }}>
          {f.time(new Date(now))}
        </div>
        <div className="mt-[1vh] capitalize text-white/60" style={{ fontSize: fs(2.2, 3.9) }}>
          {new Date(now).toLocaleDateString(locale === "ru" ? "ru-RU" : "en-GB", { weekday: "long", day: "numeric", month: "long" })}
        </div>
      </div>
      {league && league.rows.length > 0 && (
        <div className="w-[30vw]">
          <LeaderboardPanel league={league} rows={10} />
        </div>
      )}
    </div>
  );
}

function MessageScreen({ title, detail, now }: { title: string; detail?: string; now: number }) {
  const f = useFormat();
  return (
    <div className="flex h-dvh w-screen flex-col items-center justify-center gap-[2vh] bg-[#0b0c0e] text-center text-white">
      <SpadeMark className="text-gold" style={{ width: fs(6, 10), height: fs(6, 10) }} />
      <div className="clock-digits font-bold" style={{ fontSize: fs(10, 18) }}>
        {f.time(new Date(now))}
      </div>
      <div className="font-semibold" style={{ fontSize: fs(2.6, 4.6) }}>
        {title}
      </div>
      {detail && (
        <div className="max-w-[70vw] text-white/60" style={{ fontSize: fs(1.8, 3.2) }}>
          {detail}
        </div>
      )}
    </div>
  );
}

/** Full-screen TV clock for the venue (spec §46): never blank, readable from 10 m. */
export function TvDisplay({ token }: { token: string }) {
  const t = useT();
  useVenueDevice("DISPLAY");
  useWakeLock();
  const idle = useIdleCursor(3_000);
  const state = useDeviceState(token);
  const s = state.data;
  const snap = useDeviceSnapshot(s);
  const rt = useRealtimeState();
  const now = useServerNow(1_000);
  const widgets: Widgets = new Set(s?.template.widgets?.length ? s.template.widgets : FALLBACK_WIDGETS);
  const boards = useLeaderboards(s?.organization?.slug, widgets.has("LEADERBOARD"));
  const league = boards.data?.leagues[0] ?? null;
  const v = useLiveClock(snap);

  if (!s) {
    if (state.isError && isRevoked(state.error)) {
      return <MessageScreen now={now} title={t("This display link is not valid")} detail={t("Ask the club staff to create a new display link in the administration (Displays & kiosks).")} />;
    }
    return <MessageScreen now={now} title={t("Connecting to the local server…")} />;
  }

  const offline = rt.socket !== "open" || (state.isError && !isRevoked(state.error));
  const style = { "--tv-accent": safeColor(s.template.theme.accent, "#d4ae5c"), backgroundColor: safeColor(s.template.theme.background, "#0b0c0e") } as CSSProperties;
  const announcement = widgets.has("ANNOUNCEMENTS") ? (snap?.announcements.find((a) => !a.displayUntil || Date.parse(a.displayUntil) > now) ?? null) : null;
  const sponsor = widgets.has("SPONSOR") ? (s.template.theme.sponsorText?.trim() || null) : null;
  const status = snap?.tournament.status;

  let body: ReactNode;
  if (!snap) body = <IdleScreen state={s} now={now} league={widgets.has("LEADERBOARD") ? league : null} />;
  else if (v.cancelled)
    body = (
      <div className="grid h-full place-items-center font-bold text-red-400" style={{ fontSize: fs(4, 7) }}>
        {t("Tournament cancelled")}
      </div>
    );
  else if (v.finished) body = <FinishedScreen snap={snap} />;
  else if (status === "SEATING" && widgets.has("SEATING") && snap.seating && snap.seating.length > 0) body = <SeatingScreen seating={snap.seating} />;
  else if (v.notStarted || !v.d) body = <NotStartedScreen snap={snap} now={now} />;
  else body = <ClockScreen snap={snap} widgets={widgets} league={league} now={now} />;

  return (
    <div
      className={cn("relative flex h-dvh w-screen select-none flex-col overflow-hidden text-[#ebe7df]", idle && "cursor-none")}
      style={style}
      onDoubleClick={() => {
        if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
        else void document.documentElement.requestFullscreen().catch(() => undefined);
      }}
    >
      <Header state={s} snap={snap} now={now} offline={offline} widgets={widgets} />
      {v.handForHand && !v.finished && (
        <div className="relative mx-[3vw] mt-[1.5vh] flex items-center justify-center gap-[1vw] rounded-[1.2vh] bg-red-600 py-[0.8vh] font-black uppercase tracking-[0.3em] animate-pulse-soft" style={{ fontSize: fs(2.6, 4.6) }}>
          <Hand style={{ width: fs(2.6, 4.6), height: fs(2.6, 4.6) }} /> {t("Hand-for-hand")}
        </div>
      )}
      <main className="relative min-h-0 flex-1">{body}</main>
      <Banner announcement={announcement} sponsor={sponsor} />
    </div>
  );
}
