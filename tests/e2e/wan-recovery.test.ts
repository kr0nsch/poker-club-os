// Spec §92: the Internet goes down in the middle of a live tournament. The
// floor keeps working on the LAN; external deliveries wait; when the WAN comes
// back, still-relevant notifications go out exactly once, stale ones never do,
// and the cloud receives every event.

import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { EdgeStatusPayload } from "@pcos/types";
import { ApiClient, EdgeStack, WsClient, enableTelegram, linkedPlayer, setupVenue, sleep, snapshot, tgCallback, tournamentReady, waitFor } from "./src/harness.js";

const PLAYER_TG = 7001;
const STAFF_CHAT = 9001;

const stack = new EdgeStack({ telegram: true, cloud: true });
let td: ApiClient;
let ws: WsClient;
let tournamentId: string;
let playerId: string;

interface NotificationRow {
  type: string;
  status: string;
  attempt_count: number;
}

const telegramNotifications = () =>
  stack.query<NotificationRow>("select type, status, attempt_count from notifications where player_id = $1 and channel = 'TELEGRAM' order by created_at", [playerId]);
const pendingSync = async () => (await stack.query<{ n: number }>("select count(*)::int as n from outbox_events where syncable and sync_status in ('PENDING','FAILED')"))[0]!.n;
const edgeEvent = (online: boolean) => (e: { name: string; data: Record<string, unknown> }) => e.name === "edge.status.updated" && (e.data as unknown as EdgeStatusPayload).wanOnline === online;

beforeAll(async () => {
  await stack.start(inject("pgBaseUrl"));
  const v = await setupVenue(stack);
  td = v.td;
  await enableTelegram(stack, td, { staffAlertsChatId: String(STAFF_CHAT) });
  ({ playerId } = await linkedPlayer(stack, PLAYER_TG, "Wan"));
  ({ tournamentId } = await tournamentReady(td, v, 16));
  await td.commandOk(tournamentId, "START_TOURNAMENT");
  ws = await WsClient.connect(stack.wsUrl, { cookie: td.cookie });
  // Everything that happened so far reached the cloud.
  await waitFor(async () => (await pendingSync()) === 0 && stack.cloud.events.size > 0, "initial cloud sync", 15_000);
});

afterAll(async () => {
  ws?.close();
  await stack.stop();
});

describe("Internet outage during a live tournament (§92)", () => {
  it("detects the outage and tells every device", async () => {
    const mark = ws.events.length;
    await stack.wanDown();
    await ws.waitForEvent(edgeEvent(false), "edge offline event", mark, 5_000);
    const status = await td.get<EdgeStatusPayload>("/api/v1/edge/status");
    expect(status.wanOnline).toBe(false);
    expect(status.status).toBe("DEGRADED");
  });

  it("keeps every floor operation working without the Internet", async () => {
    const timed = async <T>(fn: () => Promise<T>) => {
      const t0 = performance.now();
      const r = await fn();
      expect(performance.now() - t0).toBeLessThan(1500);
      return r;
    };
    const reg = await timed(() => td.commandOk<{ registrationId: string }>(tournamentId, "REGISTER_PLAYER", { playerId }));
    await timed(() => td.commandOk(tournamentId, "CHECK_IN", { registrationId: reg.result.registrationId, createEntry: true, seat: "AUTO" }));
    const s = await snapshot(td, tournamentId);
    const mine = s.entries.find((e) => e.playerId === playerId)!;
    expect(mine.tableId).not.toBeNull();
    const dest = s.tables.find((t) => t.id !== mine.tableId && t.seats.some((x) => !x.entryId))!;
    const seat = dest.seats.find((x) => !x.entryId)!;
    await timed(() =>
      td.commandOk(tournamentId, "MOVE_PLAYER", { entryId: mine.id, fromTableId: mine.tableId, fromSeatNumber: mine.seatNumber, toTableId: dest.id, toSeatNumber: seat.seatNumber, reason: "MANUAL" }),
    );
    await timed(() => td.commandOk(tournamentId, "PAUSE_CLOCK"));
    await timed(() => td.commandOk(tournamentId, "RESUME_CLOCK"));
    const victim = s.entries.find((e) => e.status === "ACTIVE" && e.id !== mine.id)!;
    await timed(() => td.commandOk(tournamentId, "ELIMINATE_PLAYERS", { entryIds: [victim.id] }));
  });

  it("queues external notifications instead of losing or burning them", async () => {
    const rows = await waitFor(async () => {
      const r = await telegramNotifications();
      return r.length >= 3 ? r : null;
    }, "notifications queued");
    expect(rows.map((r) => r.type).sort()).toEqual(["REGISTRATION_CONFIRMED", "SEAT_ASSIGNED", "TABLE_MOVE"]);
    await sleep(1_000); // several dispatcher cycles while offline
    for (const r of await telegramNotifications()) {
      expect(r.status).toBe("PENDING");
      expect(r.attempt_count).toBe(0);
    }
    expect(await pendingSync()).toBeGreaterThan(0);
  });

  it("delivers still-relevant notifications exactly once when the WAN returns, and drops stale ones", async () => {
    // The outage "lasted" longer than a table move stays relevant (5 minutes).
    await stack.query("update notifications set expires_at = now() - interval '1 second' where type = 'TABLE_MOVE' and status = 'PENDING'");
    const sentBefore = stack.telegram.sent.length;
    const mark = ws.events.length;
    await stack.wanUp();
    await ws.waitForEvent(edgeEvent(true), "edge online event", mark, 5_000);

    await waitFor(async () => (await telegramNotifications()).every((r) => r.status !== "PENDING" && r.status !== "SENDING"), "queue drained", 15_000);
    await sleep(1_500); // a few more dispatcher cycles: nothing is sent twice
    const byType = Object.fromEntries((await telegramNotifications()).map((r) => [r.type, r]));
    expect(byType.REGISTRATION_CONFIRMED).toMatchObject({ status: "SENT", attempt_count: 1 });
    expect(byType.SEAT_ASSIGNED).toMatchObject({ status: "SENT", attempt_count: 1 });
    expect(byType.TABLE_MOVE).toMatchObject({ status: "EXPIRED", attempt_count: 0 });

    const toPlayer = stack.telegram.sent.slice(sentBefore).filter((m) => m.chatId === PLAYER_TG);
    expect(toPlayer.filter((m) => m.text.includes("Registration confirmed"))).toHaveLength(1);
    expect(toPlayer.filter((m) => m.text.includes("Your seat"))).toHaveLength(1);
    expect(toPlayer.filter((m) => m.text.includes("Table move"))).toHaveLength(0);

    // Staff are told the Internet is back.
    await waitFor(() => stack.telegram.messagesTo(STAFF_CHAT).find((m) => m.text.includes("Internet restored")), "staff alert");
  });

  it("uploads every event recorded during the outage to the cloud", async () => {
    await waitFor(async () => (await pendingSync()) === 0, "cloud sync caught up", 15_000);
    const ids = await stack.query<{ event_id: string }>("select event_id from outbox_events where syncable");
    for (const { event_id } of ids) expect(stack.cloud.events.has(event_id)).toBe(true);
    const status = await td.get<EdgeStatusPayload>("/api/v1/edge/status");
    expect(status.wanOnline).toBe(true);
    expect(status.cloudSync.pending).toBe(0);
  });

  it("resumes the Telegram bot after the outage", async () => {
    const before = stack.telegram.messagesTo(PLAYER_TG).length;
    stack.telegram.push(tgCallback(PLAYER_TG, "st"));
    const reply = await waitFor(() => stack.telegram.messagesTo(PLAYER_TG)[before], "bot reply after outage", 10_000);
    expect(reply.text).toMatch(/table <b>\d+<\/b>, seat <b>\d+<\/b>/);
  });
});
