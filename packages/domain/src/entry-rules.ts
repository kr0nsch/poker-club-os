// Registration / entry / re-entry / rebuy / add-on rules (spec §47-49).

import type {
  AddonPolicy,
  EntryStatus,
  LateRegistrationPolicy,
  RebuyPolicy,
  ReentryPolicy,
  RegistrationStatus,
  TournamentFormat,
  TournamentStatus,
} from "@pcos/types";
import { ruleViolation } from "./errors.js";
import type { DerivedClock } from "./clock.js";
import { isClosed, isLive, isPreStart } from "./state-machine.js";

export interface LateRegContext {
  status: TournamentStatus;
  policy: LateRegistrationPolicy;
  manuallyClosed: boolean;
  clock: Pick<DerivedClock, "playLevelNumber"> | null;
  now: number;
}

/** Whether new players may still join (registration before start, late registration after). */
export function isLateRegistrationOpen(ctx: LateRegContext): boolean {
  if (isClosed(ctx.status)) return false;
  if (ctx.manuallyClosed) return false;
  if (isPreStart(ctx.status)) return true;
  if (!isLive(ctx.status)) return false;
  const p = ctx.policy;
  if (!p.enabled) return false;
  switch (p.closeMode) {
    case "MANUAL":
      return true;
    case "TIME":
      return p.untilTime ? ctx.now < Date.parse(p.untilTime) : true;
    case "LEVEL":
    default:
      // Open through the end of play level N, including the break that follows it.
      return p.untilLevel == null ? true : (ctx.clock?.playLevelNumber ?? 0) <= p.untilLevel;
  }
}

export interface ReentryContext extends LateRegContext {
  format: TournamentFormat;
  reentryPolicy: ReentryPolicy;
  /** entries of this player in this tournament, oldest first */
  playerEntries: { status: EntryStatus }[];
  registrationStatus: RegistrationStatus;
}

export type EntryDecision = { allowed: true; type: "INITIAL" | "REENTRY" } | { allowed: false; reason: string };

/** Decide whether a new entry (initial or re-entry) may be created for a registration. */
export function decideNewEntry(ctx: ReentryContext): EntryDecision {
  if (ctx.registrationStatus === "CANCELLED" || ctx.registrationStatus === "NO_SHOW") {
    return { allowed: false, reason: `registration is ${ctx.registrationStatus}` };
  }
  if (ctx.registrationStatus === "WAITLISTED" || ctx.registrationStatus === "RESERVED") {
    return { allowed: false, reason: `registration is ${ctx.registrationStatus}; promote/confirm it first` };
  }
  const live = ctx.playerEntries.filter((e) => e.status !== "VOIDED");
  if (live.some((e) => e.status === "ACTIVE")) return { allowed: false, reason: "player already has an active entry" };
  if (!isLateRegistrationOpen(ctx)) return { allowed: false, reason: "registration is closed" };

  if (live.length === 0) return { allowed: true, type: "INITIAL" };

  // Re-entry: previous entries exist and are all eliminated.
  const rp = ctx.reentryPolicy;
  const reentryFormat = ctx.format === "REENTRY" || rp.enabled;
  if (!reentryFormat) return { allowed: false, reason: "re-entry is not permitted in this tournament" };
  const reentriesUsed = live.length - 1;
  if (rp.maxReentries != null && reentriesUsed >= rp.maxReentries) {
    return { allowed: false, reason: `maximum of ${rp.maxReentries} re-entries reached` };
  }
  if (rp.closeMode === "MANUAL" || rp.closeMode === "WITH_LATE_REGISTRATION") return { allowed: true, type: "REENTRY" };
  if (rp.closeMode === "LEVEL" && rp.untilLevel != null && (ctx.clock?.playLevelNumber ?? 0) > rp.untilLevel) {
    return { allowed: false, reason: `re-entry closed after level ${rp.untilLevel}` };
  }
  return { allowed: true, type: "REENTRY" };
}

export interface RebuyContext {
  status: TournamentStatus;
  format: TournamentFormat;
  policy: RebuyPolicy;
  entryStatus: EntryStatus;
  rebuysSoFar: number;
  currentStack: number | null;
  clock: Pick<DerivedClock, "playLevelNumber"> | null;
}

export function assertRebuyAllowed(ctx: RebuyContext): void {
  if (!(ctx.format === "REBUY" || ctx.policy.enabled)) throw ruleViolation("rebuys are not permitted in this tournament");
  if (!isLive(ctx.status)) throw ruleViolation(`rebuys are not possible while the tournament is ${ctx.status}`);
  if (ctx.entryStatus !== "ACTIVE") throw ruleViolation("rebuy requires an active entry (use re-entry for busted players)");
  if (ctx.policy.maxRebuys != null && ctx.rebuysSoFar >= ctx.policy.maxRebuys) {
    throw ruleViolation(`maximum of ${ctx.policy.maxRebuys} rebuys reached`);
  }
  if (ctx.policy.untilLevel != null && (ctx.clock?.playLevelNumber ?? 0) > ctx.policy.untilLevel) {
    throw ruleViolation(`rebuy period ended after level ${ctx.policy.untilLevel}`);
  }
  if (ctx.policy.stackThreshold != null && ctx.currentStack != null && ctx.currentStack > ctx.policy.stackThreshold) {
    throw ruleViolation(`stack must be at most ${ctx.policy.stackThreshold} to rebuy`);
  }
}

export interface AddonContext {
  status: TournamentStatus;
  policy: AddonPolicy;
  entryStatus: EntryStatus;
  addonsSoFar: number;
  clock: Pick<DerivedClock, "playLevelNumber" | "isBreak"> | null;
}

export function assertAddonAllowed(ctx: AddonContext): void {
  if (!ctx.policy.enabled) throw ruleViolation("add-ons are not offered in this tournament");
  if (!isLive(ctx.status)) throw ruleViolation(`add-ons are not possible while the tournament is ${ctx.status}`);
  if (ctx.entryStatus !== "ACTIVE") throw ruleViolation("add-on requires an active entry");
  if (ctx.addonsSoFar >= ctx.policy.maxAddons) throw ruleViolation(`maximum of ${ctx.policy.maxAddons} add-ons reached`);
  if (ctx.policy.afterLevel != null) {
    // Available during play level N and the break that follows it (both report playLevelNumber N).
    if ((ctx.clock?.playLevelNumber ?? 0) !== ctx.policy.afterLevel) {
      throw ruleViolation(`add-on is available at the end of level ${ctx.policy.afterLevel}`);
    }
  }
}

/** Capacity check: registrations that count toward maxPlayers. */
export function hasCapacity(maxPlayers: number | null | undefined, occupying: number): boolean {
  return maxPlayers == null || occupying < maxPlayers;
}
