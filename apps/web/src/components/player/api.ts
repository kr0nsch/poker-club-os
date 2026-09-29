"use client";

// Data layer of the player PWA: typed queries against the edge server's
// public and player endpoints (venue Wi-Fi, no Internet involved).

import { useQuery } from "@tanstack/react-query";
import {
  LIVE_TOURNAMENT_STATUSES,
  type NotificationType,
  type RegistrationStatus,
  type TournamentStatus,
  type TournamentSummaryView,
} from "@pcos/types";
import { ApiError, get } from "@/lib/api";
import { useMe } from "@/lib/queries";

export interface PublicTournament extends TournamentSummaryView {
  venueName: string;
  description: string | null;
  startingStack: number;
  lateRegistrationClosed: boolean;
  /** registration (or late registration) accepts players right now */
  registrationOpen: boolean;
}

export interface PublicTournamentList {
  organization: { id: string; name: string; slug: string };
  tournaments: PublicTournament[];
}

export interface MyRegistration {
  registrationId: string;
  status: RegistrationStatus;
  checkInCode: string | null;
  waitlistPosition: number | null;
  tournamentId: string;
  name: string;
  slug: string;
  startAt: string;
  tournamentStatus: TournamentStatus;
}

export interface LeaderboardRow {
  rank: number;
  playerId: string;
  playerName: string;
  points: number;
  tournaments: number;
  wins: number;
}

export interface PublicLeague {
  league: { id: string; name: string };
  season: { id: string; name: string; startsOn: string; endsOn: string };
  rows: LeaderboardRow[];
}

export interface PublicLeaderboards {
  organization: { name: string; slug: string };
  leagues: PublicLeague[];
}

export interface HistoryItem {
  tournamentId: string;
  name: string;
  startAt: string;
  status: TournamentStatus;
  registrationStatus: RegistrationStatus;
  position: number | null;
  points: number | null;
  entries: number | null;
}

export interface PlayerProfile {
  id: string;
  externalPublicId: string;
  memberNumber: string | null;
  firstName: string;
  lastName: string;
  displayName: string;
  nickname: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  marketingConsent: boolean;
  publicProfileEnabled: boolean;
  hasKioskPin: boolean;
  language: string | null;
  history: HistoryItem[];
}

export interface InboxItem {
  id: string;
  type: NotificationType;
  payload: Record<string, unknown>;
  createdAt: string;
  readAt: string | null;
}

export const PREF_CHANNELS = ["IN_APP", "TELEGRAM", "EMAIL"] as const;
export type PrefChannel = (typeof PREF_CHANNELS)[number];

export interface NotificationPreference {
  type: NotificationType;
  channels: Record<PrefChannel, boolean>;
}

export interface TelegramLinkStatus {
  available: boolean;
  botUsername: string | null;
  linked: boolean;
  telegramUsername: string | null;
  linkedAt: string | null;
}

export const playerKeys = {
  tournaments: (org: string, past = false) => ["public", org, "tournaments", past ? "past" : "current"] as const,
  leaderboards: (org: string) => ["public", org, "leaderboards"] as const,
  all: ["player"] as const,
  registrations: ["player", "registrations"] as const,
  profile: ["player", "profile"] as const,
  inbox: ["player", "inbox"] as const,
  prefs: ["player", "notification-preferences"] as const,
  telegram: ["player", "telegram"] as const,
};

export const isLiveStatus = (s: TournamentStatus) => LIVE_TOURNAMENT_STATUSES.includes(s);
export const isClosedStatus = (s: TournamentStatus) => s === "FINISHED" || s === "FINALIZED" || s === "CANCELLED";

/** Signed-in player of this club (null for anonymous visitors, staff, or players of another club). */
export function usePlayerSession(org: string) {
  const me = useMe();
  const data = me.data;
  const player = data?.player && data.organization?.slug === org ? data.player : null;
  return { me, player, isPlayer: !!player, signedIn: !!data?.user, loading: me.isLoading };
}

export function usePublicTournaments(org: string, opts: { past?: boolean; enabled?: boolean } = {}) {
  return useQuery({
    queryKey: playerKeys.tournaments(org, opts.past),
    queryFn: ({ signal }) => get<PublicTournamentList>(`/api/v1/public/orgs/${encodeURIComponent(org)}/tournaments${opts.past ? "?past=1" : ""}`, signal),
    enabled: !!org && (opts.enabled ?? true),
    staleTime: 15_000,
    refetchInterval: 60_000,
  });
}

export function useLeaderboards(org: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: playerKeys.leaderboards(org ?? "none"),
    queryFn: ({ signal }) => get<PublicLeaderboards>(`/api/v1/public/orgs/${encodeURIComponent(org ?? "")}/leaderboards`, signal),
    enabled: !!org && enabled,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
}

export function useMyRegistrations(enabled: boolean) {
  return useQuery({
    queryKey: playerKeys.registrations,
    queryFn: ({ signal }) => get<MyRegistration[]>("/api/v1/me/registrations", signal),
    enabled,
    refetchInterval: 60_000,
  });
}

export function useProfile(enabled: boolean) {
  return useQuery({
    queryKey: playerKeys.profile,
    queryFn: ({ signal }) => get<PlayerProfile>("/api/v1/me/profile", signal),
    enabled,
  });
}

export function useInbox(enabled: boolean) {
  return useQuery({
    queryKey: playerKeys.inbox,
    queryFn: ({ signal }) => get<InboxItem[]>("/api/v1/me/notifications", signal),
    enabled,
    refetchInterval: 60_000,
  });
}

export function useNotificationPrefs(enabled: boolean) {
  return useQuery({
    queryKey: playerKeys.prefs,
    queryFn: ({ signal }) => get<NotificationPreference[]>("/api/v1/me/notification-preferences", signal),
    enabled,
  });
}

export function useTelegramLink(enabled: boolean) {
  return useQuery({
    queryKey: playerKeys.telegram,
    queryFn: ({ signal }) => get<TelegramLinkStatus>("/api/v1/telegram/link", signal),
    enabled,
  });
}

/** Only relative, same-site paths are accepted as post-login destinations. */
export function safeNext(next: string | null | undefined, fallback: string): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}

export const isNotFound = (e: unknown) => e instanceof ApiError && e.status === 404;
