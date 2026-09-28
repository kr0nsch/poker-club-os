import { z } from "zod";
import { CONSENT_TYPES, PLAYER_SOURCES, PLAYER_STATUSES } from "../enums.js";
import { NonEmptyTrimmed, OptionalTrimmed } from "./common.js";

const Phone = z
  .string()
  .trim()
  .max(32)
  .regex(/^[+0-9 ()-]*$/, "digits, spaces, +, -, ( ) only");

export const PlayerCreateInput = z.object({
  firstName: NonEmptyTrimmed(80),
  lastName: NonEmptyTrimmed(80),
  displayName: OptionalTrimmed(80),
  nickname: OptionalTrimmed(40),
  email: z
    .email()
    .max(254)
    .transform((v) => v.toLowerCase())
    .nullish()
    .or(z.literal("").transform(() => null)),
  phone: Phone.nullish(),
  memberNumber: OptionalTrimmed(32),
  language: z.string().min(2).max(8).nullish(),
  country: z.string().length(2).toUpperCase().nullish(),
  dateOfBirth: z.iso.date().nullish(),
  source: z.enum(PLAYER_SOURCES).default("STAFF"),
  marketingConsent: z.boolean().default(false),
  publicProfileEnabled: z.boolean().default(false),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
});
export type PlayerCreateInput = z.infer<typeof PlayerCreateInput>;

export const PlayerUpdateInput = PlayerCreateInput.omit({ source: true, tags: true })
  .partial()
  .extend({
    status: z.enum(PLAYER_STATUSES).optional(),
    expectedVersion: z.number().int().min(0),
  });
export type PlayerUpdateInput = z.infer<typeof PlayerUpdateInput>;

export const PlayerSearchQuery = z.object({
  q: z.string().trim().max(100).optional(),
  tag: z.string().trim().max(40).optional(),
  status: z.enum(PLAYER_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type PlayerSearchQuery = z.infer<typeof PlayerSearchQuery>;

export const PlayerNoteInput = z.object({
  body: NonEmptyTrimmed(4000),
  visibility: z.enum(["STAFF", "MANAGEMENT"]).default("STAFF"),
});

export const PlayerConsentInput = z.object({
  type: z.enum(CONSENT_TYPES),
  granted: z.boolean(),
  source: z.string().max(40).default("STAFF"),
});

export const PlayerTagInput = z.object({ name: NonEmptyTrimmed(40), color: z.string().max(16).optional() });

export const KioskPinInput = z.object({ pin: z.string().regex(/^\d{4,8}$/, "4-8 digits") });

export const ImportMappingInput = z.object({
  mapping: z.record(z.string(), z.string()),
  duplicateStrategy: z.enum(["SKIP", "UPDATE"]).default("SKIP"),
});

export const ImportUploadInput = z.object({
  filename: z.string().max(200),
  content: z.string().max(10 * 1024 * 1024),
});

/** Fields a CSV column may be mapped onto. */
export const PLAYER_IMPORT_FIELDS = [
  "firstName",
  "lastName",
  "displayName",
  "nickname",
  "email",
  "phone",
  "memberNumber",
  "country",
  "language",
  "dateOfBirth",
  "marketingConsent",
  "tags",
] as const;
export type PlayerImportField = (typeof PLAYER_IMPORT_FIELDS)[number];
