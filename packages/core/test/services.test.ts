// Service-level integration tests on a real PostgreSQL: tenant and venue
// isolation, partial updates, Telegram settings and notification delivery rules.

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { houseRulesProfiles, notifications, playerConsents, players, tournamentRegistrations, tournaments, venues } from "@pcos/db";
import { TDA_2026_STYLE, permissionsForRoles } from "@pcos/types";
import { AppError, NotificationDispatcher, createCore, loadConfig, type Actor, type Core, type NotificationTransport } from "../src/index.js";
import { cmd, seedOrg, seedTournament, staffActor, testDb } from "./helpers.js";

let h: Awaited<ReturnType<typeof testDb>>;
let core: Core;
let clock = Date.UTC(2026, 8, 27, 18, 0, 0);

beforeAll(async () => {
  h = await testDb();
  const config = loadConfig({ DATABASE_URL: h.url, SESSION_SECRET: "x".repeat(40), NODE_ENV: "test", EDGE_NODE_ID: "edge-svc-test" });
  core = createCore(config, { handle: h, now: () => new Date(clock) });
});
afterAll(async () => {
  await h.drop();
});

const owner = (orgId: string) => staffActor(orgId, ["ORGANIZATION_OWNER"]);

function restrictedStaff(organizationId: string, venueIds: string[], roles = ["TOURNAMENT_DIRECTOR"]): Actor {
  return {
    principal: { kind: "staff", userId: randomUUID(), organizationId, roles, permissions: permissionsForRoles(roles), venueIds },
    userId: null,
    deviceId: null,
    ip: null,
    channel: "WEB",
  };
}

async function expectCode(p: Promise<unknown>, code: string) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).code).toBe(code);
}

describe("tenant isolation", () => {
  it("never exposes another club's tournaments, players or venues", async () => {
    const a = await seedOrg(h.db, { players: 2 });
    const b = await seedOrg(h.db, { players: 2 });
    const t = await seedTournament(h.db, a);
    const intruder = owner(b.org.id);
    await expectCode(core.tournaments.get(intruder, t.id), "NOT_FOUND");
    await expectCode(core.tournaments.snapshot(intruder, t.id), "NOT_FOUND");
    await expectCode(core.executor.execute(t.id, cmd("PUBLISH", {}, t.version), intruder), "NOT_FOUND");
    await expectCode(core.players.get(intruder, a.players[0]!.id), "NOT_FOUND");
    expect((await core.org.listVenues(intruder)).map((v) => v.id)).toEqual([b.venue.id]);
    const list = await core.tournaments.list(intruder, {});
    expect(list.find((x) => x.id === t.id)).toBeUndefined();
  });
});

describe("venue restrictions", () => {
  it("limits staff bound to one venue to that venue", async () => {
    const base = await seedOrg(h.db, { players: 1 });
    const [second] = await h.db.insert(venues).values({ organizationId: base.org.id, name: "Second Room", slug: "second" }).returning();
    const floor = restrictedStaff(base.org.id, [base.venue.id]);
    expect((await core.org.listVenues(floor)).map((v) => v.id)).toEqual([base.venue.id]);

    const other = await seedTournament(h.db, { ...base, venue: second! });
    await expectCode(core.tournaments.get(floor, other.id), "FORBIDDEN");
    const listed = await core.tournaments.list(floor, {});
    expect(listed.map((t) => t.id)).not.toContain(other.id);
  });

  it("refuses display links for a venue the staff member cannot manage", async () => {
    const base = await seedOrg(h.db, { players: 1 });
    const [second] = await h.db.insert(venues).values({ organizationId: base.org.id, name: "Second Room", slug: "second" }).returning();
    const manager = restrictedStaff(base.org.id, [base.venue.id]);
    await expectCode(core.displays.createToken(manager, { name: "TV", kind: "DISPLAY", venueId: second!.id }), "FORBIDDEN");
    const ok = await core.displays.createToken(manager, { name: "TV", kind: "DISPLAY", venueId: base.venue.id });
    expect(ok.path).toMatch(/^\/display\//);
    const theirs = await core.displays.createToken(owner(base.org.id), { name: "TV 2", kind: "DISPLAY", venueId: second!.id });
    await expectCode(core.displays.revokeToken(manager, theirs.id), "FORBIDDEN");
    expect((await core.displays.listTokens(manager)).map((x) => x.id)).toEqual([ok.id]);
  });
});

describe("partial updates keep what was not sent", () => {
  it("tournament PATCH changes only the given fields", async () => {
    const base = await seedOrg(h.db, { players: 1 });
    const t = await seedTournament(h.db, base, {
      gameType: "PLO",
      format: "REBUY",
      tableSize: 8,
      rebuyPolicy: { enabled: true, maxRebuys: 3, untilLevel: 4, stackThreshold: null, chips: 20000, amount: 5000 },
    });
    const td = owner(base.org.id);
    const updated = await core.tournaments.update(td, t.id, { description: "Bring your A-game", expectedVersion: t.version });
    expect(updated).toMatchObject({ description: "Bring your A-game", gameType: "PLO", format: "REBUY", tableSize: 8 });
    expect(updated.rebuyPolicy).toMatchObject({ enabled: true, maxRebuys: 3 });
  });

  it("tournament PATCH works while the tournament is running (allowed fields only)", async () => {
    const base = await seedOrg(h.db, { players: 2 });
    const t = await seedTournament(h.db, base);
    const td = owner(base.org.id);
    let v = t.version;
    for (const type of ["PUBLISH", "OPEN_REGISTRATION", "START_SEATING", "START_TOURNAMENT"] as const) {
      v = (await core.executor.execute(t.id, cmd(type, type === "START_SEATING" ? { draw: true } : {}, v), td)).tournamentVersion;
    }
    const renamed = await core.tournaments.update(td, t.id, { name: "Sunday Main Event — Day 1", expectedVersion: v });
    expect(renamed.name).toBe("Sunday Main Event — Day 1");
    await expectCode(core.tournaments.update(td, t.id, { startingStack: 1, expectedVersion: v + 1 }), "INVALID_STATE");
  });

  it("switching the house rules profile replaces the tournament's rules", async () => {
    const base = await seedOrg(h.db, { players: 1 });
    const t = await seedTournament(h.db, base);
    const [profile] = await h.db
      .insert(houseRulesProfiles)
      .values({ organizationId: base.org.id, name: "Short-handed", preset: "CUSTOM", config: { ...TDA_2026_STYLE, maxTableImbalance: 2, finalTableSize: 6 } })
      .returning();
    const td = owner(base.org.id);
    const res = await core.tournaments.update(td, t.id, { houseRulesProfileId: profile!.id, expectedVersion: t.version });
    expect(res.houseRules).toMatchObject({ maxTableImbalance: 2, finalTableSize: 6 });
  });

  it("player PATCH does not withdraw marketing consent", async () => {
    const base = await seedOrg(h.db, { players: 1 });
    const p = base.players[0]!;
    await h.db.update(players).set({ marketingConsent: true }).where(eq(players.id, p.id));
    const res = await core.players.update(owner(base.org.id), p.id, { nickname: "Shark", expectedVersion: p.version });
    expect(res).toMatchObject({ nickname: "Shark", marketingConsent: true });
    const consentRows = await h.db.select().from(playerConsents).where(eq(playerConsents.playerId, p.id));
    expect(consentRows).toHaveLength(0);
  });

  it("venue PATCH keeps the time zone", async () => {
    const base = await seedOrg(h.db, { players: 1 });
    await h.db.update(venues).set({ timezone: "Asia/Yekaterinburg" }).where(eq(venues.id, base.venue.id));
    const v = await core.org.updateVenue(owner(base.org.id), base.venue.id, { name: "Main Hall" });
    expect(v).toMatchObject({ name: "Main Hall", timezone: "Asia/Yekaterinburg" });
  });
});

describe("Telegram settings", () => {
  it("keeps the staff chat unless it is cleared explicitly, and reports the staff-commands flag", async () => {
    const base = await seedOrg(h.db, { players: 1 });
    const admin = owner(base.org.id);
    await core.telegram.saveIntegration(admin, { enabled: false, botUsername: "royal_club_bot", staffAlertsChatId: "-1001234" });
    let s = await core.telegram.saveIntegration(admin, { enabled: false });
    expect(s).toMatchObject({ botUsername: "royal_club_bot", staffAlertsChatId: "-1001234", staffMutationCommandsEnabled: false });
    s = await core.telegram.saveIntegration(admin, { enabled: false, staffAlertsChatId: null });
    expect(s.staffAlertsChatId).toBeNull();
    await core.org.updateOrganization(admin, { featureFlags: { telegramStaffCommands: true } });
    expect((await core.telegram.getIntegration(admin)).staffMutationCommandsEnabled).toBe(true);
  });
});

describe("notification delivery rules (§21, §92)", () => {
  function fakeTransport(results: ("sent" | "network_down")[]) {
    const sent: string[] = [];
    const t: NotificationTransport = {
      channel: "TELEGRAM",
      async send(n) {
        const kind = results.shift() ?? "sent";
        if (kind === "sent") sent.push(n.type);
        return kind === "sent" ? { kind, externalId: sent.length } : { kind, error: "ECONNREFUSED" };
      },
    };
    return { t, sent };
  }

  async function enqueueFor(orgId: string, type: "TABLE_MOVE" | "REGISTRATION_CONFIRMED") {
    await core.org.updateOrganization(owner(orgId), { featureFlags: { telegram: true } });
    await core.notifications.enqueue(core.db, { organizationId: orgId, type, payload: { tournamentName: "Sunday" }, telegramChatId: 555, channels: ["TELEGRAM"], dedupeKey: randomUUID() });
    const [row] = await h.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.organizationId, orgId), eq(notifications.type, type)));
    return row!;
  }

  it("drops a table move that could not be delivered in time", async () => {
    const base = await seedOrg(h.db, { players: 1 });
    const n = await enqueueFor(base.org.id, "TABLE_MOVE");
    const { t, sent } = fakeTransport([]);
    let online = false;
    const d = new NotificationDispatcher(core.deps, new Map([["TELEGRAM", t]]), () => online);
    expect((await d.runOnce()).deferred).toBeGreaterThan(0); // WAN down: kept
    clock += 6 * 60_000; // the outage lasted longer than the move stays relevant
    online = true;
    await d.runOnce();
    const [after] = await h.db.select().from(notifications).where(eq(notifications.id, n.id));
    expect(after!.status).toBe("EXPIRED");
    expect(sent).toEqual([]);
  });

  it("does not burn retry attempts while the network is down", async () => {
    const base = await seedOrg(h.db, { players: 1 });
    const n = await enqueueFor(base.org.id, "REGISTRATION_CONFIRMED");
    const { t, sent } = fakeTransport(["network_down"]);
    const d = new NotificationDispatcher(core.deps, new Map([["TELEGRAM", t]]), () => true);
    await d.runOnce();
    let [row] = await h.db.select().from(notifications).where(eq(notifications.id, n.id));
    expect(row).toMatchObject({ status: "PENDING", attemptCount: 0 });
    clock += 60_000;
    await d.runOnce();
    [row] = await h.db.select().from(notifications).where(eq(notifications.id, n.id));
    expect(row).toMatchObject({ status: "SENT", attemptCount: 1 });
    expect(sent).toEqual(["REGISTRATION_CONFIRMED"]);
  });
});

describe("public registration window", () => {
  it("is closed while scheduled, open during registration and the seat draw", async () => {
    const base = await seedOrg(h.db, { players: 3 });
    const t = await seedTournament(h.db, base);
    const td = owner(base.org.id);
    const run = async (actor: Actor, type: Parameters<typeof cmd>[0], payload: Record<string, unknown> = {}) => {
      const [row] = await h.db.select({ v: tournaments.version }).from(tournaments).where(eq(tournaments.id, t.id));
      return core.executor.execute(t.id, cmd(type, payload, row!.v), actor);
    };
    const open = async () => (await core.tournaments.publicList(base.org.slug)).tournaments.find((x) => x.id === t.id)?.registrationOpen;

    await run(td, "PUBLISH");
    expect(await open()).toBe(false);
    await run(td, "OPEN_REGISTRATION");
    expect(await open()).toBe(true);
    const r = await run(td, "REGISTER_PLAYER", { playerId: base.players[0]!.id });
    await run(td, "CHECK_IN", { registrationId: (r.result as { registrationId: string }).registrationId, seat: "NONE" });
    await run(td, "START_SEATING", { draw: true });
    expect(await open()).toBe(true);

    // A player registering from their phone during the seat draw is accepted.
    const p = base.players[1]!;
    const player: Actor = { principal: { kind: "player", userId: randomUUID(), organizationId: base.org.id, playerId: p.id }, userId: null, deviceId: null, ip: null, channel: "WEB" };
    const self = await run(player, "REGISTER_PLAYER", { playerId: p.id, source: "PLAYER_WEB" });
    expect(self.result).toMatchObject({ status: "REGISTERED" });
  });
});

describe("kiosk", () => {
  it("shows the seat again when a player checks in twice", async () => {
    const base = await seedOrg(h.db, { players: 4 });
    const t = await seedTournament(h.db, base, { buyIn: null });
    const td = owner(base.org.id);
    const run = async (type: Parameters<typeof cmd>[0], payload: Record<string, unknown> = {}) => {
      const [row] = await h.db.select({ v: tournaments.version }).from(tournaments).where(eq(tournaments.id, t.id));
      return core.executor.execute(t.id, cmd(type, payload, row!.v), td);
    };
    await run("PUBLISH");
    await run("OPEN_REGISTRATION");
    for (const p of base.players.slice(0, 3)) {
      const r = await run("REGISTER_PLAYER", { playerId: p.id });
      await run("CHECK_IN", { registrationId: (r.result as { registrationId: string }).registrationId, seat: "NONE" });
    }
    await run("START_SEATING", { draw: true });
    await run("START_TOURNAMENT");
    // Late registration: the fourth player checks in at the kiosk.
    const reg = await run("REGISTER_PLAYER", { playerId: base.players[3]!.id });
    const [row] = await h.db.select().from(tournamentRegistrations).where(eq(tournamentRegistrations.id, (reg.result as { registrationId: string }).registrationId));
    const code = row!.checkInCode!;
    const kiosk = await core.displays.createToken(td, { name: "Kiosk", kind: "KIOSK", venueId: base.venue.id });
    const first = await core.displays.kioskCheckIn(kiosk.token, { method: "QR", code }, null);
    expect(first.seat).not.toBeNull();
    const again = await core.displays.kioskCheckIn(kiosk.token, { method: "QR", code }, null);
    expect(again).toMatchObject({ alreadyCheckedIn: true, seat: first.seat });
  });
});
