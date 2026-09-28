import { describe, expect, it } from "vitest";
import { DEFAULT_ADDON, DEFAULT_LATE_REG, DEFAULT_REBUY, DEFAULT_REENTRY, permissionsForRoles } from "@pcos/types";
import {
  assertAddonAllowed,
  assertRebuyAllowed,
  audienceAllows,
  authorizeSubscription,
  decideNewEntry,
  hasCapacity,
  hasPermission,
  isLateRegistrationOpen,
  undoability,
  type Principal,
} from "../src/index.js";

const now = Date.UTC(2026, 8, 27, 20);

describe("late registration", () => {
  const base = { status: "RUNNING" as const, policy: { ...DEFAULT_LATE_REG, untilLevel: 6 }, manuallyClosed: false, now };

  it("is open before start and through the end of level N including the following break", () => {
    expect(isLateRegistrationOpen({ ...base, status: "REGISTRATION_OPEN", clock: null })).toBe(true);
    expect(isLateRegistrationOpen({ ...base, clock: { playLevelNumber: 6 } })).toBe(true);
    expect(isLateRegistrationOpen({ ...base, clock: { playLevelNumber: 7 } })).toBe(false);
  });

  it("can be closed manually or by time", () => {
    expect(isLateRegistrationOpen({ ...base, manuallyClosed: true, clock: { playLevelNumber: 1 } })).toBe(false);
    const byTime = { ...base, policy: { ...DEFAULT_LATE_REG, closeMode: "TIME" as const, untilTime: new Date(now + 1000).toISOString() } };
    expect(isLateRegistrationOpen({ ...byTime, clock: { playLevelNumber: 99 } })).toBe(true);
    expect(isLateRegistrationOpen({ ...byTime, now: now + 2000, clock: { playLevelNumber: 1 } })).toBe(false);
  });

  it("is closed after the tournament finishes", () => {
    expect(isLateRegistrationOpen({ ...base, status: "FINISHED", clock: { playLevelNumber: 1 } })).toBe(false);
  });
});

describe("entry decisions", () => {
  const ctx = {
    status: "RUNNING" as const,
    policy: DEFAULT_LATE_REG,
    manuallyClosed: false,
    now,
    clock: { playLevelNumber: 2 },
    format: "REENTRY" as const,
    reentryPolicy: { ...DEFAULT_REENTRY, enabled: true, maxReentries: 2 },
    registrationStatus: "CHECKED_IN" as const,
  };

  it("allows the initial entry", () => {
    expect(decideNewEntry({ ...ctx, playerEntries: [] })).toEqual({ allowed: true, type: "INITIAL" });
  });

  it("forbids a second active entry", () => {
    expect(decideNewEntry({ ...ctx, playerEntries: [{ status: "ACTIVE" }] }).allowed).toBe(false);
  });

  it("allows re-entry up to the maximum", () => {
    expect(decideNewEntry({ ...ctx, playerEntries: [{ status: "ELIMINATED" }] })).toEqual({ allowed: true, type: "REENTRY" });
    const r = decideNewEntry({ ...ctx, playerEntries: [{ status: "ELIMINATED" }, { status: "ELIMINATED" }, { status: "ELIMINATED" }] });
    expect(r).toEqual({ allowed: false, reason: "maximum of 2 re-entries reached" });
  });

  it("voided entries do not count", () => {
    expect(decideNewEntry({ ...ctx, playerEntries: [{ status: "VOIDED" }] })).toEqual({ allowed: true, type: "INITIAL" });
  });

  it("freezeout forbids re-entry", () => {
    const r = decideNewEntry({ ...ctx, format: "FREEZEOUT", reentryPolicy: DEFAULT_REENTRY, playerEntries: [{ status: "ELIMINATED" }] });
    expect(r.allowed).toBe(false);
  });

  it("re-entry closes with late registration", () => {
    const r = decideNewEntry({ ...ctx, clock: { playLevelNumber: 9 }, playerEntries: [{ status: "ELIMINATED" }] });
    expect(r).toEqual({ allowed: false, reason: "registration is closed" });
  });
});

describe("rebuy and add-on", () => {
  const rebuy = {
    status: "RUNNING" as const,
    format: "REBUY" as const,
    policy: { ...DEFAULT_REBUY, enabled: true, maxRebuys: 2, untilLevel: 4, stackThreshold: 5000 },
    entryStatus: "ACTIVE" as const,
    rebuysSoFar: 0,
    currentStack: 3000,
    clock: { playLevelNumber: 2 },
  };
  it("enforces limits", () => {
    expect(() => assertRebuyAllowed(rebuy)).not.toThrow();
    expect(() => assertRebuyAllowed({ ...rebuy, rebuysSoFar: 2 })).toThrow(/maximum/);
    expect(() => assertRebuyAllowed({ ...rebuy, clock: { playLevelNumber: 5 } })).toThrow(/rebuy period/);
    expect(() => assertRebuyAllowed({ ...rebuy, currentStack: 6000 })).toThrow(/stack/);
    expect(() => assertRebuyAllowed({ ...rebuy, entryStatus: "ELIMINATED" })).toThrow(/active entry/);
  });

  it("add-on only at the configured level/break", () => {
    const addon = { status: "BREAK" as const, policy: { ...DEFAULT_ADDON, enabled: true, afterLevel: 4 }, entryStatus: "ACTIVE" as const, addonsSoFar: 0 };
    expect(() => assertAddonAllowed({ ...addon, clock: { playLevelNumber: 4, isBreak: true } })).not.toThrow();
    expect(() => assertAddonAllowed({ ...addon, clock: { playLevelNumber: 5, isBreak: false } })).toThrow();
    expect(() => assertAddonAllowed({ ...addon, addonsSoFar: 1, clock: { playLevelNumber: 4, isBreak: true } })).toThrow(/maximum/);
  });

  it("capacity", () => {
    expect(hasCapacity(null, 1000)).toBe(true);
    expect(hasCapacity(10, 9)).toBe(true);
    expect(hasCapacity(10, 10)).toBe(false);
  });
});

describe("permissions and subscriptions", () => {
  const staff = (roles: string[], venueIds: string[] | null = null, organizationId = "org1"): Principal => ({
    kind: "staff",
    userId: "u1",
    organizationId,
    roles,
    permissions: permissionsForRoles(roles),
    venueIds,
  });
  const tournament = { kind: "tournament" as const, id: "t1", organizationId: "org1", venueId: "v1", published: true, publicVisibility: "PUBLIC" as const };

  it("maps roles to permissions", () => {
    expect(hasPermission(staff(["DEALER"]), "tournament.clock.control")).toBe(false);
    expect(hasPermission(staff(["TOURNAMENT_DIRECTOR"]), "tournament.clock.control")).toBe(true);
    expect(hasPermission(staff(["CASHIER"]), "entry.rebuy")).toBe(true);
    expect(hasPermission(staff(["READ_ONLY_ANALYST"]), "player.edit")).toBe(false);
  });

  it("isolates tenants and venues", () => {
    expect(authorizeSubscription(staff(["TOURNAMENT_DIRECTOR"], null, "org2"), tournament).allowed).toBe(false);
    expect(authorizeSubscription(staff(["TOURNAMENT_DIRECTOR"], ["v2"]), tournament).allowed).toBe(false);
    expect(authorizeSubscription(staff(["TOURNAMENT_DIRECTOR"], ["v1"]), tournament)).toEqual({ allowed: true, audience: "staff" });
  });

  it("gives public audience to anonymous viewers of public tournaments only", () => {
    expect(authorizeSubscription({ kind: "anonymous" }, tournament)).toEqual({ allowed: true, audience: "public" });
    expect(authorizeSubscription({ kind: "anonymous" }, { ...tournament, published: false }).allowed).toBe(false);
    expect(authorizeSubscription({ kind: "anonymous" }, { ...tournament, kind: "organization" }).allowed).toBe(false);
  });

  it("binds display tokens to their venue/tournament", () => {
    const display: Principal = { kind: "display", organizationId: "org1", venueId: "v1", tournamentId: "t1", displayId: "d1" };
    expect(authorizeSubscription(display, tournament)).toEqual({ allowed: true, audience: "public" });
    expect(authorizeSubscription(display, { ...tournament, id: "t2" }).allowed).toBe(false);
    expect(authorizeSubscription(display, { kind: "display", id: "d2", organizationId: "org1", venueId: "v1" }).allowed).toBe(false);
  });

  it("filters staff-only events for public subscribers", () => {
    expect(audienceAllows("public", "staff")).toBe(false);
    expect(audienceAllows("public", "public")).toBe(true);
    expect(audienceAllows("staff", "staff")).toBe(true);
  });
});

describe("undo", () => {
  it("knows compensations and refuses double undo", () => {
    expect(undoability({ type: "ELIMINATE_PLAYERS", compensatedByActionId: null, compensatesActionId: null })).toEqual({
      undoable: true,
      compensation: "RESTORE_PLAYER",
    });
    expect(undoability({ type: "ELIMINATE_PLAYERS", compensatedByActionId: "x", compensatesActionId: null }).undoable).toBe(false);
    expect(undoability({ type: "FINALIZE_RESULTS", compensatedByActionId: null, compensatesActionId: null }).undoable).toBe(false);
  });
});
