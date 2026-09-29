// Spec §91 (local network operation) and §94 (realtime delivery): several
// devices on the venue LAN operate one tournament through the edge server.

import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { topic } from "@pcos/types";
import { ADMIN, ApiClient, EdgeStack, WsClient, pickMove, setupVenue, snapshot, sleep, tournamentReady, waitFor } from "./src/harness.js";

const stack = new EdgeStack();
let td: ApiClient;
let floor: ApiClient;
let ids: { venueId: string; structureId: string };
let tournamentId: string;
const sockets: WsClient[] = [];

beforeAll(async () => {
  await stack.start(inject("pgBaseUrl"));
  ({ td, ...ids } = await setupVenue(stack));
  await td.post("/api/v1/staff", { email: "floor@e2e.example", displayName: "Floor Two", password: ADMIN.password, roles: ["FLOOR_MANAGER"], venueIds: null });
  floor = new ApiClient(stack.url);
  await floor.login("floor@e2e.example", ADMIN.password);
  ({ tournamentId } = await tournamentReady(td, ids, 18));
  await td.commandOk(tournamentId, "START_TOURNAMENT");
});

afterAll(async () => {
  sockets.forEach((s) => s.close());
  await stack.stop();
});

async function connect(opts: Parameters<typeof WsClient.connect>[1] = {}) {
  const ws = await WsClient.connect(stack.wsUrl, opts);
  sockets.push(ws);
  return ws;
}

describe("local operation (§91)", () => {
  it("serves the whole tournament from the edge server alone", async () => {
    const s = await snapshot(td, tournamentId);
    expect(s.tournament.status).toBe("RUNNING");
    expect(s.clock.status).toBe("RUNNING");
    expect(s.entries.filter((e) => e.status === "ACTIVE")).toHaveLength(18);
    expect(s.entries.every((e) => e.tableId && e.seatNumber)).toBe(true);
    // No request left the building: no probe target is even needed for this.
    expect(stack.telegram.calls).toHaveLength(0);
  });

  it("rejects state changes without the CSRF token", async () => {
    const naked = new ApiClient(stack.url);
    naked.cookie = td.cookie; // stolen cookie, no token
    const r = await naked.call<{ error: { code: string } }>("POST", `/api/v1/tournaments/${tournamentId}/commands`, {
      type: "PAUSE_CLOCK",
      payload: {},
      expectedVersion: 0,
      clientOperationId: crypto.randomUUID(),
    });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe("CSRF_REJECTED");
  });

  it("lets two floor managers work in parallel on different players (rebase)", async () => {
    const s = await snapshot(td, tournamentId);
    const [a, b] = s.entries.filter((e) => e.status === "ACTIVE");
    const v = s.tournament.version;
    const [r1, r2] = await Promise.all([
      td.command(tournamentId, "ELIMINATE_PLAYERS", { entryIds: [a!.id] }, { expectedVersion: v }),
      floor.command(tournamentId, "ELIMINATE_PLAYERS", { entryIds: [b!.id] }, { expectedVersion: v }),
    ]);
    expect([r1.status, r2.status]).toEqual([200, 200]);
    const after = await snapshot(td, tournamentId);
    expect(after.entries.filter((e) => e.status === "ELIMINATED").map((e) => e.id).sort()).toEqual([a!.id, b!.id].sort());
    // Finish positions are unique even though both commands raced.
    const positions = after.entries.filter((e) => e.finishPosition != null).map((e) => e.finishPosition);
    expect(new Set(positions).size).toBe(positions.length);
  });

  it("rejects the second of two conflicting edits of the same player", async () => {
    const s = await snapshot(td, tournamentId);
    const target = s.entries.find((e) => e.status === "ACTIVE")!;
    const v = s.tournament.version;
    const results = await Promise.all([
      td.command(tournamentId, "ELIMINATE_PLAYERS", { entryIds: [target.id] }, { expectedVersion: v }),
      floor.command(tournamentId, "ELIMINATE_PLAYERS", { entryIds: [target.id] }, { expectedVersion: v }),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409]);
    const rejected = results.find((r) => r.status === 409)!;
    expect(rejected.body.error?.code).toBe("VERSION_CONFLICT");
    expect(rejected.body.error?.currentVersion).toBeGreaterThan(v);
  });

  it("never seats two players in the same seat", async () => {
    // Free a seat first so the test does not depend on earlier eliminations.
    const before = await snapshot(td, tournamentId);
    await td.commandOk(tournamentId, "ELIMINATE_PLAYERS", { entryIds: [before.entries.find((e) => e.status === "ACTIVE")!.id] });
    const s = await snapshot(td, tournamentId);
    const move = pickMove(s);
    const other = s.entries.find((e) => e.status === "ACTIVE" && e.id !== move.entry.id && e.tableId && e.tableId !== move.toTableId)!;
    const v = s.tournament.version;
    const results = await Promise.all([
      td.command(tournamentId, "MOVE_PLAYER", { entryId: move.entry.id, fromTableId: move.entry.tableId, fromSeatNumber: move.entry.seatNumber, toTableId: move.toTableId, toSeatNumber: move.toSeatNumber }, { expectedVersion: v }),
      floor.command(tournamentId, "MOVE_PLAYER", { entryId: other.id, fromTableId: other.tableId, fromSeatNumber: other.seatNumber, toTableId: move.toTableId, toSeatNumber: move.toSeatNumber }, { expectedVersion: v }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const after = await snapshot(td, tournamentId);
    const seat = after.tables.find((t) => t.id === move.toTableId)!.seats.find((x) => x.seatNumber === move.toSeatNumber)!;
    expect(seat.entryId).not.toBeNull();
    const seated = after.entries.filter((e) => e.tableId === move.toTableId && e.seatNumber === move.toSeatNumber);
    expect(seated).toHaveLength(1);
  });

  it("applies a retried command exactly once (idempotency)", async () => {
    const s = await snapshot(td, tournamentId);
    const target = s.entries.find((e) => e.status === "ACTIVE")!;
    const opId = crypto.randomUUID();
    const send = () => td.command(tournamentId, "CHIP_ADJUSTMENT", { entryId: target.id, chips: 1000, reason: "count correction" }, { expectedVersion: s.tournament.version, clientOperationId: opId });
    const [a, b] = await Promise.all([send(), send()]);
    const c = await send();
    expect([a.status, b.status, c.status]).toEqual([200, 200, 200]);
    expect(new Set([a.body.actionId, b.body.actionId, c.body.actionId]).size).toBe(1);
    const after = await snapshot(td, tournamentId);
    expect(after.entries.find((e) => e.id === target.id)!.chips).toBe(target.chips + 1000);
    // Same key, different request: refused instead of silently replayed.
    const mismatch = await td.command(tournamentId, "CHIP_ADJUSTMENT", { entryId: target.id, chips: 5000, reason: "count correction" }, { expectedVersion: after.tournament.version, clientOperationId: opId });
    expect(mismatch.status).toBe(409);
    expect(mismatch.body.error?.code).toBe("IDEMPOTENCY_MISMATCH");
  });

  it("undoes an elimination and restores the seat", async () => {
    const s = await snapshot(td, tournamentId);
    const target = s.entries.find((e) => e.status === "ACTIVE")!;
    const bust = await td.commandOk(tournamentId, "ELIMINATE_PLAYERS", { entryIds: [target.id] });
    expect((await snapshot(td, tournamentId)).entries.find((e) => e.id === target.id)!.status).toBe("ELIMINATED");
    await td.commandOk(tournamentId, "UNDO_ACTION", { actionId: bust.actionId, reason: "wrong player reported" });
    const after = await snapshot(td, tournamentId);
    const restored = after.entries.find((e) => e.id === target.id)!;
    expect(restored.status).toBe("ACTIVE");
    expect([restored.tableId, restored.seatNumber]).toEqual([target.tableId, target.seatNumber]);
  });

  it("refuses commands from anonymous devices", async () => {
    const anon = new ApiClient(stack.url);
    const r = await anon.call("POST", `/api/v1/tournaments/${tournamentId}/commands`, { type: "PAUSE_CLOCK", payload: {}, expectedVersion: 0, clientOperationId: crypto.randomUUID() });
    expect(r.status).toBe(401);
  });
});

describe("realtime delivery (§94)", () => {
  let staffWs: WsClient;
  let publicWs: WsClient;
  let displayWs: WsClient;

  beforeAll(async () => {
    const display = await td.post<{ token: string }>("/api/v1/display-tokens", { name: "TV hall", kind: "DISPLAY", venueId: ids.venueId });
    staffWs = await connect({ cookie: td.cookie });
    publicWs = await connect();
    displayWs = await connect({ query: `display=${display.token}` });
    expect(staffWs.welcome?.principal).toBe("staff");
    expect(publicWs.welcome?.principal).toBe("anonymous");
    expect(displayWs.welcome?.principal).toBe("display");
    for (const ws of [staffWs, publicWs, displayWs]) await ws.subscribe(topic.tournament(tournamentId));
  });

  it("authorizes each subscription", async () => {
    const me = await td.get<{ organization: { id: string } }>("/api/v1/auth/me");
    // Anonymous screens only get public tournament feeds.
    await expect(publicWs.subscribe(topic.venue(ids.venueId))).rejects.toThrow(/rejected/);
    await expect(publicWs.subscribe(topic.organization(me.organization.id))).rejects.toThrow(/rejected/);
    // A TV display follows its own venue (current tournament switching) but not the organization.
    await expect(displayWs.subscribe(topic.venue(ids.venueId))).resolves.toBeUndefined();
    await expect(displayWs.subscribe(topic.organization(me.organization.id))).rejects.toThrow(/rejected/);
    // Staff get the organization feed.
    await expect(staffWs.subscribe(topic.organization(me.organization.id))).resolves.toBeUndefined();
  });

  it("rejects cookie-authenticated sockets from a foreign origin (CSWSH)", async () => {
    await expect(WsClient.connect(stack.wsUrl, { cookie: td.cookie, origin: "http://evil.example" })).rejects.toThrow(/403/);
  });

  it("pushes every committed change to every device quickly and in order", async () => {
    const latencies: number[] = [];
    for (let i = 0; i < 15; i++) {
      const marks = [staffWs, publicWs, displayWs].map((ws) => ws.events.length);
      const t0 = performance.now();
      const res = await td.commandOk(tournamentId, i % 2 === 0 ? "PAUSE_CLOCK" : "RESUME_CLOCK");
      const clients = [staffWs, publicWs, displayWs];
      await Promise.all(
        clients.map(async (ws, k) => {
          await ws.waitForEvent((e) => e.name === "clock.updated" && e.tournamentVersion === res.tournamentVersion, `clock event v${res.tournamentVersion}`, marks[k]);
          latencies.push(performance.now() - t0);
        }),
      );
    }
    latencies.sort((a, b) => a - b);
    const p95 = latencies[Math.floor(latencies.length * 0.95)]!;
    expect(p95).toBeLessThan(1000);
    for (const ws of [staffWs, publicWs, displayWs]) {
      const versions = ws.events.filter((e) => e.tournamentVersion != null).map((e) => e.tournamentVersion!);
      expect(versions).toEqual([...versions].sort((a, b) => a - b));
    }
  });

  it("keeps staff-only details away from public screens", async () => {
    const marks = [staffWs.events.length, publicWs.events.length];
    const s = await snapshot(td, tournamentId);
    const target = s.entries.find((e) => e.status === "ACTIVE")!;
    const res = await td.commandOk(tournamentId, "CHIP_ADJUSTMENT", { entryId: target.id, chips: -500, reason: "color up" });
    await staffWs.waitForEvent((e) => e.tournamentVersion === res.tournamentVersion, "staff event", marks[0]);
    await sleep(300);
    const leaked = publicWs.events.slice(marks[1]).filter((e) => JSON.stringify(e.data).includes("color up"));
    expect(leaked).toHaveLength(0);
  });

  it("lets a reconnecting device resynchronise from the snapshot", async () => {
    publicWs.close();
    const res = await td.commandOk(tournamentId, "ADJUST_CLOCK", { deltaSeconds: 30 });
    const again = await connect();
    await again.subscribe(topic.tournament(tournamentId));
    const live = await waitFor(
      () => fetch(`${stack.url}/api/v1/public/tournaments/${tournamentId}/live`).then((r) => r.json() as Promise<{ tournament: { version: number } }>),
      "public live snapshot",
    );
    expect(live.tournament.version).toBeGreaterThanOrEqual(res.tournamentVersion);
  });
});
