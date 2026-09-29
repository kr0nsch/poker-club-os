"use client";

// Shared state of token-authenticated venue devices (TV displays and kiosks).
// The device keeps its last known state forever: a network hiccup never blanks
// the screen, it only shows a small "disconnected" marker.

import { topic, type AnnouncementView, type DisplayWidget, type PublicLiveSnapshot } from "@pcos/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { ApiError, get } from "@/lib/api";
import { keys, usePublicLive } from "@/lib/queries";
import { useRealtimeState, useTopicEvents } from "@/lib/realtime-context";

export interface DeviceTheme {
  accent?: string;
  background?: string;
  logoFileId?: string | null;
  sponsorText?: string | null;
}

export interface DeviceState {
  display: { id: string; name: string; kind: "DISPLAY" | "KIOSK"; venueId: string; boundTournamentId: string | null };
  template: { widgets: DisplayWidget[]; theme: DeviceTheme };
  venue: { id: string; name: string } | null;
  organization: { name: string; slug: string } | null;
  tournamentId: string | null;
  snapshot: PublicLiveSnapshot | null;
  serverTime: string;
}

export const deviceStateKey = (token: string) => ["device-state", token] as const;

/** Token is unknown or revoked: stop retrying and tell staff. */
export const isRevoked = (e: unknown) => e instanceof ApiError && (e.status === 401 || e.status === 403 || e.status === 404);

export function useDeviceState(token: string) {
  const qc = useQueryClient();
  const key = deviceStateKey(token);
  const q = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => get<DeviceState>(`/api/v1/display/${encodeURIComponent(token)}/state`, signal),
    refetchInterval: 60_000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: false,
    // Network or server errors: keep retrying with back-off (never give up on a TV).
    retry: (_n, e) => !isRevoked(e),
    retryDelay: (n) => Math.min(15_000, 1_000 * 2 ** n),
  });
  const data = q.data;
  const currentId = data?.tournamentId ?? null;

  // The device snapshot also covers private tournaments and forced seat lists: seed the live cache with it.
  useEffect(() => {
    if (data?.snapshot && data.tournamentId) qc.setQueryData(keys.live(data.tournamentId), data.snapshot);
  }, [data, qc]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const refetchSoon = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void qc.invalidateQueries({ queryKey: key }), 400);
  };

  // Venue topic: another tournament started / was created / finished → maybe a different tournament to show.
  const venueId = data?.display.venueId ?? null;
  useTopicEvents([venueId ? topic.venue(venueId) : null], (e) => {
    if (e.name === "tournament.updated") {
      const d = (e.data ?? {}) as { tournamentId?: string; created?: boolean; changes?: { status?: string } };
      if (d.created || d.changes?.status) refetchSoon();
      return;
    }
    if (e.name === "announcement.created" && currentId) {
      // Venue-wide announcements are not published on the tournament topic.
      const a = e.data as AnnouncementView;
      if (a.tournamentId && a.tournamentId !== currentId) return;
      const lk = keys.live(currentId);
      const cur = qc.getQueryData<PublicLiveSnapshot>(lk);
      if (cur) qc.setQueryData<PublicLiveSnapshot>(lk, { ...cur, announcements: [a, ...cur.announcements.filter((x) => x.id !== a.id)] });
    }
  });

  // Reconnected after an outage: reload everything.
  const { epoch } = useRealtimeState();
  const firstEpoch = useRef(epoch);
  useEffect(() => {
    if (epoch !== firstEpoch.current) refetchSoon();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [epoch]);

  return q;
}

/** Live snapshot of the device's current tournament (kept live over the WebSocket). */
export function useDeviceSnapshot(state: DeviceState | undefined): PublicLiveSnapshot | null {
  const live = usePublicLive(state?.tournamentId, undefined, state?.snapshot ?? null);
  return useMemo(() => {
    if (!state?.tournamentId) return null;
    const fromLive = live.data && live.data.tournament.id === state.tournamentId ? live.data : null;
    const base = fromLive ?? (state.snapshot && state.snapshot.tournament.id === state.tournamentId ? state.snapshot : null);
    if (!base) return null;
    // The public endpoint hides the seat list when the club disabled it; displays always get it.
    if (base.seating == null && state.snapshot?.seating && state.snapshot.tournament.id === base.tournament.id) return { ...base, seating: state.snapshot.seating };
    return base;
  }, [live.data, state]);
}

/** Only plain colours from the template reach inline styles. */
export function safeColor(value: string | undefined | null, fallback: string): string {
  if (!value) return fallback;
  const v = value.trim();
  return /^#[0-9a-f]{3,8}$/i.test(v) || /^(rgb|hsl)a?\([\d\s.,%/]+\)$/i.test(v) ? v : fallback;
}
