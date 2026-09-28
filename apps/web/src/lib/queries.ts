"use client";

import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import type { CommandResult, CommandType, MeView, PublicLiveSnapshot, RealtimeEvent, TournamentSnapshot } from "@pcos/types";
import { topic } from "@pcos/types";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { ApiError, get, post, setCsrfToken } from "./api";
import { useT } from "./i18n";
import { useRealtimeState, useTopicEvents } from "./realtime-context";

export const keys = {
  me: ["me"] as const,
  snapshot: (id: string) => ["tournament", id, "snapshot"] as const,
  live: (idOrSlug: string) => ["live", idOrSlug] as const,
  actions: (id: string) => ["tournament", id, "actions"] as const,
};

export function useMe() {
  const q = useQuery({
    queryKey: keys.me,
    queryFn: () => get<MeView>("/api/v1/auth/me"),
    staleTime: 30_000,
  });
  useEffect(() => {
    if (q.data) setCsrfToken(q.data.csrfToken);
  }, [q.data]);
  return q;
}

/** Debounced invalidation: bursts of events (seat draw) cause one refetch. */
function useDebouncedInvalidate(key: QueryKey, delayMs = 150) {
  const qc = useQueryClient();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  return () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void qc.invalidateQueries({ queryKey: key }), delayMs);
  };
}

/**
 * Staff snapshot kept live over the local WebSocket. Clock and stats events
 * patch the cache directly (smooth), everything else triggers a debounced
 * refetch; a version gap or a reconnect forces a full resync.
 */
export function useTournamentSnapshot(id: string | null | undefined) {
  const qc = useQueryClient();
  const key = keys.snapshot(id ?? "none");
  const query = useQuery({
    queryKey: key,
    queryFn: () => get<TournamentSnapshot>(`/api/v1/tournaments/${id}/snapshot`),
    enabled: !!id,
    refetchInterval: 60_000,
  });
  const invalidate = useDebouncedInvalidate(key);
  const { epoch } = useRealtimeState();
  const firstEpoch = useRef(epoch);
  useEffect(() => {
    if (epoch !== firstEpoch.current) void qc.invalidateQueries({ queryKey: key });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [epoch]);

  useTopicEvents([id ? topic.tournament(id) : null], (e: RealtimeEvent) => {
    const current = qc.getQueryData<TournamentSnapshot>(key);
    if (!current) return invalidate();
    const v = e.tournamentVersion;
    if (v != null && v > current.tournament.version + 1) return invalidate(); // missed events
    if (e.name === "clock.updated") {
      const data = e.data as { clock: TournamentSnapshot["clock"] };
      qc.setQueryData<TournamentSnapshot>(key, { ...current, clock: data.clock, tournament: { ...current.tournament, version: v ?? current.tournament.version } });
      return;
    }
    if (e.name === "tournament.updated") {
      const data = e.data as { changes?: Partial<TournamentSnapshot["tournament"]>; stats?: TournamentSnapshot["stats"]; levelsChanged?: boolean; configChanged?: boolean };
      qc.setQueryData<TournamentSnapshot>(key, {
        ...current,
        tournament: { ...current.tournament, ...(data.changes ?? {}), version: v ?? current.tournament.version },
        stats: data.stats ?? current.stats,
      });
      if (data.levelsChanged || data.configChanged) invalidate();
      return;
    }
    if (v != null) qc.setQueryData<TournamentSnapshot>(key, { ...current, tournament: { ...current.tournament, version: Math.max(v, current.tournament.version) } });
    invalidate();
  });
  return query;
}

/** Public projection for player live pages and TV displays. */
export function usePublicLive(idOrSlug: string | null | undefined, org?: string, initial?: PublicLiveSnapshot | null) {
  const qc = useQueryClient();
  const key = keys.live(idOrSlug ?? "none");
  const query = useQuery({
    queryKey: key,
    queryFn: () => get<PublicLiveSnapshot>(`/api/v1/public/tournaments/${idOrSlug}/live${org ? `?org=${encodeURIComponent(org)}` : ""}`),
    enabled: !!idOrSlug,
    initialData: initial ?? undefined,
    refetchInterval: 60_000,
  });
  const invalidate = useDebouncedInvalidate(key, 300);
  const tid = query.data?.tournament.id;
  const { epoch } = useRealtimeState();
  const firstEpoch = useRef(epoch);
  useEffect(() => {
    if (epoch !== firstEpoch.current) void qc.invalidateQueries({ queryKey: key });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [epoch]);
  useTopicEvents([tid ? topic.tournament(tid) : null], (e) => {
    const current = qc.getQueryData<PublicLiveSnapshot>(key);
    if (!current) return invalidate();
    if (e.name === "clock.updated") {
      qc.setQueryData<PublicLiveSnapshot>(key, { ...current, clock: (e.data as { clock: PublicLiveSnapshot["clock"] }).clock });
      return;
    }
    if (e.name === "tournament.updated") {
      const data = e.data as { changes?: Partial<PublicLiveSnapshot["tournament"]>; stats?: PublicLiveSnapshot["stats"]; levelsChanged?: boolean };
      qc.setQueryData<PublicLiveSnapshot>(key, { ...current, tournament: { ...current.tournament, ...(data.changes ?? {}) }, stats: data.stats ?? current.stats });
      if (data.levelsChanged) invalidate();
      return;
    }
    if (e.name === "announcement.created") {
      const a = e.data as PublicLiveSnapshot["announcements"][number];
      qc.setQueryData<PublicLiveSnapshot>(key, { ...current, announcements: [a, ...current.announcements.filter((x) => x.id !== a.id)] });
      return;
    }
    invalidate();
  });
  return query;
}

export interface CommandInput {
  type: CommandType;
  payload?: Record<string, unknown>;
  /** override (plan-based commands pass the version their preview was based on) */
  expectedVersion?: number;
}

/**
 * Issue tournament commands with idempotency keys and optimistic concurrency.
 * A conflict means another device changed the same thing: reload and let the
 * operator decide again (spec §94).
 */
export function useCommand(tournamentId: string) {
  const qc = useQueryClient();
  const t = useT();
  const key = keys.snapshot(tournamentId);
  return useMutation({
    mutationFn: async (input: CommandInput) => {
      const snap = qc.getQueryData<TournamentSnapshot>(key);
      const expectedVersion = input.expectedVersion ?? snap?.tournament.version ?? 0;
      return post<CommandResult>(`/api/v1/tournaments/${tournamentId}/commands`, {
        type: input.type,
        payload: input.payload ?? {},
        expectedVersion,
        clientOperationId: crypto.randomUUID(),
      });
    },
    onSuccess: (res) => {
      const snap = qc.getQueryData<TournamentSnapshot>(key);
      if (snap && res.tournamentVersion > snap.tournament.version) {
        qc.setQueryData<TournamentSnapshot>(key, { ...snap, tournament: { ...snap.tournament, version: res.tournamentVersion } });
      }
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: keys.actions(tournamentId) });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.isConflict) {
        toast.warning(t("Changed on another device — reloaded the current state"), { description: e.message });
        void qc.invalidateQueries({ queryKey: key });
      } else {
        toast.error(e instanceof ApiError ? e.message : t("Something went wrong"));
      }
    },
  });
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}
