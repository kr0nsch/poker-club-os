"use client";

// Queries shared by several venue & system pages. Keys are namespaced ("sys")
// so they never collide with other surfaces' caches.

import type { TournamentSummaryView } from "@pcos/types";
import { useQuery } from "@tanstack/react-query";
import { get } from "@/lib/api";
import type { DeviceRow, EdgeHealth, OrganizationView, RolesResponse, StaffRow, TelegramIntegrationView, VenueRow } from "./types";

export const sysKeys = {
  venues: ["sys", "venues"] as const,
  tournaments: ["sys", "tournaments"] as const,
  liveTournaments: ["sys", "tournaments", "live"] as const,
  organization: ["sys", "organization"] as const,
  roles: ["sys", "roles"] as const,
  staff: ["sys", "staff"] as const,
  displayTokens: ["sys", "display-tokens"] as const,
  displayTemplates: ["sys", "display-templates"] as const,
  network: ["sys", "network"] as const,
  devices: ["sys", "devices"] as const,
  health: ["sys", "health"] as const,
  diagnostics: ["sys", "diagnostics"] as const,
  backups: ["sys", "backups"] as const,
  sync: ["sys", "sync"] as const,
  conflicts: ["sys", "conflicts"] as const,
  telegram: ["sys", "telegram"] as const,
  notifications: (status: string, channel: string) => ["sys", "notifications", status, channel] as const,
  notificationsAll: ["sys", "notifications"] as const,
  deliveries: (id: string) => ["sys", "deliveries", id] as const,
  audit: (params: Record<string, unknown>) => ["sys", "audit", params] as const,
  analytics: (from: string, to: string) => ["sys", "analytics", from, to] as const,
};

export function useVenues(enabled = true) {
  return useQuery({ queryKey: sysKeys.venues, queryFn: () => get<VenueRow[]>("/api/v1/venues"), enabled, staleTime: 30_000 });
}

/** Recent and upcoming tournaments (newest first) for pickers and name lookups. */
export function useTournamentOptions(enabled = true) {
  return useQuery({
    queryKey: sysKeys.tournaments,
    queryFn: () => get<TournamentSummaryView[]>("/api/v1/tournaments?limit=200"),
    enabled,
    staleTime: 30_000,
  });
}

/** Tournaments that can have tables right now (dealer tablet assignment). */
export function useLiveTournaments(enabled = true) {
  return useQuery({
    queryKey: sysKeys.liveTournaments,
    queryFn: () => get<TournamentSummaryView[]>("/api/v1/tournaments?status=SEATING,RUNNING,BREAK,PAUSED,HAND_FOR_HAND,REGISTRATION_OPEN&limit=50"),
    enabled,
    staleTime: 15_000,
  });
}

export function useOrganization(enabled = true) {
  return useQuery({ queryKey: sysKeys.organization, queryFn: () => get<OrganizationView>("/api/v1/organizations/current"), enabled, staleTime: 15_000 });
}

export function useRoles(enabled = true) {
  return useQuery({ queryKey: sysKeys.roles, queryFn: () => get<RolesResponse>("/api/v1/roles"), enabled, staleTime: 60_000 });
}

export function useStaffList(enabled = true) {
  return useQuery({ queryKey: sysKeys.staff, queryFn: () => get<StaffRow[]>("/api/v1/staff"), enabled });
}

export function useDevices(enabled = true, refetchInterval: number | false = false) {
  return useQuery({ queryKey: sysKeys.devices, queryFn: () => get<DeviceRow[]>("/api/v1/devices"), enabled, refetchInterval });
}

export function useEdgeHealth(enabled = true) {
  return useQuery({ queryKey: sysKeys.health, queryFn: () => get<EdgeHealth>("/api/v1/edge/health"), enabled, refetchInterval: 30_000 });
}

export function useTelegramIntegration(enabled = true) {
  return useQuery({ queryKey: sysKeys.telegram, queryFn: () => get<TelegramIntegrationView>("/api/v1/telegram/integration"), enabled, refetchInterval: 15_000 });
}
