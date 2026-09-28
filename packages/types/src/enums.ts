// Shared enumerations. Each enum is a readonly tuple (usable by zod and DB check
// constraints) plus a derived union type.

export const EDGE_NODE_STATUSES = ["ONLINE", "DEGRADED", "OFFLINE", "MAINTENANCE"] as const;
export type EdgeNodeStatus = (typeof EDGE_NODE_STATUSES)[number];

export const DEVICE_TYPES = [
  "ADMIN_PC",
  "TD_TABLET",
  "FLOOR_PHONE",
  "DEALER_TABLET",
  "CASHIER",
  "REGISTRATION_DESK",
  "DISPLAY",
  "KIOSK",
  "OTHER",
] as const;
export type DeviceType = (typeof DEVICE_TYPES)[number];

export const ROLES = [
  "SUPER_ADMIN",
  "ORGANIZATION_OWNER",
  "MANAGER",
  "TOURNAMENT_DIRECTOR",
  "FLOOR_MANAGER",
  "REGISTRATION_STAFF",
  "CASHIER",
  "DEALER",
  "MARKETING_MANAGER",
  "READ_ONLY_ANALYST",
  "PLAYER",
] as const;
export type RoleKey = (typeof ROLES)[number];

export const PLAYER_STATUSES = ["ACTIVE", "INACTIVE", "BANNED", "MERGED"] as const;
export type PlayerStatus = (typeof PLAYER_STATUSES)[number];

export const PLAYER_SOURCES = ["STAFF", "PLAYER_WEB", "KIOSK", "TELEGRAM", "IMPORT", "WALK_IN", "CLOUD"] as const;
export type PlayerSource = (typeof PLAYER_SOURCES)[number];

export const CONSENT_TYPES = ["MARKETING", "PRIVACY_POLICY", "PUBLIC_PROFILE", "TELEGRAM_NOTIFICATIONS"] as const;
export type ConsentType = (typeof CONSENT_TYPES)[number];

export const GAME_TYPES = ["NLHE", "PLO", "PLO5", "MIXED", "OTHER"] as const;
export type GameType = (typeof GAME_TYPES)[number];

export const TOURNAMENT_FORMATS = [
  "FREEZEOUT",
  "REENTRY",
  "REBUY",
  "BOUNTY",
  "PROGRESSIVE_KO",
  "MYSTERY_BOUNTY",
  "SATELLITE",
  "SHOOTOUT",
  "MULTI_DAY",
] as const;
export type TournamentFormat = (typeof TOURNAMENT_FORMATS)[number];

/** Formats with complete operational support in this release. The rest are modelled but gated. */
export const SUPPORTED_TOURNAMENT_FORMATS: readonly TournamentFormat[] = ["FREEZEOUT", "REENTRY", "REBUY", "BOUNTY"];

export const TOURNAMENT_STATUSES = [
  "DRAFT",
  "SCHEDULED",
  "REGISTRATION_OPEN",
  "SEATING",
  "RUNNING",
  "BREAK",
  "PAUSED",
  "HAND_FOR_HAND",
  "FINISHED",
  "FINALIZED",
  "CANCELLED",
] as const;
export type TournamentStatus = (typeof TOURNAMENT_STATUSES)[number];

export const LIVE_TOURNAMENT_STATUSES: readonly TournamentStatus[] = ["RUNNING", "BREAK", "PAUSED", "HAND_FOR_HAND"];

export const PUBLIC_VISIBILITIES = ["PUBLIC", "UNLISTED", "PRIVATE"] as const;
export type PublicVisibility = (typeof PUBLIC_VISIBILITIES)[number];

export const REGISTRATION_STATUSES = [
  "RESERVED",
  "REGISTERED",
  "CHECKED_IN",
  "WAITLISTED",
  "PLAYING",
  "ELIMINATED",
  "CANCELLED",
  "NO_SHOW",
] as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

/** Registrations that occupy a place (count toward capacity). */
export const ACTIVE_REGISTRATION_STATUSES: readonly RegistrationStatus[] = [
  "RESERVED",
  "REGISTERED",
  "CHECKED_IN",
  "PLAYING",
  "ELIMINATED",
];

export const REGISTRATION_SOURCES = [
  "PLAYER_WEB",
  "PLAYER_QR",
  "TELEGRAM",
  "TELEGRAM_MINI_APP",
  "KIOSK",
  "STAFF",
  "IMPORT",
  "WALK_IN",
] as const;
export type RegistrationSource = (typeof REGISTRATION_SOURCES)[number];

export const ENTRY_TYPES = ["INITIAL", "REENTRY"] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];

export const ENTRY_STATUSES = ["ACTIVE", "ELIMINATED", "VOIDED"] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];

export const ENTRY_TRANSACTION_TYPES = ["BUY_IN", "REBUY", "ADD_ON", "CHIP_ADJUSTMENT", "BOUNTY_WON", "VOID"] as const;
export type EntryTransactionType = (typeof ENTRY_TRANSACTION_TYPES)[number];

export const LEVEL_TYPES = ["PLAY", "BREAK"] as const;
export type LevelType = (typeof LEVEL_TYPES)[number];

export const ANTE_TYPES = ["NONE", "STANDARD", "BIG_BLIND"] as const;
export type AnteType = (typeof ANTE_TYPES)[number];

export const CLOCK_STATUSES = ["NOT_STARTED", "RUNNING", "PAUSED", "FINISHED"] as const;
export type ClockStatus = (typeof CLOCK_STATUSES)[number];

export const TABLE_STATUSES = ["OPEN", "ACTIVE", "BREAKING", "CLOSED"] as const;
export type TableStatus = (typeof TABLE_STATUSES)[number];

export const SEAT_ASSIGNMENT_STATUSES = ["ACTIVE", "RELEASED"] as const;
export type SeatAssignmentStatus = (typeof SEAT_ASSIGNMENT_STATUSES)[number];

export const SEAT_MOVEMENT_REASONS = [
  "INITIAL_SEATING",
  "LATE_REGISTRATION",
  "BALANCE",
  "TABLE_BREAK",
  "MANUAL",
  "CORRECTION",
  "RESTORE",
] as const;
export type SeatMovementReason = (typeof SEAT_MOVEMENT_REASONS)[number];

export const RESULT_STATUSES = ["PROVISIONAL", "FINALIZED"] as const;
export type ResultStatus = (typeof RESULT_STATUSES)[number];

export const NOTIFICATION_CHANNELS = ["IN_APP", "TELEGRAM", "EMAIL", "SMS", "PUSH"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_STATUSES = ["PENDING", "SENDING", "SENT", "FAILED", "EXPIRED", "CANCELLED"] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export const NOTIFICATION_TYPES = [
  "REGISTRATION_CONFIRMED",
  "REGISTRATION_CANCELLED",
  "TOURNAMENT_REMINDER",
  "TOURNAMENT_CHANGED",
  "TOURNAMENT_CANCELLED",
  "REGISTRATION_OPENING",
  "LATE_REGISTRATION_CLOSING",
  "SEAT_ASSIGNED",
  "TABLE_MOVE",
  "RESULTS_FINALIZED",
  "LEAGUE_POSITION_CHANGED",
  "ANNOUNCEMENT",
  "STAFF_ALERT",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const SEVERITIES = ["INFO", "WARNING", "CRITICAL"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const TELEGRAM_MODES = ["EDGE_LONG_POLLING", "CLOUD_WEBHOOK"] as const;
export type TelegramMode = (typeof TELEGRAM_MODES)[number];

export const TELEGRAM_INTEGRATION_STATUSES = [
  "DISABLED",
  "CONNECTING",
  "ONLINE",
  "OFFLINE",
  "WAITING_FOR_NETWORK",
  "ERROR",
] as const;
export type TelegramIntegrationStatus = (typeof TELEGRAM_INTEGRATION_STATUSES)[number];

export const TELEGRAM_LINK_STATUSES = ["ACTIVE", "REVOKED"] as const;
export type TelegramLinkStatus = (typeof TELEGRAM_LINK_STATUSES)[number];

export const DISPLAY_TOKEN_KINDS = ["DISPLAY", "KIOSK"] as const;
export type DisplayTokenKind = (typeof DISPLAY_TOKEN_KINDS)[number];

export const OUTBOX_SYNC_STATUSES = ["PENDING", "SYNCED", "FAILED", "SKIPPED"] as const;
export type OutboxSyncStatus = (typeof OUTBOX_SYNC_STATUSES)[number];

export const SYNC_CONFLICT_RESOLUTIONS = ["KEEP_LOCAL", "ACCEPT_REMOTE", "MANUAL"] as const;
export type SyncConflictResolution = (typeof SYNC_CONFLICT_RESOLUTIONS)[number];

export const IMPORT_JOB_STATUSES = ["UPLOADED", "MAPPED", "VALIDATED", "APPLIED", "FAILED"] as const;
export type ImportJobStatus = (typeof IMPORT_JOB_STATUSES)[number];

export const BACKUP_STATUSES = ["REQUESTED", "RUNNING", "SUCCEEDED", "FAILED"] as const;
export type BackupStatus = (typeof BACKUP_STATUSES)[number];

export const LEAGUE_STATUSES = ["ACTIVE", "ARCHIVED"] as const;
export type LeagueStatus = (typeof LEAGUE_STATUSES)[number];

export const SCORE_RULE_KINDS = ["POSITION_TABLE", "FORMULA"] as const;
export type ScoreRuleKind = (typeof SCORE_RULE_KINDS)[number];

/** Client-side connectivity states (spec §17). */
export const CONNECTIVITY_STATES = [
  "LOCAL_CONNECTED",
  "WAN_OFFLINE",
  "LAN_DISCONNECTED",
  "SERVER_UNREACHABLE",
  "SYNC_PENDING",
] as const;
export type ConnectivityState = (typeof CONNECTIVITY_STATES)[number];

export const FEATURE_FLAGS = [
  "playerRegistration",
  "qrRegistration",
  "telegram",
  "telegramMiniApp",
  "telegramStaffCommands",
  "kiosk",
  "dealerInterface",
  "leagues",
  "publicProfiles",
  "publicSeatList",
  "paidRegistration",
  "prizeTracking",
  "memberships",
  "cashGameWaitlists",
  "timeCharge",
  "advancedAnalytics",
  "cloudSync",
  "remoteAccess",
] as const;
export type FeatureFlag = (typeof FEATURE_FLAGS)[number];
export type FeatureFlags = Record<FeatureFlag, boolean>;

export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  playerRegistration: true,
  qrRegistration: true,
  telegram: false,
  telegramMiniApp: false,
  // Dangerous: state-changing staff commands over Telegram are disabled by default (spec §29).
  telegramStaffCommands: false,
  kiosk: true,
  dealerInterface: true,
  leagues: true,
  publicProfiles: false,
  publicSeatList: true,
  paidRegistration: false,
  prizeTracking: false,
  memberships: false,
  cashGameWaitlists: false,
  timeCharge: false,
  advancedAnalytics: true,
  cloudSync: false,
  remoteAccess: false,
};
