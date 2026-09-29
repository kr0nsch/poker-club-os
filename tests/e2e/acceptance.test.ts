// Spec §103 — final acceptance scenario, end to end:
// Royal Poker Club runs "Sunday Main Event" on its edge server; players register
// through the public web, the venue QR and Telegram; the Internet is unplugged in
// the middle of the tournament and the floor keeps working (clock, TV, dealers,
// registration, seating, eliminations, undo, balancing, table break); when the
// Internet returns, sync resumes, valid notifications are delivered, stale ones
// are dropped; the tournament finishes, results finalize, the league updates,
// Telegram players get their result and the audit trail has everything.

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { topic, type EdgeStatusPayload, type TournamentSnapshot } from "@pcos/types";
import {
  ADMIN,
  ApiClient,
  EdgeStack,
  WsClient,
  createPlayers,
  enableTelegram,
  linkedPlayer,
  setupVenue,
  sleep,
  snapshot,
  tgCallback,
  waitFor,
} from "./src/harness.js";

const TG_EARLY = 9301; // registers through the bot before the outage
const TG_LATE = 9302; // registered at the desk during the outage
const STAFF_CHAT = 9399;

const stack = new EdgeStack({ telegram: true, cloud: true });
let td: ApiClient;
let dealer: ApiClient;
let ids: { venueId: string; structureId: string };
let tid: string;
let seasonId: string;
let tgEarly: Awaited<ReturnType<typeof linkedPlayer>>;
let tgLate: Awaited<ReturnType<typeof linkedPlayer>>;
let staffWs: WsClient;
let tvWs: WsClient;
let dealerWs: WsClient;
let dealerTableId: string;
const TD_DEVICE = randomUUID();
const DEALER_DEVICE = randomUUID();

const active = (s: TournamentSnapshot) => s.entries.filter((e) => e.status === "ACTIVE");
const edgeEvent = (online: boolean) => (e: { name: string; data: Record<string, unknown> }) =>
  e.name === "edge.status.updated" && (e.data as unknown as EdgeStatusPayload).wanOnline === online;
const pendingSync = async () => (await stack.query<{ n: number }>("select count(*)::int as n from outbox_events where syncable and sync_status in ('PENDING','FAILED')"))[0]!.n;
const messages = (chat: number, text: string) => stack.telegram.messagesTo(chat).filter((m) => m.text.includes(text));

async function webPlayer(email: string, firstName: string) {
  const c = new ApiClient(stack.url);
  await c.ok("POST", "/api/v1/auth/signup", { organizationSlug: "royal", email, password: ADMIN.password, firstName, lastName: "Guest", acceptPrivacyPolicy: true });
  return c;
}

beforeAll(async () => {
  await stack.start(inject("pgBaseUrl"));
  ({ td, ...ids } = await setupVenue(stack));
  td.deviceId = TD_DEVICE;
  await enableTelegram(stack, td, { staffAlertsChatId: String(STAFF_CHAT) });
  tgEarly = await linkedPlayer(stack, TG_EARLY, "Early");
  tgLate = await linkedPlayer(stack, TG_LATE, "Late");

  // League season the tournament counts for.
  const [rule] = await td.get<{ id: string }[]>("/api/v1/score-rules");
  const league = await td.post<{ id: string }>("/api/v1/leagues", { name: "Royal League", scoreRuleId: rule!.id, bestResultsCount: 10 });
  const year = new Date().getUTCFullYear();
  seasonId = (await td.post<{ id: string }>(`/api/v1/leagues/${league.id}/seasons`, { name: `Season ${year}`, startsOn: `${year}-01-01`, endsOn: `${year}-12-31` })).id;

  // Dealer tablet (its own account and device).
  await td.post("/api/v1/staff", { email: "dealer@e2e.example", displayName: "Igor Dealer", password: ADMIN.password, roles: ["DEALER"], venueIds: null });
  dealer = new ApiClient(stack.url);
  dealer.deviceId = DEALER_DEVICE;
  await dealer.login("dealer@e2e.example", ADMIN.password);
  await dealer.get("/api/v1/auth/me"); // first authenticated request registers the tablet
});

afterAll(async () => {
  for (const ws of [staffWs, tvWs, dealerWs]) ws?.close();
  await stack.stop();
});

describe("§103 final acceptance scenario", () => {
  it("the TD creates Sunday Main Event and players register through web, QR, Telegram and the desk", async () => {
    const t = await td.post<{ id: string }>("/api/v1/tournaments", {
      name: "Sunday Main Event",
      venueId: ids.venueId,
      structureId: ids.structureId,
      format: "REENTRY",
      startAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      startingStack: 30000,
      tableSize: 9,
      seasonId,
      lateRegistrationPolicy: { enabled: true, closeMode: "LEVEL", untilLevel: 6 },
    });
    tid = t.id;
    await td.commandOk(tid, "PUBLISH");
    await td.commandOk(tid, "OPEN_REGISTRATION");

    const web = await webPlayer("web@e2e.example", "Web");
    await web.post(`/api/v1/public/tournaments/${tid}/register`, { source: "PLAYER_WEB" });
    const qr = await webPlayer("qr@e2e.example", "Qr");
    await qr.post(`/api/v1/public/tournaments/${tid}/register`, { source: "PLAYER_QR" });
    const n = stack.telegram.messagesTo(TG_EARLY).length;
    stack.telegram.push(tgCallback(TG_EARLY, `rg:${tid}`));
    await waitFor(() => stack.telegram.messagesTo(TG_EARLY)[n]?.text.includes("Registered!"), "Telegram registration");
    for (const p of await createPlayers(td, 16, "Desk")) await td.commandOk(tid, "REGISTER_PLAYER", { playerId: p.id });

    const regs = await stack.query<{ source: string; n: number }>("select source, count(*)::int as n from tournament_registrations where tournament_id = $1 group by source", [tid]);
    expect(Object.fromEntries(regs.map((r) => [r.source, r.n]))).toEqual({ PLAYER_WEB: 1, PLAYER_QR: 1, TELEGRAM: 1, STAFF: 16 });
  });

  it("staff check players in, the TD draws seats, the TV receives the seating over the LAN and the tournament starts", async () => {
    const s = await snapshot(td, tid);
    for (const r of s.registrations) await td.commandOk(tid, "CHECK_IN", { registrationId: r.id, createEntry: true, seat: "NONE" });

    const display = await td.post<{ token: string }>("/api/v1/display-tokens", { name: "TV main hall", kind: "DISPLAY", venueId: ids.venueId });
    staffWs = await WsClient.connect(stack.wsUrl, { cookie: td.cookie });
    tvWs = await WsClient.connect(stack.wsUrl, { query: `display=${display.token}` });
    for (const ws of [staffWs, tvWs]) await ws.subscribe(topic.tournament(tid));

    const mark = tvWs.events.length;
    const draw = await td.commandOk<{ seated: number }>(tid, "START_SEATING", { draw: true });
    expect(draw.result.seated).toBe(19);
    await tvWs.waitForEvent((e) => e.tournamentVersion === draw.tournamentVersion, "TV notified of the seat draw", mark);
    const tv = (await (await fetch(`${stack.url}/api/v1/display/${display.token}/state`)).json()) as { snapshot: { seating: unknown[] } };
    expect(tv.snapshot.seating).toHaveLength(19);

    // Dealer tablet is assigned to one table and follows it.
    const after = await snapshot(td, tid);
    dealerTableId = after.tables[0]!.id;
    const devices = await td.get<{ id: string; deviceId: string }[]>("/api/v1/devices");
    const dealerDevice = devices.find((d) => d.deviceId === DEALER_DEVICE)!;
    await td.ok("PATCH", `/api/v1/devices/${dealerDevice.id}`, { assignedTableId: dealerTableId });
    dealerWs = await WsClient.connect(stack.wsUrl, { cookie: dealer.cookie });
    await dealerWs.subscribe(topic.tournament(tid));

    const marks = [staffWs, tvWs, dealerWs].map((ws) => ws.events.length);
    const start = await td.commandOk(tid, "START_TOURNAMENT");
    await Promise.all(
      [staffWs, tvWs, dealerWs].map((ws, i) => ws.waitForEvent((e) => e.name === "clock.updated" && e.tournamentVersion === start.tournamentVersion, "clock started on every device", marks[i])),
    );
    expect((await snapshot(td, tid)).clock.status).toBe("RUNNING");
    await waitFor(async () => (await pendingSync()) === 0 && stack.cloud.events.size > 0, "cloud in sync before the outage", 15_000);
  });

  it("the Internet is unplugged: Telegram and cloud degrade, the edge reports it", async () => {
    const mark = staffWs.events.length;
    await stack.wanDown();
    await staffWs.waitForEvent(edgeEvent(false), "WAN offline broadcast", mark, 5_000);
    const status = await td.get<EdgeStatusPayload>("/api/v1/edge/status");
    expect(status).toMatchObject({ wanOnline: false, status: "DEGRADED" });
  });

  it("clock, TV, TD controls, dealers, registration, seating, eliminations, table moves and undo all keep working", async () => {
    // Clock control.
    await td.commandOk(tid, "PAUSE_CLOCK");
    await td.commandOk(tid, "RESUME_CLOCK");

    // Registration and seating continue: a Telegram-linked player arrives late.
    const reg = await td.commandOk<{ registrationId: string }>(tid, "REGISTER_PLAYER", { playerId: tgLate.playerId });
    await td.commandOk(tid, "CHECK_IN", { registrationId: reg.result.registrationId, createEntry: true, seat: "AUTO" });
    let s = await snapshot(td, tid);
    expect(s.entries.find((e) => e.playerId === tgLate.playerId)?.seatNumber).not.toBeNull();
    expect(await pendingSync()).toBeGreaterThan(0); // queued for the cloud, nothing lost

    // The dealer marks presence and reports a bust at their table.
    const seat = s.tables.find((t) => t.id === dealerTableId)!.seats.find((x) => x.entryId)!;
    await dealer.commandOk(tid, "DEALER_MARK_PRESENT", { tableId: dealerTableId, seatNumber: seat.seatNumber, present: true });
    const bust = await dealer.commandOk<{ requestId: string; entryId: string }>(tid, "DEALER_REPORT_BUST", { tableId: dealerTableId, seatNumber: seat.seatNumber });

    // The TD confirms the elimination: every LAN device updates immediately.
    const marks = [staffWs, tvWs, dealerWs].map((ws) => ws.events.length);
    const t0 = performance.now();
    const elim = await td.commandOk(tid, "ELIMINATE_PLAYERS", { entryIds: [bust.result.entryId] });
    await Promise.all([staffWs, tvWs, dealerWs].map((ws, i) => ws.waitForEvent((e) => e.tournamentVersion === elim.tournamentVersion, "elimination on every device", marks[i], 2_000)));
    expect(performance.now() - t0).toBeLessThan(2_000);
    await td.commandOk(tid, "RESOLVE_FLOOR_REQUEST", { requestId: bust.result.requestId, resolution: "RESOLVED" });

    // The TD eliminates the wrong player by mistake and undoes it.
    s = await snapshot(td, tid);
    const wrong = active(s).find((e) => e.playerId !== tgEarly.playerId && e.playerId !== tgLate.playerId)!;
    const mistake = await td.commandOk(tid, "ELIMINATE_PLAYERS", { entryIds: [wrong.id] });
    await td.commandOk(tid, "UNDO_ACTION", { actionId: mistake.actionId, reason: "wrong player eliminated" });
    s = await snapshot(td, tid);
    const restored = s.entries.find((e) => e.id === wrong.id)!;
    expect(restored).toMatchObject({ status: "ACTIVE", tableId: wrong.tableId, seatNumber: wrong.seatNumber });

    // Busts at one table make the tables uneven; the system proposes moves and the TD accepts.
    const fullest = [...s.tables].sort((a, b) => b.occupied - a.occupied)[0]!;
    const victims = s.entries.filter((e) => e.status === "ACTIVE" && e.tableId === fullest.id && e.playerId !== tgEarly.playerId && e.playerId !== tgLate.playerId).slice(0, 3);
    for (const v of victims) await td.commandOk(tid, "ELIMINATE_PLAYERS", { entryIds: [v.id] });
    const balance = await td.get<{ analysis: { balanced: boolean }; moves: Record<string, unknown>[]; basedOnVersion: number }>(`/api/v1/tournaments/${tid}/balance/preview`);
    expect(balance.analysis.balanced).toBe(false);
    expect(balance.moves.length).toBeGreaterThan(0);
    await td.commandOk(tid, "APPLY_BALANCE", { moves: balance.moves });
    const balanced = await td.get<{ analysis: { balanced: boolean } }>(`/api/v1/tournaments/${tid}/balance/preview`);
    expect(balanced.analysis.balanced).toBe(true);

    // A table breaks (the one where the early Telegram player sits) and its players move.
    s = await snapshot(td, tid);
    const early = s.entries.find((e) => e.playerId === tgEarly.playerId)!;
    const plan = await td.get<{ tableId: string; moves: Record<string, unknown>[] }>(`/api/v1/tournaments/${tid}/break/preview?tableId=${early.tableId}`);
    expect(plan.moves.length).toBeGreaterThan(0);
    await td.commandOk(tid, "BREAK_TABLE", { tableId: plan.tableId, moves: plan.moves });
    s = await snapshot(td, tid);
    expect(s.tables.find((t) => t.id === plan.tableId)?.occupied ?? 0).toBe(0);
    expect(s.entries.find((e) => e.playerId === tgEarly.playerId)!.tableId).not.toBe(early.tableId);
    expect(new Set(active(s).map((e) => `${e.tableId}:${e.seatNumber}`)).size).toBe(active(s).length);
  });

  it("the Internet returns: sync resumes, valid notifications go out once, expired ones are dropped", async () => {
    // Table moves are only useful for a few minutes; this outage "lasted" longer.
    await waitFor(async () => (await stack.query("select 1 from notifications where type = 'TABLE_MOVE' and channel = 'TELEGRAM'")).length > 0, "table move queued");
    await stack.query("update notifications set expires_at = now() - interval '1 second' where type = 'TABLE_MOVE' and status = 'PENDING'");

    const mark = staffWs.events.length;
    await stack.wanUp();
    await staffWs.waitForEvent(edgeEvent(true), "WAN online broadcast", mark, 5_000);
    await waitFor(async () => (await pendingSync()) === 0, "cloud sync caught up", 20_000);
    const synced = await stack.query<{ event_id: string }>("select event_id from outbox_events where syncable");
    expect(synced.every((e) => stack.cloud.events.has(e.event_id))).toBe(true);

    await waitFor(() => messages(TG_LATE, "Registration confirmed").length > 0 && messages(TG_LATE, "Your seat").length > 0, "late player's notifications", 15_000);
    await waitFor(async () => (await stack.query("select 1 from notifications where channel = 'TELEGRAM' and status in ('PENDING','SENDING')")).length === 0, "queue drained", 15_000);
    await sleep(1_000);
    expect(messages(TG_LATE, "Registration confirmed")).toHaveLength(1);
    expect(messages(TG_LATE, "Your seat")).toHaveLength(1);
    expect(messages(TG_EARLY, "Table move")).toHaveLength(0);
    const moves = await stack.query<{ status: string }>("select status from notifications where type = 'TABLE_MOVE' and channel = 'TELEGRAM'");
    expect(moves.every((m) => m.status === "EXPIRED")).toBe(true);
    await waitFor(() => messages(STAFF_CHAT, "Internet restored").length > 0, "staff alert");
  });

  it("the tournament finishes, results finalize, the league recalculates and Telegram players get their result", async () => {
    let s = await snapshot(td, tid);
    // Play down to the winner, keeping both Telegram players in until the end.
    while (active(s).length > 1) {
      const out = active(s).find((e) => e.playerId !== tgEarly.playerId && e.playerId !== tgLate.playerId) ?? active(s).find((e) => e.playerId === tgLate.playerId)!;
      await td.commandOk(tid, "ELIMINATE_PLAYERS", { entryIds: [out.id] });
      s = await snapshot(td, tid);
    }
    await td.commandOk(tid, "FINISH_TOURNAMENT");
    const fin = await td.commandOk<{ status: string; players: number }>(tid, "FINALIZE_RESULTS");
    expect(fin.result.status).toBe("FINALIZED");

    const rows = await td.get<{ playerId: string; position: number; status: string }[]>(`/api/v1/tournaments/${tid}/results`);
    expect(rows).toHaveLength(20);
    expect(rows.every((r) => r.status === "FINALIZED")).toBe(true);
    expect(rows.find((r) => r.playerId === tgEarly.playerId)?.position).toBe(1);
    expect(rows.find((r) => r.playerId === tgLate.playerId)?.position).toBe(2);

    const board = await td.get<{ rows: { playerId: string; points: number }[] }>(`/api/v1/seasons/${seasonId}/leaderboard`);
    expect(board.rows.length).toBeGreaterThan(0);
    expect(board.rows[0]!.playerId).toBe(tgEarly.playerId);
    expect(board.rows[0]!.points).toBeGreaterThan(0);

    await waitFor(() => messages(TG_EARLY, "you finished #1").length > 0 && messages(TG_LATE, "you finished #2").length > 0, "final result on Telegram", 15_000);
  });

  it("the audit trail holds the local operations with device ids, the undo, sync status and Telegram deliveries", async () => {
    const audit = await stack.query<{ action: string; device_id: string | null }>("select action, device_id from audit_logs where tournament_id = $1", [tid]);
    const actions = new Set(audit.map((a) => a.action));
    for (const a of ["START_SEATING", "START_TOURNAMENT", "ELIMINATE_PLAYERS", "UNDO_ACTION", "APPLY_BALANCE", "BREAK_TABLE", "DEALER_REPORT_BUST", "FINALIZE_RESULTS"]) expect(actions).toContain(a);
    expect(audit.some((a) => a.action === "UNDO_ACTION" && a.device_id === TD_DEVICE)).toBe(true);
    expect(audit.some((a) => a.action === "DEALER_REPORT_BUST" && a.device_id === DEALER_DEVICE)).toBe(true);

    const deliveries = await stack.query<{ status: string; n: number }>("select status, count(*)::int as n from telegram_deliveries group by status");
    expect(deliveries.find((d) => d.status === "SENT")?.n ?? 0).toBeGreaterThan(0);
    expect(await pendingSync()).toBe(0);
    const edge = await td.get<EdgeStatusPayload>("/api/v1/edge/status");
    expect(edge).toMatchObject({ wanOnline: true, status: "ONLINE", cloudSync: { pending: 0 } });
  });
});
