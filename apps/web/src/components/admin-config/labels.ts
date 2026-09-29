// English labels for enum values (always rendered through t()).

import type {
  AnteType,
  ConsentType,
  GameType,
  HouseRulesConfig,
  PlayerImportField,
  PlayerStatus,
  PublicVisibility,
  TournamentFormat,
  TournamentStatus,
} from "@pcos/types";

export const GAME_TYPE_LABEL: Record<GameType, string> = {
  NLHE: "No-limit Hold'em",
  PLO: "Pot-limit Omaha",
  PLO5: "5-card Pot-limit Omaha",
  MIXED: "Mixed games",
  OTHER: "Other game",
};

export const FORMAT_LABEL: Record<TournamentFormat, string> = {
  FREEZEOUT: "Freezeout",
  REENTRY: "Re-entry",
  REBUY: "Rebuy",
  BOUNTY: "Bounty",
  PROGRESSIVE_KO: "Progressive knockout",
  MYSTERY_BOUNTY: "Mystery bounty",
  SATELLITE: "Satellite",
  SHOOTOUT: "Shootout",
  MULTI_DAY: "Multi-day",
};

export const VISIBILITY_LABEL: Record<PublicVisibility, string> = {
  PUBLIC: "Public",
  UNLISTED: "Unlisted",
  PRIVATE: "Private",
};

export const VISIBILITY_HINT: Record<PublicVisibility, string> = {
  PUBLIC: "Listed on the public schedule once published.",
  UNLISTED: "Not listed; reachable by direct link or QR code.",
  PRIVATE: "Staff only: no public or player pages.",
};

export const TOURNAMENT_STATUS_LABEL: Record<TournamentStatus, string> = {
  DRAFT: "Draft",
  SCHEDULED: "Scheduled",
  REGISTRATION_OPEN: "Registration open",
  SEATING: "Seating",
  RUNNING: "Running",
  BREAK: "Break",
  PAUSED: "Paused",
  HAND_FOR_HAND: "Hand-for-hand",
  FINISHED: "Finished",
  FINALIZED: "Finalized",
  CANCELLED: "Cancelled",
};

export const ANTE_TYPE_LABEL: Record<AnteType, string> = {
  NONE: "No ante",
  STANDARD: "Standard ante",
  BIG_BLIND: "Big blind ante",
};

export const PLAYER_STATUS_LABEL: Record<PlayerStatus, string> = {
  ACTIVE: "Active",
  INACTIVE: "Inactive",
  BANNED: "Banned",
  MERGED: "Merged",
};

export const PLAYER_STATUS_TONE: Record<PlayerStatus, "success" | "muted" | "destructive" | "outline"> = {
  ACTIVE: "success",
  INACTIVE: "muted",
  BANNED: "destructive",
  MERGED: "outline",
};

export const CONSENT_LABEL: Record<ConsentType, string> = {
  MARKETING: "Marketing messages",
  PRIVACY_POLICY: "Privacy policy",
  PUBLIC_PROFILE: "Public profile",
  TELEGRAM_NOTIFICATIONS: "Telegram notifications",
};

export const IMPORT_FIELD_LABEL: Record<PlayerImportField, string> = {
  firstName: "First name",
  lastName: "Last name",
  displayName: "Display name",
  nickname: "Nickname",
  email: "Email",
  phone: "Phone",
  memberNumber: "Member number",
  country: "Country",
  language: "Language",
  dateOfBirth: "Date of birth",
  marketingConsent: "Marketing consent",
  tags: "Tags",
};

export const LATE_REG_CLOSE_LABEL = {
  LEVEL: "At the end of a level",
  TIME: "At a set time",
  MANUAL: "Manually by the director",
} as const;

export const REENTRY_CLOSE_LABEL = {
  WITH_LATE_REGISTRATION: "Together with late registration",
  LEVEL: "At the end of a level",
  MANUAL: "Manually by the director",
} as const;

export const HOUSE_RULE_OPTION_LABEL: {
  lateRegistrationSeatPolicy: Record<HouseRulesConfig["lateRegistrationSeatPolicy"], string>;
  tableBreakStrategy: Record<HouseRulesConfig["tableBreakStrategy"], string>;
  tableBalanceStrategy: Record<HouseRulesConfig["tableBalanceStrategy"], string>;
  balancePlayerSelection: Record<HouseRulesConfig["balancePlayerSelection"], string>;
} = {
  lateRegistrationSeatPolicy: {
    SHORTEST_TABLE_RANDOM_SEAT: "Random seat at the shortest table",
    RANDOM_OPEN_SEAT: "Any random open seat",
  },
  tableBreakStrategy: {
    HIGHEST_NUMBER_FIRST: "Highest table number first",
    LOWEST_NUMBER_FIRST: "Lowest table number first",
    FEWEST_PLAYERS_FIRST: "Table with the fewest players first",
  },
  tableBalanceStrategy: {
    MOVE_FROM_LONGEST_TO_SHORTEST: "Move from the longest to the shortest table",
  },
  balancePlayerSelection: {
    BIG_BLIND_NEXT: "Player due to be big blind next",
    RANDOM: "Random player",
  },
};

/** Human names of tournament configuration fields (conflict and lock messages). */
export const CONFIG_FIELD_LABEL: Record<string, string> = {
  name: "Tournament name",
  description: "Description",
  gameType: "Game",
  format: "Format",
  startingStack: "Starting stack",
  tableSize: "Players per table",
  maxPlayers: "Maximum players",
  expectedPlayers: "Expected players",
  buyIn: "Buy-in",
  lateRegistrationPolicy: "Late registration",
  reentryPolicy: "Re-entry",
  rebuyPolicy: "Rebuys",
  addonPolicy: "Add-on",
  bountyPolicy: "Bounties",
  structureId: "Blind structure",
  houseRulesProfileId: "House rules",
  venueId: "Venue",
  slug: "Link name (slug)",
  startAt: "Start time",
  registrationOpenAt: "Registration opens",
  registrationCloseAt: "Pre-registration closes",
  publicVisibility: "Visibility",
  seasonId: "Season",
  seriesId: "Series",
  displayTemplateId: "TV display layout",
  templateId: "Template",
};

export const HOUSE_PRESET_LABEL = {
  TDA_2026_STYLE: "TDA 2026 style",
  CUSTOM: "Custom",
} as const;
