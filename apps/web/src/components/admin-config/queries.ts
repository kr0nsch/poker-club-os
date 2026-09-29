"use client";

import { useQuery } from "@tanstack/react-query";
import { get } from "@/lib/api";
import type {
  DisplayTemplate,
  HouseRulesProfile,
  League,
  OrganizationView,
  PlayerTag,
  ScoreRule,
  Series,
  StructureDetail,
  StructureSummary,
  TournamentTemplate,
  Venue,
} from "./types";

/** Query keys of the configuration pages (prefixed to never collide with other surfaces). */
export const cfgKeys = {
  all: ["cfg"] as const,
  venues: ["cfg", "venues"] as const,
  organization: ["cfg", "organization"] as const,
  structures: ["cfg", "structures"] as const,
  structure: (id: string) => ["cfg", "structures", id] as const,
  templates: ["cfg", "templates"] as const,
  houseRules: ["cfg", "house-rules"] as const,
  displayTemplates: ["cfg", "display-templates"] as const,
  leagues: ["cfg", "leagues"] as const,
  series: ["cfg", "series"] as const,
  scoreRules: ["cfg", "score-rules"] as const,
  leaderboard: (seasonId: string) => ["cfg", "leaderboard", seasonId] as const,
  playerTags: ["cfg", "player-tags"] as const,
  players: ["cfg", "players"] as const,
  playerList: (params: Record<string, unknown>) => ["cfg", "players", "list", params] as const,
  player: (id: string) => ["cfg", "players", id] as const,
  /** Shared with the dashboard ("tournaments", "active"): invalidating it refreshes both. */
  tournaments: ["tournaments"] as const,
  tournamentList: (params: Record<string, unknown>) => ["tournaments", "cfg-list", params] as const,
  publicResults: (id: string) => ["cfg", "public-results", id] as const,
};

const LOOKUP_STALE = 60_000;

export const useVenues = () => useQuery({ queryKey: cfgKeys.venues, queryFn: () => get<Venue[]>("/api/v1/venues"), staleTime: LOOKUP_STALE });

export const useOrganization = () =>
  useQuery({ queryKey: cfgKeys.organization, queryFn: () => get<OrganizationView>("/api/v1/organizations/current"), staleTime: LOOKUP_STALE });

/** Organisation currency (ISO 4217) used for buy-ins; EUR until settings load. */
export function useCurrency(): string {
  return useOrganization().data?.settings.currency ?? "EUR";
}

export const useStructures = () =>
  useQuery({ queryKey: cfgKeys.structures, queryFn: () => get<StructureSummary[]>("/api/v1/structures"), staleTime: 15_000 });

export const useStructure = (id: string | null | undefined) =>
  useQuery({ queryKey: cfgKeys.structure(id ?? "none"), queryFn: () => get<StructureDetail>(`/api/v1/structures/${id}`), enabled: !!id });

export const useTemplates = () =>
  useQuery({ queryKey: cfgKeys.templates, queryFn: () => get<TournamentTemplate[]>("/api/v1/templates"), staleTime: 15_000 });

export const useHouseRules = () =>
  useQuery({ queryKey: cfgKeys.houseRules, queryFn: () => get<HouseRulesProfile[]>("/api/v1/house-rules"), staleTime: LOOKUP_STALE });

export const useDisplayTemplates = (enabled = true) =>
  useQuery({ queryKey: cfgKeys.displayTemplates, queryFn: () => get<DisplayTemplate[]>("/api/v1/display-templates"), staleTime: LOOKUP_STALE, enabled });

export const useLeagues = () => useQuery({ queryKey: cfgKeys.leagues, queryFn: () => get<League[]>("/api/v1/leagues"), staleTime: 15_000 });

export const useSeries = () => useQuery({ queryKey: cfgKeys.series, queryFn: () => get<Series[]>("/api/v1/series"), staleTime: 15_000 });

export const useScoreRules = () => useQuery({ queryKey: cfgKeys.scoreRules, queryFn: () => get<ScoreRule[]>("/api/v1/score-rules"), staleTime: 15_000 });

export const usePlayerTags = () => useQuery({ queryKey: cfgKeys.playerTags, queryFn: () => get<PlayerTag[]>("/api/v1/player-tags"), staleTime: 30_000 });
