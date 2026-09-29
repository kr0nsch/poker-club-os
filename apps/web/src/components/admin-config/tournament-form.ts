// Tournament / template configuration form model: UI state (strings as typed),
// conversion from API read models, validation and payload building.

import {
  DEFAULT_ADDON,
  DEFAULT_BOUNTY,
  DEFAULT_LATE_REG,
  DEFAULT_REBUY,
  DEFAULT_REENTRY,
  LIVE_TOURNAMENT_STATUSES,
  type AddonPolicy,
  type BountyPolicy,
  type GameType,
  type LateRegistrationPolicy,
  type Money,
  type PublicVisibility,
  type RebuyPolicy,
  type ReentryPolicy,
  type TournamentDetailView,
  type TournamentFormat,
  type TournamentStatus,
} from "@pcos/types";
import type { TemplateConfig, TournamentTemplate } from "./types";
import { SLUG_RE, centsToUnits, intToField, isoToLocalInput, localInputToIso, parseIntOrNull, unitsToCents } from "./utils";

type T = (text: string, vars?: Record<string, string | number | null | undefined>) => string;

export type FormMode = "create" | "edit" | "template";

export interface TournamentForm {
  name: string;
  description: string;
  gameType: GameType;
  format: TournamentFormat;
  startingStack: string;
  tableSize: string;
  maxPlayers: string;
  expectedPlayers: string;
  buyInAmount: string;
  buyInFee: string;
  currency: string;
  /** create/template: library structure; edit: "" keeps the tournament's own copy, an id replaces it. */
  structureId: string;
  houseRulesProfileId: string;
  venueId: string;
  slug: string;
  startAt: string;
  registrationOpenAt: string;
  registrationCloseAt: string;
  publicVisibility: PublicVisibility;
  seasonId: string;
  seriesId: string;
  displayTemplateId: string;
  templateId: string;
  lateReg: { enabled: boolean; closeMode: LateRegistrationPolicy["closeMode"]; untilLevel: string; untilTime: string };
  reentry: { enabled: boolean; maxReentries: string; closeMode: ReentryPolicy["closeMode"]; untilLevel: string };
  rebuy: { enabled: boolean; maxRebuys: string; untilLevel: string; stackThreshold: string; chips: string; amount: string };
  addon: { enabled: boolean; afterLevel: string; maxAddons: string; chips: string; amount: string };
  bounty: { enabled: boolean; amount: string; progressive: boolean };
}

/** API field names (TournamentCreateInput / TournamentUpdateInput / TournamentTemplateInput). */
export type ConfigField =
  | "name"
  | "description"
  | "gameType"
  | "format"
  | "startingStack"
  | "tableSize"
  | "maxPlayers"
  | "expectedPlayers"
  | "buyIn"
  | "lateRegistrationPolicy"
  | "reentryPolicy"
  | "rebuyPolicy"
  | "addonPolicy"
  | "bountyPolicy"
  | "structureId"
  | "houseRulesProfileId"
  | "venueId"
  | "slug"
  | "startAt"
  | "registrationOpenAt"
  | "registrationCloseAt"
  | "publicVisibility"
  | "seasonId"
  | "seriesId"
  | "displayTemplateId"
  | "templateId";

/** Which form keys hold each API field (used to merge concurrent edits). */
export const FORM_KEYS: Record<ConfigField, (keyof TournamentForm)[]> = {
  name: ["name"],
  description: ["description"],
  gameType: ["gameType"],
  format: ["format"],
  startingStack: ["startingStack"],
  tableSize: ["tableSize"],
  maxPlayers: ["maxPlayers"],
  expectedPlayers: ["expectedPlayers"],
  buyIn: ["buyInAmount", "buyInFee", "currency"],
  lateRegistrationPolicy: ["lateReg"],
  reentryPolicy: ["reentry"],
  rebuyPolicy: ["rebuy"],
  addonPolicy: ["addon"],
  bountyPolicy: ["bounty"],
  structureId: ["structureId"],
  houseRulesProfileId: ["houseRulesProfileId"],
  venueId: ["venueId"],
  slug: ["slug"],
  startAt: ["startAt"],
  registrationOpenAt: ["registrationOpenAt"],
  registrationCloseAt: ["registrationCloseAt"],
  publicVisibility: ["publicVisibility"],
  seasonId: ["seasonId"],
  seriesId: ["seriesId"],
  displayTemplateId: ["displayTemplateId"],
  templateId: ["templateId"],
};

const COMMON: ConfigField[] = [
  "name",
  "description",
  "gameType",
  "format",
  "startingStack",
  "tableSize",
  "maxPlayers",
  "expectedPlayers",
  "buyIn",
  "lateRegistrationPolicy",
  "reentryPolicy",
  "rebuyPolicy",
  "addonPolicy",
  "bountyPolicy",
  "structureId",
  "houseRulesProfileId",
];

export const FIELDS: Record<FormMode, ConfigField[]> = {
  create: [...COMMON, "venueId", "templateId", "startAt", "registrationOpenAt", "registrationCloseAt", "publicVisibility", "seasonId", "seriesId"],
  edit: [...COMMON, "slug", "startAt", "registrationOpenAt", "registrationCloseAt", "publicVisibility", "seasonId", "seriesId"],
  template: [...COMMON, "displayTemplateId"],
};

// Mirrors LIVE_EDITABLE / CLOSED_EDITABLE in packages/core/src/services/tournament.service.ts.
const LIVE_EDITABLE = new Set<ConfigField>(["name", "description", "maxPlayers", "expectedPlayers", "lateRegistrationPolicy", "reentryPolicy", "rebuyPolicy", "addonPolicy", "publicVisibility", "seasonId", "seriesId"]);
const CLOSED_EDITABLE = new Set<ConfigField>(["name", "description", "seasonId", "seriesId", "publicVisibility"]);

export const isClosedStatus = (s: TournamentStatus) => s === "FINISHED" || s === "FINALIZED" || s === "CANCELLED";
export const isStartedStatus = (s: TournamentStatus) => s === "SEATING" || LIVE_TOURNAMENT_STATUSES.includes(s);

/** Fields the API still accepts in this status (null = everything). */
export function editableFields(status: TournamentStatus): ReadonlySet<ConfigField> | null {
  if (isClosedStatus(status)) return CLOSED_EDITABLE;
  if (isStartedStatus(status)) return LIVE_EDITABLE;
  return null;
}

/** Entry options that matter for each format (others stay available on request). */
export const RELEVANT_POLICIES: Record<TournamentFormat, ("reentry" | "rebuy" | "addon" | "bounty")[]> = {
  FREEZEOUT: [],
  REENTRY: ["reentry"],
  REBUY: ["rebuy", "addon"],
  BOUNTY: ["bounty"],
  PROGRESSIVE_KO: ["bounty"],
  MYSTERY_BOUNTY: ["bounty"],
  SATELLITE: [],
  SHOOTOUT: [],
  MULTI_DAY: ["reentry"],
};

// --- construction ------------------------------------------------------------------------------

const lateRegForm = (p: LateRegistrationPolicy | undefined): TournamentForm["lateReg"] => {
  const v = p ?? DEFAULT_LATE_REG;
  return { enabled: v.enabled, closeMode: v.closeMode, untilLevel: intToField(v.untilLevel), untilTime: isoToLocalInput(v.untilTime) };
};
const reentryForm = (p: ReentryPolicy | undefined): TournamentForm["reentry"] => {
  const v = p ?? DEFAULT_REENTRY;
  return { enabled: v.enabled, maxReentries: intToField(v.maxReentries), closeMode: v.closeMode, untilLevel: intToField(v.untilLevel) };
};
const rebuyForm = (p: RebuyPolicy | undefined): TournamentForm["rebuy"] => {
  const v = p ?? DEFAULT_REBUY;
  return {
    enabled: v.enabled,
    maxRebuys: intToField(v.maxRebuys),
    untilLevel: intToField(v.untilLevel),
    stackThreshold: intToField(v.stackThreshold),
    chips: intToField(v.chips),
    amount: centsToUnits(v.amount),
  };
};
const addonForm = (p: AddonPolicy | undefined): TournamentForm["addon"] => {
  const v = p ?? DEFAULT_ADDON;
  return { enabled: v.enabled, afterLevel: intToField(v.afterLevel), maxAddons: intToField(v.maxAddons), chips: intToField(v.chips), amount: centsToUnits(v.amount) };
};
const bountyForm = (p: BountyPolicy | undefined): TournamentForm["bounty"] => {
  const v = p ?? DEFAULT_BOUNTY;
  return { enabled: v.enabled, amount: centsToUnits(v.amount), progressive: v.progressive };
};

export function emptyForm(defaults: { currency: string; venueId?: string; structureId?: string; startAt?: string }): TournamentForm {
  return {
    name: "",
    description: "",
    gameType: "NLHE",
    format: "FREEZEOUT",
    startingStack: "20000",
    tableSize: "9",
    maxPlayers: "",
    expectedPlayers: "",
    buyInAmount: "",
    buyInFee: "",
    currency: defaults.currency,
    structureId: defaults.structureId ?? "",
    houseRulesProfileId: "",
    venueId: defaults.venueId ?? "",
    slug: "",
    startAt: defaults.startAt ?? "",
    registrationOpenAt: "",
    registrationCloseAt: "",
    publicVisibility: "PUBLIC",
    seasonId: "",
    seriesId: "",
    displayTemplateId: "",
    templateId: "",
    lateReg: lateRegForm(DEFAULT_LATE_REG),
    reentry: reentryForm(DEFAULT_REENTRY),
    rebuy: rebuyForm(DEFAULT_REBUY),
    addon: addonForm(DEFAULT_ADDON),
    bounty: bountyForm(DEFAULT_BOUNTY),
  };
}

function configToForm(c: Partial<TemplateConfig>, currency: string): Pick<TournamentForm, "description" | "gameType" | "format" | "startingStack" | "tableSize" | "maxPlayers" | "expectedPlayers" | "buyInAmount" | "buyInFee" | "currency" | "lateReg" | "reentry" | "rebuy" | "addon" | "bounty"> {
  return {
    description: c.description ?? "",
    gameType: c.gameType ?? "NLHE",
    format: c.format ?? "FREEZEOUT",
    startingStack: intToField(c.startingStack ?? 20000),
    tableSize: intToField(c.tableSize ?? 9),
    maxPlayers: intToField(c.maxPlayers),
    expectedPlayers: intToField(c.expectedPlayers),
    buyInAmount: c.buyIn ? centsToUnits(c.buyIn.amount) : "",
    buyInFee: c.buyIn && c.buyIn.fee ? centsToUnits(c.buyIn.fee) : "",
    currency: c.buyIn?.currency ?? currency,
    lateReg: lateRegForm(c.lateRegistrationPolicy),
    reentry: reentryForm(c.reentryPolicy),
    rebuy: rebuyForm(c.rebuyPolicy),
    addon: addonForm(c.addonPolicy),
    bounty: bountyForm(c.bountyPolicy),
  };
}

export function formFromDetail(d: TournamentDetailView, currency: string): TournamentForm {
  return {
    ...emptyForm({ currency }),
    ...configToForm(d, currency),
    name: d.name,
    structureId: "",
    houseRulesProfileId: d.houseRulesProfileId ?? "",
    venueId: d.venueId,
    slug: d.slug,
    startAt: isoToLocalInput(d.startAt),
    registrationOpenAt: isoToLocalInput(d.registrationOpenAt),
    registrationCloseAt: isoToLocalInput(d.registrationCloseAt),
    publicVisibility: d.publicVisibility,
    seasonId: d.seasonId ?? "",
    seriesId: d.seriesId ?? "",
    templateId: d.templateId ?? "",
  };
}

export function formFromTemplate(tpl: TournamentTemplate, currency: string, keep?: Partial<TournamentForm>): TournamentForm {
  return {
    ...emptyForm({ currency }),
    ...configToForm(tpl.config, currency),
    ...keep,
    name: tpl.name,
    structureId: tpl.structureId,
    houseRulesProfileId: tpl.houseRulesProfileId ?? "",
    displayTemplateId: tpl.displayTemplateId ?? "",
    templateId: tpl.id,
  };
}

/** Format changes switch on the entry options the format implies (as the server does on create). */
export function applyFormat(f: TournamentForm, format: TournamentFormat): TournamentForm {
  const next = { ...f, format };
  if (format === "REENTRY") next.reentry = { ...f.reentry, enabled: true };
  if (format === "REBUY") next.rebuy = { ...f.rebuy, enabled: true };
  if (format === "BOUNTY" || format === "MYSTERY_BOUNTY") next.bounty = { ...f.bounty, enabled: true };
  if (format === "PROGRESSIVE_KO") next.bounty = { ...f.bounty, enabled: true, progressive: true };
  return next;
}

/** Three-way merge at form level: my edits win for fields I changed, otherwise take theirs. */
export function mergeForms(mine: TournamentForm, theirs: TournamentForm, changedByMe: readonly ConfigField[]): TournamentForm {
  const out: TournamentForm = { ...theirs };
  for (const field of changedByMe) {
    for (const k of FORM_KEYS[field]) (out as unknown as Record<string, unknown>)[k] = mine[k];
  }
  return out;
}

// --- validation & payload -----------------------------------------------------------------------

export type FormErrors = Record<string, string>;
export type ConfigPayload = Partial<Record<ConfigField, unknown>>;

interface NumOpts {
  min?: number;
  max?: number;
  required?: boolean;
}

/**
 * Builds the API payload for the given mode. Fields of disabled entry options
 * are validated leniently (defaults replace invalid input) so a hidden,
 * switched-off section never blocks saving.
 */
export function buildPayload(f: TournamentForm, mode: FormMode, t: T): { value: ConfigPayload; errors: FormErrors } {
  const errors: FormErrors = {};

  const int = (raw: string, key: string, o: NumOpts, strict = true, fallback: number | null = null): number | null => {
    const n = parseIntOrNull(raw);
    const fail = (msg: string) => {
      if (strict) errors[key] = msg;
      return fallback;
    };
    if (n == null) return o.required ? fail(t("Required")) : null;
    if (Number.isNaN(n)) return fail(t("Enter a whole number"));
    if (o.min != null && n < o.min) return fail(t("Must be at least {n}", { n: o.min }));
    if (o.max != null && n > o.max) return fail(t("Must be at most {n}", { n: o.max }));
    return n;
  };
  const money = (raw: string, key: string, strict = true, fallback = 0): number | null => {
    const c = unitsToCents(raw);
    if (c == null) return null;
    if (Number.isNaN(c)) {
      if (strict) errors[key] = t("Enter an amount, e.g. 100 or 12.50");
      return fallback;
    }
    if (c > 1_000_000_000) {
      if (strict) errors[key] = t("Amount is too large");
      return fallback;
    }
    return c;
  };
  const time = (raw: string, key: string, required = false, strict = true): string | null => {
    const v = localInputToIso(raw);
    if (v === "invalid") {
      if (strict) errors[key] = t("Enter a valid date and time");
      return null;
    }
    if (v == null && required && strict) errors[key] = t("Required");
    return v;
  };

  const name = f.name.trim();
  if (!name) errors.name = t("Required");
  else if (name.length > 160) errors.name = t("At most {n} characters", { n: 160 });
  const description = f.description.trim() || null;
  if (description && description.length > 4000) errors.description = t("At most {n} characters", { n: 4000 });

  const startingStack = int(f.startingStack, "startingStack", { min: 1, max: 100_000_000, required: true });
  const tableSize = int(f.tableSize, "tableSize", { min: 2, max: 11, required: true });
  const maxPlayers = int(f.maxPlayers, "maxPlayers", { min: 2, max: 5000 });
  const expectedPlayers = int(f.expectedPlayers, "expectedPlayers", { min: 0, max: 5000 });

  let buyIn: Money | null = null;
  const amount = money(f.buyInAmount, "buyInAmount");
  const fee = money(f.buyInFee, "buyInFee");
  if (amount != null || fee != null) {
    const currency = f.currency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) errors.currency = t("Three-letter currency code, e.g. EUR");
    buyIn = { amount: amount ?? 0, fee: fee ?? 0, currency };
  }

  const lr = f.lateReg;
  const lateRegistrationPolicy: LateRegistrationPolicy = {
    enabled: lr.enabled,
    closeMode: lr.closeMode,
    untilLevel: int(lr.untilLevel, "lateReg.untilLevel", { min: 1, max: 200, required: lr.enabled && lr.closeMode === "LEVEL" }, lr.enabled),
    untilTime: time(lr.untilTime, "lateReg.untilTime", lr.enabled && lr.closeMode === "TIME", lr.enabled),
  };

  const re = f.reentry;
  const reentryPolicy: ReentryPolicy = {
    enabled: re.enabled,
    maxReentries: int(re.maxReentries, "reentry.maxReentries", { min: 0, max: 100 }, re.enabled),
    closeMode: re.closeMode,
    untilLevel: int(re.untilLevel, "reentry.untilLevel", { min: 1, max: 200, required: re.enabled && re.closeMode === "LEVEL" }, re.enabled),
  };

  const rb = f.rebuy;
  const rebuyPolicy: RebuyPolicy = {
    enabled: rb.enabled,
    maxRebuys: int(rb.maxRebuys, "rebuy.maxRebuys", { min: 0, max: 100 }, rb.enabled),
    untilLevel: int(rb.untilLevel, "rebuy.untilLevel", { min: 1, max: 200 }, rb.enabled),
    stackThreshold: int(rb.stackThreshold, "rebuy.stackThreshold", { min: 0 }, rb.enabled),
    chips: int(rb.chips, "rebuy.chips", { min: 1, max: 100_000_000, required: true }, rb.enabled, DEFAULT_REBUY.chips) ?? DEFAULT_REBUY.chips,
    amount: money(rb.amount, "rebuy.amount", rb.enabled) ?? 0,
  };

  const ad = f.addon;
  const addonPolicy: AddonPolicy = {
    enabled: ad.enabled,
    afterLevel: int(ad.afterLevel, "addon.afterLevel", { min: 1, max: 200 }, ad.enabled),
    maxAddons: int(ad.maxAddons, "addon.maxAddons", { min: 1, max: 10, required: true }, ad.enabled, DEFAULT_ADDON.maxAddons) ?? DEFAULT_ADDON.maxAddons,
    chips: int(ad.chips, "addon.chips", { min: 1, max: 100_000_000, required: true }, ad.enabled, DEFAULT_ADDON.chips) ?? DEFAULT_ADDON.chips,
    amount: money(ad.amount, "addon.amount", ad.enabled) ?? 0,
  };

  const bountyPolicy: BountyPolicy = {
    enabled: f.bounty.enabled,
    amount: money(f.bounty.amount, "bounty.amount", f.bounty.enabled) ?? 0,
    progressive: f.bounty.progressive,
  };

  const value: ConfigPayload = {
    name,
    description,
    gameType: f.gameType,
    format: f.format,
    startingStack,
    tableSize,
    maxPlayers,
    expectedPlayers,
    buyIn,
    lateRegistrationPolicy,
    reentryPolicy,
    rebuyPolicy,
    addonPolicy,
    bountyPolicy,
    houseRulesProfileId: f.houseRulesProfileId || null,
  };

  if (mode === "edit") {
    if (f.structureId) value.structureId = f.structureId;
  } else {
    if (!f.structureId) errors.structureId = t("Choose a blind structure");
    value.structureId = f.structureId || undefined;
  }

  if (mode === "template") {
    value.displayTemplateId = f.displayTemplateId || null;
    return { value, errors };
  }

  // Tournaments (create / edit)
  const startAt = time(f.startAt, "startAt", true);
  const registrationOpenAt = time(f.registrationOpenAt, "registrationOpenAt");
  const registrationCloseAt = time(f.registrationCloseAt, "registrationCloseAt");
  if (registrationOpenAt && registrationCloseAt && registrationCloseAt <= registrationOpenAt) errors.registrationCloseAt = t("Must be after registration opens");
  value.startAt = startAt ?? undefined;
  value.registrationOpenAt = registrationOpenAt;
  value.registrationCloseAt = registrationCloseAt;
  value.publicVisibility = f.publicVisibility;
  value.seasonId = f.seasonId || null;
  value.seriesId = f.seriesId || null;

  if (mode === "create") {
    if (!f.venueId) errors.venueId = t("Choose a venue");
    value.venueId = f.venueId || undefined;
    value.templateId = f.templateId || null;
  } else {
    const slug = f.slug.trim();
    if (!SLUG_RE.test(slug) || slug.length < 2 || slug.length > 64) errors.slug = t("2–64 lowercase letters, digits and dashes");
    value.slug = slug;
  }
  return { value, errors };
}

/** First error message, for a summary alert. */
export const firstError = (errors: FormErrors) => Object.values(errors)[0] ?? null;
