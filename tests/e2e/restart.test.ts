// Spec §93: the edge server loses power in the middle of a tournament. After
// the restart the tournament continues from PostgreSQL: same seats and stacks,
// the clock kept counting, retried commands apply once, events queued before
// the crash are still delivered.

import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { topic, type TournamentSnapshot } from "@pcos/types";
import { ApiClient, EdgeStack, WsClient, enableTelegram, linkedPlayer, setupVenue, sleep, snapshot, tournamentReady, waitFor } from "./src/harness.js";

const PLAYER_TG = 8001;
const STAFF_CHAT = 9101;

const stack = new EdgeStack({ telegram: true });
let td: ApiClient;
let tournamentId: string;
let playerId: string;
let before: TournamentSnapshot;

/** The table plan that must survive: entry → table/seat/chips/status. */
const plan = (s: TournamentSnapshot) => s.entries.map((e) => `${e.id}:${e.status}:${e.tableId}:${e.seatNumber}:${e.chips}`).sort();

beforeAll(async () => {
  await stack.start(inject("pgBaseUrl"));
  const v = await setupVenue(stack);
  td = v.td;
  await enableTelegram(stack, td, { staffAlertsChatId: String(STAFF_CHAT) });
  ({ playerId } = await linkedPlayer(stack, PLAYER_TG, "Boot"));
  ({ tournamentId } = await tournamentReady(td, v, 20));
  await td.commandOk(tournamentId, "START_TOURNAMENT");
  const s = await snapshot(td, tournamentId);
  await td.commandOk(tournamentId, "ELIMINATE_PLAYERS", { entryIds: [s.entries[0]!.id] });
});

afterAll(async () => {
  await stack.stop();
});

describe("edge server restart (§93)", () => {
  it("restores the tournament exactly and keeps the clock running across the outage", async () => {
    await td.commandOk(tournamentId, "SET_REMAINING", { remainingSeconds: 3 });
    before = await snapshot(td, tournamentId);
    expect(before.clock.levelIndex).toBe(0);

    await stack.crash(); // power loss: no graceful shutdown
    await sleep(4_000); // the level ends while the server is off
    await stack.startApi();
    await stack.startWorker();

    const after = await waitFor(async () => {
      const s = await snapshot(td, tournamentId);
      return s.clock.levelIndex === 1 ? s : null;
    }, "clock advanced after restart");
    expect(after.clock.status).toBe("RUNNING");
    expect(plan(after)).toEqual(plan(before));
    expect(after.tables.map((t) => t.occupied)).toEqual(before.tables.map((t) => t.occupied));
    expect(after.tournament.version).toBeGreaterThan(before.tournament.version); // the auto-advance was materialised
    // The next level started when the previous one ended (while the server was off), not when it came back.
    const levelEnded = Date.parse(before.serverTime) + 3_000;
    expect(Math.abs(Date.parse(after.clock.startedAt!) - levelEnded)).toBeLessThan(1_500);
  });

  it("keeps the staff session valid (no re-login on every tablet)", async () => {
    const me = await td.get<{ user: { email: string } | null }>("/api/v1/auth/me");
    expect(me.user?.email).toBe("td@e2e.example");
  });

  it("applies a command retried after a crash exactly once", async () => {
    const s = await snapshot(td, tournamentId);
    const target = s.entries.find((e) => e.status === "ACTIVE")!;
    const opId = crypto.randomUUID();
    const payload = { entryId: target.id, chips: 2500, reason: "late chip count" };
    // The response is lost in the crash; the tablet does not know whether it was applied.
    const first = td.command(tournamentId, "CHIP_ADJUSTMENT", payload, { expectedVersion: s.tournament.version, clientOperationId: opId }).catch(() => null);
    await sleep(15);
    await stack.crash();
    await first;
    await stack.startApi();
    await stack.startWorker();
    const retry = await td.command(tournamentId, "CHIP_ADJUSTMENT", payload, { expectedVersion: s.tournament.version, clientOperationId: opId });
    expect(retry.status).toBe(200);
    const again = await td.command(tournamentId, "CHIP_ADJUSTMENT", payload, { expectedVersion: s.tournament.version, clientOperationId: opId });
    expect(again.body.duplicate).toBe(true);
    const after = await snapshot(td, tournamentId);
    expect(after.entries.find((e) => e.id === target.id)!.chips).toBe(target.chips + 2500);
    const actions = await stack.query<{ n: number }>("select count(*)::int as n from operational_actions where client_operation_id = $1", [opId]);
    expect(actions[0]!.n).toBe(1);
  });

  it("delivers events committed while the worker was down", async () => {
    await stack.crash();
    await stack.startApi(); // the API is back first; the worker is still down
    const reg = await td.commandOk<{ registrationId: string }>(tournamentId, "REGISTER_PLAYER", { playerId });
    await td.commandOk(tournamentId, "CHECK_IN", { registrationId: reg.result.registrationId, createEntry: true, seat: "AUTO" });
    await sleep(500);
    expect(stack.telegram.messagesTo(PLAYER_TG).filter((m) => m.text.includes("Your seat"))).toHaveLength(0);

    await stack.startWorker();
    await waitFor(() => stack.telegram.messagesTo(PLAYER_TG).find((m) => m.text.includes("Your seat")), "seat notification after worker restart", 15_000);
    await sleep(1_500);
    expect(stack.telegram.messagesTo(PLAYER_TG).filter((m) => m.text.includes("Your seat"))).toHaveLength(1);
    expect(stack.telegram.messagesTo(PLAYER_TG).filter((m) => m.text.includes("Registration confirmed"))).toHaveLength(1);
  });

  it("returns notifications stuck in SENDING by a crash to the queue", async () => {
    await stack.crash();
    const [org] = await stack.query<{ id: string }>("select id from organizations limit 1");
    await stack.query(
      `insert into notifications (organization_id, channel, type, recipient, payload, status, attempt_count, next_attempt_at, expires_at)
       values ($1, 'TELEGRAM', 'STAFF_ALERT', $2, $3, 'SENDING', 0, now() - interval '5 minutes', now() + interval '1 hour')`,
      [org!.id, String(STAFF_CHAT), JSON.stringify({ severity: "WARNING", title: "Crash test", body: "claimed before the power cut" })],
    );
    await stack.startApi();
    await stack.startWorker();
    await waitFor(() => stack.telegram.messagesTo(STAFF_CHAT).find((m) => m.text.includes("Crash test")), "recovered notification", 15_000);
  });

  it("lets devices reconnect and resubscribe", async () => {
    const ws = await WsClient.connect(stack.wsUrl, { cookie: td.cookie });
    await ws.subscribe(topic.tournament(tournamentId));
    const mark = ws.events.length;
    const res = await td.commandOk(tournamentId, "PAUSE_CLOCK");
    await ws.waitForEvent((e) => e.name === "clock.updated" && e.tournamentVersion === res.tournamentVersion, "event after restart", mark);
    ws.close();
  });
});
