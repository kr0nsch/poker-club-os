import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { and, eq } from "drizzle-orm";
import {
  auditLogs,
  outboxEvents,
  seatMovements,
  tournamentEntries,
  tournamentRegistrations,
  tournamentResults,
  tournamentSeatAssignments,
  tournaments,
} from "@pcos/db";
import { analyzeBalance, planTableBreak, recommendBalanceMoves, createSeededRng } from "@pcos/domain";
import { TournamentCommandExecutor, HANDLERS, REALTIME_CHANNEL, loadSeatingState, AppError } from "../src/index.js";
import { cmd, seedOrg, seedTournament, staffActor, testDb } from "./helpers.js";

let h: Awaited<ReturnType<typeof testDb>>;
let clockNow = Date.UTC(2026, 8, 27, 18, 0, 0);
let exec: TournamentCommandExecutor;

beforeAll(async () => {
  h = await testDb();
  exec = new TournamentCommandExecutor({ db: h.db, edgeNodeId: "edge-test", now: () => new Date(clockNow) }, HANDLERS);
});
afterAll(async () => {
  await h.drop();
});

async function version(tid: string) {
  const [t] = await h.db.select({ v: tournaments.version }).from(tournaments).where(eq(tournaments.id, tid));
  return t!.v;
}

async function run(tid: string, actor: ReturnType<typeof staffActor>, type: Parameters<typeof cmd>[0], payload: Record<string, unknown> = {}, expected?: number) {
  return exec.execute(tid, cmd(type, payload, expected ?? (await version(tid))), actor);
}

describe("live tournament engine (integration, real PostgreSQL)", () => {
  it("runs a full lifecycle: register → check-in → seat draw → start → eliminate → undo → balance → break → finish → finalize", async () => {
    const base = await seedOrg(h.db, { players: 20 });
    const t = await seedTournament(h.db, base);
    const td = staffActor(base.org.id);

    await run(t.id, td, "PUBLISH");
    await run(t.id, td, "OPEN_REGISTRATION");
    const regs: string[] = [];
    for (const p of base.players) {
      const r = await run(t.id, td, "REGISTER_PLAYER", { playerId: p.id });
      regs.push((r.result as { registrationId: string }).registrationId);
    }
    for (const reg of regs) await run(t.id, td, "CHECK_IN", { registrationId: reg });

    const seating = await run(t.id, td, "START_SEATING", { draw: true });
    expect(seating.result).toMatchObject({ seated: 20, tablesCreated: 3 });
    let state = await loadSeatingState(h.db, t.id);
    expect(state.assignments).toHaveLength(20);
    expect(state.tables.map((x) => state.assignments.filter((a) => a.tableId === x.id).length).sort()).toEqual([6, 7, 7]);

    await run(t.id, td, "START_TOURNAMENT");
    clockNow += 5 * 60_000;
    await run(t.id, td, "PAUSE_CLOCK");
    await run(t.id, td, "RESUME_CLOCK");

    // Eliminate one player; the seat is released and the history is kept.
    const victim = state.assignments[0]!;
    const elim = await run(t.id, td, "ELIMINATE_PLAYERS", { entryIds: [victim.entryId] });
    expect(elim.result).toMatchObject({ remaining: 19 });
    const [e1] = await h.db.select().from(tournamentEntries).where(eq(tournamentEntries.id, victim.entryId));
    expect(e1!.status).toBe("ELIMINATED");

    // Duplicate elimination is rejected.
    await expect(run(t.id, td, "ELIMINATE_PLAYERS", { entryIds: [victim.entryId] })).rejects.toMatchObject({ code: "INVALID_STATE" });

    // Undo via compensating action restores the same seat.
    const undo = await run(t.id, td, "UNDO_ACTION", { actionId: elim.actionId, reason: "wrong player" });
    expect(undo.result).toMatchObject({ type: "ELIMINATE_PLAYERS" });
    const [restored] = await h.db
      .select()
      .from(tournamentSeatAssignments)
      .where(and(eq(tournamentSeatAssignments.entryId, victim.entryId), eq(tournamentSeatAssignments.status, "ACTIVE")));
    expect(restored).toMatchObject({ tableId: victim.tableId, seatNumber: victim.seatNumber });
    await expect(run(t.id, td, "UNDO_ACTION", { actionId: elim.actionId, reason: "again" })).rejects.toMatchObject({ code: "RULE_VIOLATION" });

    // Bust 4 players from one table → imbalance → recommendation → apply.
    state = await loadSeatingState(h.db, t.id);
    const tableA = state.tables[0]!;
    const atA = state.assignments.filter((a) => a.tableId === tableA.id).slice(0, 4);
    await run(t.id, td, "ELIMINATE_PLAYERS", { entryIds: atA.map((a) => a.entryId) });
    state = await loadSeatingState(h.db, t.id);
    expect(analyzeBalance(state.seating, 1).balanced).toBe(false);
    const moves = recommendBalanceMoves(state.seating, { maxImbalance: 1, playerSelection: "RANDOM", rng: createSeededRng(4) });
    expect(moves.length).toBeGreaterThan(0);
    await run(t.id, td, "APPLY_BALANCE", { moves: moves.map(({ reason: _r, explanation: _e, ...m }) => m) });
    state = await loadSeatingState(h.db, t.id);
    expect(analyzeBalance(state.seating, 1).balanced).toBe(true);

    // Break a table: every player moves, table closes, movement history recorded.
    const breaking = state.tables[2]!;
    const plan = planTableBreak(state.seating, breaking.id, createSeededRng(9));
    await run(t.id, td, "BREAK_TABLE", { tableId: breaking.id, moves: plan.map(({ reason: _r, explanation: _e, ...m }) => m) });
    state = await loadSeatingState(h.db, t.id);
    expect(state.tables.find((x) => x.id === breaking.id)!.status).toBe("CLOSED");
    expect(state.assignments.some((a) => a.tableId === breaking.id)).toBe(false);
    const breakMoves = await h.db.select().from(seatMovements).where(and(eq(seatMovements.tournamentId, t.id), eq(seatMovements.reason, "TABLE_BREAK")));
    expect(breakMoves).toHaveLength(plan.length);

    // Eliminate everyone but two, then finish with a heads-up deal order.
    await run(t.id, td, "CLOSE_LATE_REGISTRATION");
    const active = state.assignments.map((a) => a.entryId);
    await run(t.id, td, "ELIMINATE_PLAYERS", { entryIds: active.slice(2) });
    await expect(run(t.id, td, "FINISH_TOURNAMENT")).rejects.toMatchObject({ code: "RULE_VIOLATION" });
    await run(t.id, td, "FINISH_TOURNAMENT", { finalOrder: [active[1], active[0]] });
    const results = await h.db.select().from(tournamentResults).where(eq(tournamentResults.tournamentId, t.id));
    expect(results).toHaveLength(20);
    expect(new Set(results.map((r) => r.position)).size).toBe(20);
    await run(t.id, td, "FINALIZE_RESULTS");
    const [final] = await h.db.select().from(tournaments).where(eq(tournaments.id, t.id));
    expect(final!.status).toBe("FINALIZED");

    // Audit + outbox contain the whole story.
    const audits = await h.db.select().from(auditLogs).where(eq(auditLogs.tournamentId, t.id));
    expect(audits.some((a) => a.action === "UNDO")).toBe(true);
    const events = await h.db.select().from(outboxEvents).where(eq(outboxEvents.aggregateId, t.id));
    expect(events.some((e) => e.eventType === "clock.updated")).toBe(true);
  });

  it("is idempotent per clientOperationId (spec §65)", async () => {
    const base = await seedOrg(h.db, { players: 2 });
    const t = await seedTournament(h.db, base, { status: "REGISTRATION_OPEN", published: true });
    const td = staffActor(base.org.id);
    const c = cmd("REGISTER_PLAYER", { playerId: base.players[0]!.id }, await version(t.id));
    const first = await exec.execute(t.id, c, td);
    const again = await exec.execute(t.id, c, td);
    expect(again.duplicate).toBe(true);
    expect(again.actionId).toBe(first.actionId);
    const regs = await h.db.select().from(tournamentRegistrations).where(eq(tournamentRegistrations.tournamentId, t.id));
    expect(regs).toHaveLength(1);
    // Same key, different payload → rejected.
    await expect(exec.execute(t.id, { ...c, payload: { playerId: base.players[1]!.id } }, td)).rejects.toMatchObject({ code: "IDEMPOTENCY_MISMATCH" });
    // Concurrent retries of one operation produce exactly one effect.
    const c2 = cmd("REGISTER_PLAYER", { playerId: base.players[1]!.id }, await version(t.id));
    const results = await Promise.all([exec.execute(t.id, c2, td), exec.execute(t.id, c2, td), exec.execute(t.id, c2, td)]);
    expect(results.filter((r) => !r.duplicate)).toHaveLength(1);
    expect(await h.db.select().from(tournamentRegistrations).where(eq(tournamentRegistrations.tournamentId, t.id))).toHaveLength(2);
  });

  it("detects stale commands from another device (spec §94) but rebases independent ones", async () => {
    const base = await seedOrg(h.db, { players: 6 });
    const t = await seedTournament(h.db, base, { status: "REGISTRATION_OPEN", published: true });
    const td = staffActor(base.org.id);
    for (const p of base.players) {
      const r = await run(t.id, td, "REGISTER_PLAYER", { playerId: p.id });
      await run(t.id, td, "CHECK_IN", { registrationId: (r.result as { registrationId: string }).registrationId });
    }
    await run(t.id, td, "START_TOURNAMENT");
    const state = await loadSeatingState(h.db, t.id);
    const [x, y] = state.assignments;
    const vN = await version(t.id);

    // Device A eliminates X at version N.
    await exec.execute(t.id, cmd("ELIMINATE_PLAYERS", { entryIds: [x!.entryId] }, vN), staffActor(base.org.id));
    // Device B, still at N, tries to move X → conflict.
    const staleMove = exec.execute(
      t.id,
      cmd("MOVE_PLAYER", { entryId: x!.entryId, fromTableId: x!.tableId, fromSeatNumber: x!.seatNumber, toTableId: x!.tableId, toSeatNumber: 9 }, vN),
      staffActor(base.org.id),
    );
    await expect(staleMove).rejects.toBeInstanceOf(AppError);
    await expect(staleMove).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    // Device B eliminating a different player at N does not overwrite anything → accepted.
    const rebased = await exec.execute(t.id, cmd("ELIMINATE_PLAYERS", { entryIds: [y!.entryId] }, vN), staffActor(base.org.id));
    expect(rebased.tournamentVersion).toBe(vN + 2);
    // STRICT commands never rebase.
    await expect(exec.execute(t.id, cmd("APPLY_BALANCE", { moves: [] }, vN), td)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      exec.execute(
        t.id,
        cmd("BREAK_TABLE", { tableId: state.tables[0]!.id, moves: [] }, vN),
        td,
      ),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    // Two TDs pressing pause: second one conflicts instead of toggling back.
    const v2 = await version(t.id);
    await exec.execute(t.id, cmd("PAUSE_CLOCK", {}, v2), td);
    await expect(exec.execute(t.id, cmd("PAUSE_CLOCK", {}, v2), td)).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  });

  it("serializes concurrent commands without lost updates", async () => {
    const base = await seedOrg(h.db, { players: 12 });
    const t = await seedTournament(h.db, base, { status: "REGISTRATION_OPEN", published: true, maxPlayers: 10 });
    const td = staffActor(base.org.id);
    const v = await version(t.id);
    const results = await Promise.all(base.players.map((p) => exec.execute(t.id, cmd("REGISTER_PLAYER", { playerId: p.id }, v), td)));
    const versions = results.map((r) => r.tournamentVersion).sort((a, b) => a - b);
    expect(new Set(versions).size).toBe(12);
    const regs = await h.db.select().from(tournamentRegistrations).where(eq(tournamentRegistrations.tournamentId, t.id));
    expect(regs.filter((r) => r.status === "REGISTERED")).toHaveLength(10);
    expect(regs.filter((r) => r.status === "WAITLISTED")).toHaveLength(2);
  });

  it("rejects level navigation based on a level the clock already left", async () => {
    const base = await seedOrg(h.db, { players: 2 });
    const t = await seedTournament(h.db, base, { status: "REGISTRATION_OPEN", published: true });
    const td = staffActor(base.org.id);
    await run(t.id, td, "START_TOURNAMENT");
    clockNow += 21 * 60_000; // level 1 is over, clock auto-advanced (not yet materialised)
    await expect(run(t.id, td, "NEXT_LEVEL", { fromLevelIndex: 0 })).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    const ok = await run(t.id, td, "NEXT_LEVEL", { fromLevelIndex: 1 });
    expect(ok.result).toMatchObject({ levelIndex: 2 });
    const [row] = await h.db.select().from(tournaments).where(eq(tournaments.id, t.id));
    expect(row!.status).toBe("BREAK");
  });

  it("supports re-entry and closes late registration by level", async () => {
    const base = await seedOrg(h.db, { players: 3 });
    const t = await seedTournament(h.db, base, {
      status: "REGISTRATION_OPEN",
      published: true,
      format: "REENTRY",
      reentryPolicy: { enabled: true, maxReentries: 1, closeMode: "WITH_LATE_REGISTRATION", untilLevel: null },
    });
    const td = staffActor(base.org.id);
    const r = await run(t.id, td, "REGISTER_PLAYER", { playerId: base.players[0]!.id });
    const regId = (r.result as { registrationId: string }).registrationId;
    const ci = await run(t.id, td, "CHECK_IN", { registrationId: regId });
    await run(t.id, td, "REGISTER_PLAYER", { playerId: base.players[1]!.id });
    await run(t.id, td, "START_TOURNAMENT");
    await run(t.id, td, "ELIMINATE_PLAYERS", { entryIds: [(ci.result as { entryId: string }).entryId] });
    const re = await run(t.id, td, "CREATE_ENTRY", { registrationId: regId });
    expect(re.result).toMatchObject({ type: "REENTRY", entryNumber: 2 });
    expect((re.result as { seat: unknown }).seat).not.toBeNull();
    // Dealers have no entry permissions.
    await expect(run(t.id, staffActor(base.org.id, ["DEALER"]), "CREATE_ENTRY", { registrationId: regId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    // Level 3 (after the break following level 2): late registration closed.
    clockNow += 51 * 60_000;
    await expect(run(t.id, td, "REGISTER_PLAYER", { playerId: base.players[2]!.id })).rejects.toMatchObject({ code: "RULE_VIOLATION" });
  });

  it("isolates tenants", async () => {
    const a = await seedOrg(h.db, { players: 1 });
    const b = await seedOrg(h.db, { players: 1 });
    const t = await seedTournament(h.db, a, { status: "REGISTRATION_OPEN", published: true });
    await expect(run(t.id, staffActor(b.org.id), "REGISTER_PLAYER", { playerId: b.players[0]!.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Player of another organization cannot be registered into this tournament.
    await expect(run(t.id, staffActor(a.org.id), "REGISTER_PLAYER", { playerId: b.players[0]!.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("broadcasts through pg_notify only after commit", async () => {
    const base = await seedOrg(h.db, { players: 1 });
    const t = await seedTournament(h.db, base, { status: "REGISTRATION_OPEN", published: true });
    const listener = new pg.Client({ connectionString: h.url });
    await listener.connect();
    const received: string[] = [];
    listener.on("notification", (n) => received.push(JSON.parse(n.payload!).name));
    await listener.query(`listen ${REALTIME_CHANNEL}`);
    // A failing command (unknown player) must not broadcast anything.
    await expect(run(t.id, staffActor(base.org.id), "REGISTER_PLAYER", { playerId: "00000000-0000-4000-8000-000000000000" })).rejects.toBeTruthy();
    await run(t.id, staffActor(base.org.id), "REGISTER_PLAYER", { playerId: base.players[0]!.id });
    await new Promise((r) => setTimeout(r, 200));
    await listener.end();
    expect(received).toContain("registration.created");
    expect(received).toContain("tournament.updated");
    expect(received.filter((n) => n === "registration.created")).toHaveLength(1);
  });

  it("auto-advances the clock and survives restart-style re-derivation", async () => {
    const base = await seedOrg(h.db, { players: 1 });
    const t = await seedTournament(h.db, base, { status: "REGISTRATION_OPEN", published: true });
    await run(t.id, staffActor(base.org.id), "START_TOURNAMENT");
    expect(await exec.autoAdvance(t.id)).toBe(false);
    clockNow += 41 * 60_000;
    expect(await exec.autoAdvance(t.id)).toBe(true);
    const [row] = await h.db.select().from(tournaments).where(eq(tournaments.id, t.id));
    expect(row!.status).toBe("BREAK");
    expect(await exec.autoAdvance(t.id)).toBe(false);
  });
});
