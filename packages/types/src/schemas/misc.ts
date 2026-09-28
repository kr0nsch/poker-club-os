import { z } from "zod";
import {
  DEVICE_TYPES,
  DISPLAY_TOKEN_KINDS,
  FEATURE_FLAGS,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_TYPES,
  SCORE_RULE_KINDS,
  SEVERITIES,
  SYNC_CONFLICT_RESOLUTIONS,
  TELEGRAM_MODES,
} from "../enums.js";
import { IsoDateTime, NonEmptyTrimmed, OptionalTrimmed, Slug } from "./common.js";

// --- organisation / venue / edge ----------------------------------------------

export const OrganizationUpdateInput = z.object({
  name: NonEmptyTrimmed(120).optional(),
  locale: z.string().min(2).max(10).optional(),
  timezone: z.string().min(1).max(64).optional(),
  currency: z.string().length(3).optional(),
  featureFlags: z.partialRecord(z.enum(FEATURE_FLAGS), z.boolean()).optional(),
  notificationTypes: z.partialRecord(z.enum(NOTIFICATION_TYPES), z.boolean()).optional(),
});

export const VenueInput = z.object({
  name: NonEmptyTrimmed(120),
  slug: Slug,
  timezone: z.string().min(1).max(64).default("Europe/Berlin"),
  address: OptionalTrimmed(300),
  localHostname: OptionalTrimmed(253),
  localUrl: z.url().nullish(),
  publicUrl: z.url().nullish(),
});

export const DeviceUpdateInput = z.object({
  name: NonEmptyTrimmed(80).optional(),
  type: z.enum(DEVICE_TYPES).optional(),
  trusted: z.boolean().optional(),
  assignedTableId: z.uuid().nullable().optional(),
});

// --- announcements / display -----------------------------------------------------

export const AnnouncementInput = z.object({
  venueId: z.uuid().nullish(),
  tournamentId: z.uuid().nullish(),
  body: NonEmptyTrimmed(500),
  severity: z.enum(SEVERITIES).default("INFO"),
  channels: z
    .array(z.enum(["DISPLAY", "PLAYER_LIVE", "TELEGRAM"]))
    .min(1)
    .default(["DISPLAY", "PLAYER_LIVE"]),
  displaySeconds: z.number().int().min(5).max(24 * 3600).default(300),
});
export type AnnouncementInput = z.infer<typeof AnnouncementInput>;

export const DISPLAY_WIDGETS = [
  "CLOCK",
  "BLINDS",
  "NEXT_LEVEL",
  "NEXT_BREAK",
  "ENTRIES",
  "REMAINING",
  "AVERAGE_STACK",
  "ANNOUNCEMENTS",
  "LOGO",
  "SPONSOR",
  "LEADERBOARD",
  "SEATING",
  "PRIZE_POOL",
] as const;
export type DisplayWidget = (typeof DISPLAY_WIDGETS)[number];

export const DisplayTemplateInput = z.object({
  name: NonEmptyTrimmed(120),
  widgets: z.array(z.enum(DISPLAY_WIDGETS)).min(1),
  theme: z
    .object({
      accent: z.string().max(16).default("#22c55e"),
      background: z.string().max(16).default("#050b09"),
      logoFileId: z.uuid().nullish(),
      sponsorText: z.string().max(120).nullish(),
    })
    .default({ accent: "#22c55e", background: "#050b09" }),
});

export const DisplayTokenInput = z.object({
  name: NonEmptyTrimmed(80),
  kind: z.enum(DISPLAY_TOKEN_KINDS).default("DISPLAY"),
  venueId: z.uuid(),
  tournamentId: z.uuid().nullish(),
  displayTemplateId: z.uuid().nullish(),
});

export const KioskCheckInInput = z.discriminatedUnion("method", [
  z.object({ method: z.literal("QR"), code: z.string().min(6).max(64) }),
  z.object({ method: z.literal("MEMBER_PIN"), memberNumber: z.string().min(1).max(32), pin: z.string().regex(/^\d{4,8}$/) }),
  z.object({ method: z.literal("ONE_TIME_CODE"), code: z.string().regex(/^\d{6}$/) }),
]);
export type KioskCheckInInput = z.infer<typeof KioskCheckInInput>;

// --- leagues -----------------------------------------------------------------------

export const PositionTableConfig = z.object({
  points: z.array(z.number().min(0)).min(1).max(1000),
  otherPositionsPoints: z.number().min(0).default(0),
  participationPoints: z.number().min(0).default(0),
  bountyPoints: z.number().min(0).default(0),
});

export const FormulaConfig = z.object({
  /** Safe arithmetic expression: see domain/scoring. Variables: entrants, position, buyIn, reentries, bounties, players. */
  expression: z.string().min(1).max(500),
  minPoints: z.number().default(0),
  roundTo: z.number().int().min(0).max(4).default(2),
});

export const ScoreRuleInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("POSITION_TABLE"), name: NonEmptyTrimmed(120), config: PositionTableConfig }),
  z.object({ kind: z.literal("FORMULA"), name: NonEmptyTrimmed(120), config: FormulaConfig }),
]);
export type ScoreRuleInput = z.infer<typeof ScoreRuleInput>;
export const ScoreRuleKindSchema = z.enum(SCORE_RULE_KINDS);

export const LeagueInput = z.object({
  name: NonEmptyTrimmed(120),
  description: OptionalTrimmed(2000),
  scoreRuleId: z.uuid(),
  /** Count only the best N results per player (null = all). */
  bestResultsCount: z.number().int().min(1).max(500).nullish(),
});

export const SeasonInput = z.object({
  name: NonEmptyTrimmed(120),
  startsOn: z.iso.date(),
  endsOn: z.iso.date(),
});

export const SeriesInput = z.object({
  name: NonEmptyTrimmed(120),
  seasonId: z.uuid().nullish(),
  startsOn: z.iso.date().nullish(),
  endsOn: z.iso.date().nullish(),
});

// --- notifications -------------------------------------------------------------------

export const NotificationPreferenceInput = z.object({
  channel: z.enum(NOTIFICATION_CHANNELS),
  type: z.enum(NOTIFICATION_TYPES),
  enabled: z.boolean(),
});

// --- telegram --------------------------------------------------------------------------

export const TelegramIntegrationInput = z.object({
  enabled: z.boolean(),
  mode: z.enum(TELEGRAM_MODES).default("EDGE_LONG_POLLING"),
  botUsername: z.string().trim().regex(/^[A-Za-z0-9_]{5,64}$/).optional(),
  /** Write-only. Never returned by the API. */
  botToken: z.string().regex(/^\d+:[A-Za-z0-9_-]{30,}$/).optional(),
  staffAlertsChatId: z.string().max(40).nullish(),
});

export const TelegramLinkCodeInput = z.object({ code: z.string().regex(/^[A-Z0-9]{8}$/) });

export const TelegramMiniAppAuthInput = z.object({ initData: z.string().min(10).max(8192) });

// --- sync -------------------------------------------------------------------------------

export const SyncConflictResolveInput = z.object({
  resolution: z.enum(SYNC_CONFLICT_RESOLUTIONS),
  note: z.string().max(500).optional(),
});

export const AuditQuery = z.object({
  tournamentId: z.uuid().optional(),
  entityType: z.string().max(60).optional(),
  entityId: z.string().max(80).optional(),
  actorId: z.uuid().optional(),
  action: z.string().max(80).optional(),
  from: IsoDateTime.optional(),
  to: IsoDateTime.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
