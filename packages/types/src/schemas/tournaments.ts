import { z } from "zod";
import { ANTE_TYPES, GAME_TYPES, LEVEL_TYPES, PUBLIC_VISIBILITIES, TOURNAMENT_FORMATS } from "../enums.js";
import { IsoDateTime, Money, NonEmptyTrimmed, OptionalTrimmed, Slug, patchShape } from "./common.js";

// ---------------------------------------------------------------------------
// Blind structure
// ---------------------------------------------------------------------------

export const LevelInput = z
  .object({
    type: z.enum(LEVEL_TYPES),
    smallBlind: z.number().int().min(0).default(0),
    bigBlind: z.number().int().min(0).default(0),
    ante: z.number().int().min(0).default(0),
    anteType: z.enum(ANTE_TYPES).default("NONE"),
    durationSeconds: z.number().int().min(30).max(6 * 3600),
    label: z.string().trim().max(60).nullish(),
    note: z.string().trim().max(200).nullish(),
  })
  .superRefine((level, ctx) => {
    if (level.type === "PLAY") {
      if (level.bigBlind <= 0) ctx.addIssue({ code: "custom", message: "big blind must be positive", path: ["bigBlind"] });
      if (level.smallBlind > level.bigBlind)
        ctx.addIssue({ code: "custom", message: "small blind cannot exceed big blind", path: ["smallBlind"] });
      if (level.anteType === "NONE" && level.ante > 0)
        ctx.addIssue({ code: "custom", message: "ante set but ante type is NONE", path: ["anteType"] });
    }
  });
export type LevelInput = z.infer<typeof LevelInput>;

export const StructureInput = z.object({
  name: NonEmptyTrimmed(120),
  description: OptionalTrimmed(1000),
  levels: z.array(LevelInput).min(1).max(200),
});
export type StructureInput = z.infer<typeof StructureInput>;

export const StructureLevelsReplaceInput = z.object({
  expectedVersion: z.number().int().min(0),
  levels: z.array(LevelInput).min(1).max(200),
});

// ---------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------

export const LateRegistrationPolicy = z.object({
  enabled: z.boolean().default(true),
  closeMode: z.enum(["LEVEL", "TIME", "MANUAL"]).default("LEVEL"),
  /** Late registration stays open through the end of this (1-based) play level. */
  untilLevel: z.number().int().min(1).max(200).nullish(),
  untilTime: IsoDateTime.nullish(),
});
export type LateRegistrationPolicy = z.infer<typeof LateRegistrationPolicy>;

export const ReentryPolicy = z.object({
  enabled: z.boolean().default(false),
  /** Maximum re-entries per player (not counting the initial entry). null = unlimited. */
  maxReentries: z.number().int().min(0).max(100).nullish(),
  closeMode: z.enum(["WITH_LATE_REGISTRATION", "LEVEL", "MANUAL"]).default("WITH_LATE_REGISTRATION"),
  untilLevel: z.number().int().min(1).max(200).nullish(),
});
export type ReentryPolicy = z.infer<typeof ReentryPolicy>;

export const RebuyPolicy = z.object({
  enabled: z.boolean().default(false),
  maxRebuys: z.number().int().min(0).max(100).nullish(),
  untilLevel: z.number().int().min(1).max(200).nullish(),
  /** Rebuy allowed only when the player's stack is at or below this amount. null = no restriction. */
  stackThreshold: z.number().int().min(0).nullish(),
  chips: z.number().int().min(1).default(10_000),
  amount: z.number().int().min(0).default(0),
});
export type RebuyPolicy = z.infer<typeof RebuyPolicy>;

export const AddonPolicy = z.object({
  enabled: z.boolean().default(false),
  /** Add-on is available during the break following this play level (or any time up to it when null). */
  afterLevel: z.number().int().min(1).max(200).nullish(),
  maxAddons: z.number().int().min(1).max(10).default(1),
  chips: z.number().int().min(1).default(10_000),
  amount: z.number().int().min(0).default(0),
});
export type AddonPolicy = z.infer<typeof AddonPolicy>;

export const BountyPolicy = z.object({
  enabled: z.boolean().default(false),
  amount: z.number().int().min(0).default(0),
  progressive: z.boolean().default(false),
});
export type BountyPolicy = z.infer<typeof BountyPolicy>;

export const DEFAULT_LATE_REG: LateRegistrationPolicy = { enabled: true, closeMode: "LEVEL", untilLevel: 6, untilTime: null };
export const DEFAULT_REENTRY: ReentryPolicy = { enabled: false, maxReentries: null, closeMode: "WITH_LATE_REGISTRATION", untilLevel: null };
export const DEFAULT_REBUY: RebuyPolicy = { enabled: false, maxRebuys: null, untilLevel: null, stackThreshold: null, chips: 10_000, amount: 0 };
export const DEFAULT_ADDON: AddonPolicy = { enabled: false, afterLevel: null, maxAddons: 1, chips: 10_000, amount: 0 };
export const DEFAULT_BOUNTY: BountyPolicy = { enabled: false, amount: 0, progressive: false };

// ---------------------------------------------------------------------------
// House rules (spec §57)
// ---------------------------------------------------------------------------

export const HouseRulesConfig = z.object({
  randomInitialSeating: z.boolean().default(true),
  lateRegistrationSeatPolicy: z.enum(["RANDOM_OPEN_SEAT", "SHORTEST_TABLE_RANDOM_SEAT"]).default("SHORTEST_TABLE_RANDOM_SEAT"),
  tableBreakStrategy: z.enum(["HIGHEST_NUMBER_FIRST", "LOWEST_NUMBER_FIRST", "FEWEST_PLAYERS_FIRST"]).default("HIGHEST_NUMBER_FIRST"),
  tableBalanceStrategy: z.enum(["MOVE_FROM_LONGEST_TO_SHORTEST"]).default("MOVE_FROM_LONGEST_TO_SHORTEST"),
  balancePlayerSelection: z.enum(["BIG_BLIND_NEXT", "RANDOM"]).default("BIG_BLIND_NEXT"),
  seatLockingEnabled: z.boolean().default(true),
  maxTableImbalance: z.number().int().min(1).max(5).default(1),
  haltPlayOnSevereImbalance: z.boolean().default(false),
  severeImbalanceThreshold: z.number().int().min(2).max(9).default(3),
  finalTableSize: z.number().int().min(2).max(11).nullish(),
});
export type HouseRulesConfig = z.infer<typeof HouseRulesConfig>;

export const TDA_2026_STYLE: HouseRulesConfig = {
  randomInitialSeating: true,
  lateRegistrationSeatPolicy: "SHORTEST_TABLE_RANDOM_SEAT",
  tableBreakStrategy: "HIGHEST_NUMBER_FIRST",
  tableBalanceStrategy: "MOVE_FROM_LONGEST_TO_SHORTEST",
  balancePlayerSelection: "BIG_BLIND_NEXT",
  seatLockingEnabled: true,
  maxTableImbalance: 1,
  haltPlayOnSevereImbalance: false,
  severeImbalanceThreshold: 3,
  finalTableSize: null,
};

export const HouseRulesProfileInput = z.object({
  name: NonEmptyTrimmed(120),
  preset: z.enum(["TDA_2026_STYLE", "CUSTOM"]).default("CUSTOM"),
  config: HouseRulesConfig,
});

// ---------------------------------------------------------------------------
// Tournament & template
// ---------------------------------------------------------------------------

const TournamentConfigShape = {
  name: NonEmptyTrimmed(160),
  description: OptionalTrimmed(4000),
  gameType: z.enum(GAME_TYPES).default("NLHE"),
  format: z.enum(TOURNAMENT_FORMATS).default("FREEZEOUT"),
  maxPlayers: z.number().int().min(2).max(5000).nullish(),
  expectedPlayers: z.number().int().min(0).max(5000).nullish(),
  startingStack: z.number().int().min(1).max(100_000_000),
  tableSize: z.number().int().min(2).max(11).default(9),
  buyIn: Money.nullish(),
  lateRegistrationPolicy: LateRegistrationPolicy.default(DEFAULT_LATE_REG),
  reentryPolicy: ReentryPolicy.default(DEFAULT_REENTRY),
  rebuyPolicy: RebuyPolicy.default(DEFAULT_REBUY),
  addonPolicy: AddonPolicy.default(DEFAULT_ADDON),
  bountyPolicy: BountyPolicy.default(DEFAULT_BOUNTY),
} as const;

export const TournamentCreateInput = z.object({
  ...TournamentConfigShape,
  venueId: z.uuid(),
  slug: Slug.optional(),
  templateId: z.uuid().nullish(),
  structureId: z.uuid(),
  seriesId: z.uuid().nullish(),
  seasonId: z.uuid().nullish(),
  houseRulesProfileId: z.uuid().nullish(),
  startAt: IsoDateTime,
  registrationOpenAt: IsoDateTime.nullish(),
  registrationCloseAt: IsoDateTime.nullish(),
  publicVisibility: z.enum(PUBLIC_VISIBILITIES).default("PUBLIC"),
});
export type TournamentCreateInput = z.infer<typeof TournamentCreateInput>;

export const TournamentUpdateInput = z
  .object(
    patchShape({
      ...TournamentConfigShape,
      slug: Slug,
      structureId: z.uuid(),
      seriesId: z.uuid().nullable(),
      seasonId: z.uuid().nullable(),
      houseRulesProfileId: z.uuid().nullable(),
      startAt: IsoDateTime,
      registrationOpenAt: IsoDateTime.nullable(),
      registrationCloseAt: IsoDateTime.nullable(),
      publicVisibility: z.enum(PUBLIC_VISIBILITIES),
    }),
  )
  .extend({ expectedVersion: z.number().int().min(0) });
export type TournamentUpdateInput = z.infer<typeof TournamentUpdateInput>;

export const TournamentTemplateInput = z.object({
  ...TournamentConfigShape,
  structureId: z.uuid(),
  houseRulesProfileId: z.uuid().nullish(),
  displayTemplateId: z.uuid().nullish(),
});
export type TournamentTemplateInput = z.infer<typeof TournamentTemplateInput>;

export const CreateFromTemplateInput = z.object({
  venueId: z.uuid(),
  name: NonEmptyTrimmed(160).optional(),
  startAt: IsoDateTime,
  seasonId: z.uuid().nullish(),
  seriesId: z.uuid().nullish(),
});

export const TournamentListQuery = z.object({
  /** case-insensitive name search */
  q: z.string().trim().max(100).optional(),
  status: z.string().max(200).optional(),
  venueId: z.uuid().optional(),
  from: IsoDateTime.optional(),
  to: IsoDateTime.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
