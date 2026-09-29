// Cloud → edge change application (spec §7-8): non-conflicting changes apply,
// diverged ones become recorded conflicts, live tournaments and other clubs
// are never touched by the cloud.

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { players, syncConflicts, tournaments, venueEdgeNodes } from "@pcos/db";
import { createCore, loadConfig, type CloudChange, type Core } from "../src/index.js";
import { seedOrg, seedTournament, staffActor, testDb } from "./helpers.js";

const NODE = "edge-sync-test";
let h: Awaited<ReturnType<typeof testDb>>;
let core: Core;
let base: Awaited<ReturnType<typeof seedOrg>>;
let changes: CloudChange[] = [];

beforeAll(async () => {
  h = await testDb();
  const config = loadConfig({
    DATABASE_URL: h.url,
    SESSION_SECRET: "y".repeat(40),
    NODE_ENV: "test",
    EDGE_NODE_ID: NODE,
    CLOUD_SYNC_ENABLED: "true",
    CLOUD_API_URL: "http://cloud.test",
    CLOUD_SYNC_TOKEN: "t",
  });
  // The cloud gateway: returns whatever the test queued.
  const fakeFetch = (async (url: string | URL) => {
    if (String(url).includes("/v1/edge/changes")) {
      const body = { changes, nextCursor: "c1" };
      changes = [];
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ acked: [] }), { status: 200 });
  }) as typeof fetch;
  core = createCore(config, { handle: h, fetch: fakeFetch });
  base = await seedOrg(h.db, { players: 3 });
  await h.db.insert(venueEdgeNodes).values({ organizationId: base.org.id, venueId: base.venue.id, nodeId: NODE, name: "Edge" });
});
afterAll(async () => {
  await h.drop();
});

const change = (over: Partial<CloudChange>): CloudChange => ({
  entityType: "player",
  entityId: base.players[0]!.id,
  remoteVersion: 1,
  baseVersion: 0,
  originNodeId: "cloud",
  organizationId: base.org.id,
  payload: {},
  ...over,
});

async function pull(...list: CloudChange[]) {
  changes = list;
  return core.sync.pullOnce();
}

describe("cloud → edge sync", () => {
  it("applies a change based on the current edge version", async () => {
    const r = await pull(change({ payload: { nickname: "FromCloud" } }));
    expect(r).toMatchObject({ applied: 1, conflicts: 0 });
    const [p] = await h.db.select().from(players).where(eq(players.id, base.players[0]!.id));
    expect(p!.nickname).toBe("FromCloud");
  });

  it("skips echoes of its own changes", async () => {
    const r = await pull(change({ originNodeId: NODE, payload: { nickname: "Echo" } }));
    expect(r).toMatchObject({ applied: 0, skipped: 1 });
  });

  it("records a conflict instead of overwriting a diverged edge edit", async () => {
    const id = base.players[1]!.id;
    const [before] = await h.db.select().from(players).where(eq(players.id, id));
    // Edited on the floor since the last sync (version 0 → 1), cloud still based on 0.
    await core.players.update(staffActor(base.org.id, ["ORGANIZATION_OWNER"]), id, { nickname: "Local", expectedVersion: before!.version });
    const r = await pull(change({ entityId: id, remoteVersion: 1, baseVersion: 0, payload: { nickname: "Remote" } }));
    expect(r).toMatchObject({ applied: 0, conflicts: 1 });
    const [after] = await h.db.select().from(players).where(eq(players.id, id));
    expect(after!.nickname).toBe("Local");
    const conflicts = await core.sync.conflicts(staffActor(base.org.id, ["ORGANIZATION_OWNER"]));
    const c = conflicts.find((x) => x.entityId === id)!;
    expect(c.reason).toMatch(/diverged/);

    // An administrator accepts the cloud version.
    await core.sync.resolveConflict(staffActor(base.org.id, ["ORGANIZATION_OWNER"]), c.id, { resolution: "ACCEPT_REMOTE" });
    const [resolved] = await h.db.select().from(players).where(eq(players.id, id));
    expect(resolved!.nickname).toBe("Remote");
  });

  it("never lets the cloud change a running tournament", async () => {
    const t = await seedTournament(h.db, base, { status: "RUNNING", name: "Live one" });
    const r = await pull(change({ entityType: "tournament", entityId: t.id, remoteVersion: 5, baseVersion: 0, payload: { name: "Renamed remotely" } }));
    expect(r.conflicts).toBe(1);
    const [row] = await h.db.select().from(tournaments).where(eq(tournaments.id, t.id));
    expect(row!.name).toBe("Live one");
  });

  it("rejects changes for a club this edge does not serve", async () => {
    const other = await seedOrg(h.db, { players: 1 });
    const victim = other.players[0]!;
    const r = await pull(change({ organizationId: other.org.id, entityId: victim.id, payload: { nickname: "Hijack" } }));
    expect(r.conflicts).toBe(1);
    // Same club id claimed, but the entity belongs to another club.
    const r2 = await pull(change({ entityId: victim.id, payload: { nickname: "Hijack" } }));
    expect(r2.conflicts).toBe(1);
    const [p] = await h.db.select().from(players).where(eq(players.id, victim.id));
    expect(p!.nickname).toBeNull();
    const recorded = await h.db.select().from(syncConflicts).where(eq(syncConflicts.entityId, victim.id));
    expect(recorded.every((c) => c.organizationId === base.org.id)).toBe(true);
  });

  it("creates players that only exist in the cloud", async () => {
    const id = randomUUID();
    const r = await pull(change({ entityId: id, remoteVersion: 3, baseVersion: null, payload: { firstName: "Cloud", lastName: "Member", displayName: "Cloud M." } }));
    expect(r.applied).toBe(1);
    const [p] = await h.db.select().from(players).where(eq(players.id, id));
    expect(p).toMatchObject({ organizationId: base.org.id, displayName: "Cloud M.", source: "CLOUD" });
  });
});
