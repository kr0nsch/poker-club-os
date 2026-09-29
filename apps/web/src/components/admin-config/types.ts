// Response shapes of the configuration endpoints that are not covered by the
// shared read models in @pcos/types (they return database rows directly).

import type {
  AddonPolicy,
  BountyPolicy,
  ConsentType,
  FeatureFlags,
  GameType,
  HouseRulesConfig,
  LateRegistrationPolicy,
  LevelView,
  Money,
  PlayerImportField,
  PlayerSource,
  PlayerStatus,
  RebuyPolicy,
  ReentryPolicy,
  RegistrationStatus,
  TournamentFormat,
  TournamentStatus,
} from "@pcos/types";

export interface Venue {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  address: string | null;
  localHostname: string | null;
  localUrl: string | null;
  publicUrl: string | null;
  version: number;
}

export interface OrganizationView {
  id: string;
  name: string;
  slug: string;
  settings: {
    locale: string;
    timezone: string;
    currency: string;
    featureFlags: FeatureFlags;
    version: number;
  };
}

export interface StructureSummary {
  id: string;
  name: string;
  description: string | null;
  ownerTournamentId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  levelCount: number;
  totalSeconds: number;
}

export interface StructureDetail {
  id: string;
  name: string;
  description: string | null;
  ownerTournamentId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  levels: LevelView[];
}

/** Stored template configuration (TournamentTemplateInput minus name/structure/profile ids). */
export interface TemplateConfig {
  description?: string | null;
  gameType: GameType;
  format: TournamentFormat;
  maxPlayers?: number | null;
  expectedPlayers?: number | null;
  startingStack: number;
  tableSize: number;
  buyIn?: Money | null;
  lateRegistrationPolicy: LateRegistrationPolicy;
  reentryPolicy: ReentryPolicy;
  rebuyPolicy: RebuyPolicy;
  addonPolicy: AddonPolicy;
  bountyPolicy: BountyPolicy;
}

export interface TournamentTemplate {
  id: string;
  name: string;
  config: TemplateConfig;
  structureId: string;
  houseRulesProfileId: string | null;
  displayTemplateId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface HouseRulesProfile {
  id: string;
  name: string;
  preset: "TDA_2026_STYLE" | "CUSTOM";
  config: HouseRulesConfig;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DisplayTemplate {
  id: string;
  name: string;
}

export interface PositionTableConfigView {
  points: number[];
  otherPositionsPoints?: number;
  participationPoints?: number;
  bountyPoints?: number;
}

export interface FormulaConfigView {
  expression: string;
  minPoints?: number;
  roundTo?: number;
}

export type ScoreRule =
  | { id: string; name: string; kind: "POSITION_TABLE"; config: PositionTableConfigView; createdAt: string; updatedAt: string }
  | { id: string; name: string; kind: "FORMULA"; config: FormulaConfigView; createdAt: string; updatedAt: string };

export interface Season {
  id: string;
  leagueId: string;
  name: string;
  startsOn: string;
  endsOn: string;
  createdAt: string;
}

export interface League {
  id: string;
  name: string;
  description: string | null;
  scoreRuleId: string;
  bestResultsCount: number | null;
  status: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  seasons: Season[];
}

export interface Series {
  id: string;
  seasonId: string | null;
  name: string;
  startsOn: string | null;
  endsOn: string | null;
  createdAt: string;
}

export interface LeaderboardEntry {
  rank: number;
  playerId: string;
  playerName: string;
  points: number;
  tournaments: number;
  counted: number;
  wins: number;
  bestPosition: number;
  previousRank: number | null;
}

export interface LeaderboardView {
  season: Season;
  computedAt: string | null;
  rows: LeaderboardEntry[];
}

export interface PlayerTag {
  id: string;
  name: string;
  color: string | null;
}

export interface PlayerSummary {
  id: string;
  externalPublicId: string;
  memberNumber: string | null;
  firstName: string;
  lastName: string;
  displayName: string;
  nickname: string | null;
  email: string | null;
  phone: string | null;
  status: PlayerStatus;
  source: PlayerSource;
  marketingConsent: boolean;
  publicProfileEnabled: boolean;
  hasAccount: boolean;
  hasKioskPin: boolean;
  version: number;
  createdAt: string;
}

export interface PlayerListItem extends PlayerSummary {
  tags: PlayerTag[];
}

export interface PlayerSearchResult {
  total: number;
  items: PlayerListItem[];
}

export interface PlayerNote {
  id: string;
  body: string;
  visibility: "STAFF" | "MANAGEMENT";
  author: string | null;
  createdAt: string;
}

export interface PlayerConsent {
  type: ConsentType;
  granted: boolean;
  source: string;
  createdAt: string;
}

export interface PlayerHistoryRow {
  tournamentId: string;
  name: string;
  startAt: string;
  status: TournamentStatus;
  registrationStatus: RegistrationStatus;
  position: number | null;
  points: number | null;
  entries: number | null;
}

export interface PlayerDetail extends PlayerSummary {
  country: string | null;
  language: string | null;
  dateOfBirth: string | null;
  tags: PlayerTag[];
  notes: PlayerNote[];
  consents: PlayerConsent[];
  telegram: { username: string | null; linkedAt: string } | null;
  history: PlayerHistoryRow[];
  stats: { tournaments: number; wins: number; bestFinish: number | null; lastVisit: string | null; noShows: number };
}

export interface ImportUpload {
  id: string;
  headers: string[];
  rowCount: number;
  sample: Record<string, string>[];
  suggestedMapping: Record<string, PlayerImportField>;
  fields: PlayerImportField[];
}

export interface ImportPreview {
  total: number;
  valid: number;
  invalid: { row: number; errors: string[] }[];
  duplicates: { row: number; name: string; duplicateOf: { playerId: string; field: string } | null; inFileDuplicateOf: number | null }[];
  willCreate: number;
  willUpdate: number;
  willSkip: number;
  sampleNew?: Record<string, unknown>[];
  sample?: Record<string, unknown>[];
}

export interface ImportReport {
  created: number;
  updated: number;
  skipped: number;
  invalid: number;
  duplicates: number;
}

export type QrKind = "localRegistration" | "localLive" | "publicRegistration" | "telegram";

export interface QrCodes {
  links: Record<QrKind, string | null>;
  qr: Record<QrKind, string | null>;
}
