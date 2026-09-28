import { describe, expect, it } from "vitest";
import {
  assignEliminationSequence,
  compileFormula,
  computeLeaderboard,
  computeStandings,
  computeStats,
  scorePoints,
  validateScoreRule,
  type StandingEntry,
} from "../src/index.js";

const e = (entryId: string, playerId: string, entryNumber: number, status: StandingEntry["status"], eliminationSeq: number | null = null): StandingEntry => ({
  entryId,
  playerId,
  entryNumber,
  status,
  eliminationSeq,
});

describe("standings", () => {
  it("ranks by last entry: survivor first, then latest bust", () => {
    const entries = [
      e("a1", "A", 1, "ELIMINATED", 1), // A busted first…
      e("a2", "A", 2, "ACTIVE"), // …re-entered and won
      e("b1", "B", 1, "ELIMINATED", 3),
      e("c1", "C", 1, "ELIMINATED", 2),
      e("d1", "D", 1, "VOIDED"),
    ];
    const s = computeStandings(entries, { mode: "FINAL" });
    expect(s.map((x) => [x.playerId, x.position])).toEqual([
      ["A", 1],
      ["B", 2],
      ["C", 3],
    ]);
    expect(s[0]!.entries).toBe(2);
  });

  it("requires a final order when several players remain (deal)", () => {
    const entries = [e("a1", "A", 1, "ACTIVE"), e("b1", "B", 1, "ACTIVE"), e("c1", "C", 1, "ELIMINATED", 1)];
    expect(() => computeStandings(entries, { mode: "FINAL" })).toThrow(/final order/);
    const s = computeStandings(entries, { mode: "FINAL", finalOrder: ["b1", "a1"] });
    expect(s.map((x) => x.playerId)).toEqual(["B", "A", "C"]);
  });

  it("live standings leave survivors unranked", () => {
    const s = computeStandings([e("a1", "A", 1, "ACTIVE"), e("b1", "B", 1, "ACTIVE"), e("c1", "C", 1, "ELIMINATED", 1)]);
    expect(s.find((x) => x.playerId === "C")!.position).toBe(3);
    expect(s.find((x) => x.playerId === "A")!.position).toBeNull();
  });

  it("orders simultaneous eliminations by starting stack", () => {
    const seq = assignEliminationSequence(["big", "small"], 10);
    expect(seq.get("big")).toBe(12);
    expect(seq.get("small")).toBe(11);
  });
});

describe("formula", () => {
  it("evaluates arithmetic with precedence and functions", () => {
    const f = compileFormula("10 * sqrt(entrants) / sqrt(position) + 2^3 - -1", ["entrants", "position"]);
    expect(f.evaluate({ entrants: 100, position: 4 })).toBeCloseTo(10 * 10 / 2 + 8 + 1);
    expect(compileFormula("max(1, min(5, 3)) + round(2.5) + log(8, 2)", []).evaluate({})).toBe(3 + 3 + 3);
  });

  it("rejects unknown identifiers and code injection", () => {
    expect(() => compileFormula("process.exit(1)", ["position"])).toThrow();
    expect(() => compileFormula("foo + 1", ["position"])).toThrow(/unknown variable/);
    expect(() => compileFormula("alert(1)", [])).toThrow(/unknown function/);
    expect(() => compileFormula("1 / (position - position)", ["position"]).evaluate({ position: 1 })).toThrow(/division by zero/);
  });
});

describe("scoring and leaderboard", () => {
  const table = { kind: "POSITION_TABLE" as const, config: { points: [100, 70, 50], otherPositionsPoints: 5, participationPoints: 2, bountyPoints: 3 } };
  const ctx = { position: 1, entrants: 40, players: 35, buyIn: 100, reentries: 0, bounties: 2, entries: 1 };

  it("position table", () => {
    expect(scorePoints(table, ctx)).toBe(100 + 2 + 6);
    expect(scorePoints(table, { ...ctx, position: 9, bounties: 0 })).toBe(7);
  });

  it("formula rule with rounding and minimum", () => {
    const rule = { kind: "FORMULA" as const, config: { expression: "sqrt(entrants * buyIn) / (position + 1)", minPoints: 1, roundTo: 1 } };
    expect(scorePoints(rule, ctx)).toBeCloseTo(31.6, 5);
    expect(scorePoints(rule, { ...ctx, position: 1000 })).toBe(1);
    expect(validateScoreRule({ kind: "FORMULA", config: { expression: "entrants +" } })).toMatch(/unexpected end/);
  });

  it("aggregates with best-N and shared ranks", () => {
    const scores = [
      { playerId: "A", tournamentId: "t1", points: 100, position: 1, finishedAt: 1 },
      { playerId: "A", tournamentId: "t2", points: 5, position: 9, finishedAt: 2 },
      { playerId: "B", tournamentId: "t1", points: 70, position: 2, finishedAt: 1 },
      { playerId: "B", tournamentId: "t2", points: 50, position: 3, finishedAt: 2 },
      { playerId: "C", tournamentId: "t2", points: 100, position: 1, finishedAt: 2 },
    ];
    const all = computeLeaderboard(scores);
    expect(all.map((r) => [r.playerId, r.points, r.rank])).toEqual([
      ["B", 120, 1],
      ["A", 105, 2],
      ["C", 100, 3],
    ]);
    const best1 = computeLeaderboard(scores, 1);
    expect(best1.map((r) => [r.playerId, r.points, r.rank])).toEqual([
      ["C", 100, 1],
      ["A", 100, 2],
      ["B", 70, 3],
    ]);
  });
});

describe("stats", () => {
  it("computes remaining, chips and average", () => {
    const s = computeStats({
      startingStack: 10000,
      registrations: [{ status: "PLAYING" }, { status: "ELIMINATED" }, { status: "WAITLISTED" }, { status: "CANCELLED" }],
      entries: [
        { id: "1", playerId: "A", type: "INITIAL", status: "ACTIVE" },
        { id: "2", playerId: "B", type: "INITIAL", status: "ELIMINATED" },
        { id: "3", playerId: "B", type: "REENTRY", status: "ACTIVE" },
      ],
      transactions: [
        { entryId: "1", type: "BUY_IN", chips: 10000, amount: 100, voided: false },
        { entryId: "2", type: "BUY_IN", chips: 10000, amount: 100, voided: false },
        { entryId: "3", type: "BUY_IN", chips: 10000, amount: 100, voided: false },
        { entryId: "1", type: "REBUY", chips: 10000, amount: 100, voided: true },
      ],
      prizeTracking: { feePerEntry: 10 },
    });
    expect(s.entries).toBe(3);
    expect(s.uniquePlayers).toBe(2);
    expect(s.reentries).toBe(1);
    expect(s.rebuys).toBe(0);
    expect(s.remaining).toBe(2);
    expect(s.totalChips).toBe(30000);
    expect(s.averageStack).toBe(15000);
    expect(s.prizePool).toBe(270);
    expect(s.registrations).toBe(2);
    expect(s.waitlisted).toBe(1);
  });
});
