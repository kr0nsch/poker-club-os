import { describe, expect, it } from "vitest";
import {
  analyzeBalance,
  chooseSeatForNewEntry,
  createCryptoRng,
  createSeededRng,
  nextBigBlindSeat,
  planInitialSeating,
  planTableBreak,
  recommendBalanceMoves,
  recommendTableBreak,
  toWork,
  validatePlan,
  type SeatingTable,
} from "../src/index.js";

const table = (n: number, occupied: number[] = [], opts: Partial<SeatingTable> = {}): SeatingTable => ({
  id: `t${n}`,
  tableNumber: n,
  capacity: 9,
  status: "ACTIVE",
  seats: new Map(occupied.map((s) => [s, `t${n}-s${s}`])),
  lockedSeats: new Set(),
  dealerButtonSeat: null,
  ...opts,
});

const ids = (n: number) => Array.from({ length: n }, (_, i) => `e${i + 1}`);

describe("initial seating", () => {
  it("seats everyone exactly once, balanced across tables, no duplicates", () => {
    const tables = [table(1), table(2), table(3)];
    const plan = planInitialSeating({ tables, entryIds: ids(22), rng: createCryptoRng() });
    expect(plan.additionalTablesNeeded).toBe(0);
    expect(plan.moves).toHaveLength(22);
    expect(new Set(plan.moves.map((m) => m.entryId)).size).toBe(22);
    const seats = plan.moves.map((m) => `${m.toTableId}:${m.toSeatNumber}`);
    expect(new Set(seats).size).toBe(22);
    const counts = ["t1", "t2", "t3"].map((t) => plan.moves.filter((m) => m.toTableId === t).length).sort();
    expect(counts).toEqual([7, 7, 8]);
    expect(validatePlan(tables, plan.moves)).toEqual([]);
  });

  it("never uses locked seats", () => {
    const tables = [table(1, [], { lockedSeats: new Set([1, 2, 3]) }), table(2)];
    const plan = planInitialSeating({ tables, entryIds: ids(15), rng: createSeededRng(7) });
    expect(plan.moves.some((m) => m.toTableId === "t1" && [1, 2, 3].includes(m.toSeatNumber))).toBe(false);
  });

  it("reports missing capacity instead of overfilling", () => {
    const plan = planInitialSeating({ tables: [table(1)], entryIds: ids(12), rng: createSeededRng(1) });
    expect(plan.moves).toHaveLength(0);
    expect(plan.additionalTablesNeeded).toBe(1);
  });

  it("is random: different draws produce different seatings", () => {
    const tables = [table(1), table(2)];
    const a = planInitialSeating({ tables, entryIds: ids(18), rng: createSeededRng(1) }).moves.map((m) => m.toSeatNumber).join();
    const b = planInitialSeating({ tables, entryIds: ids(18), rng: createSeededRng(2) }).moves.map((m) => m.toSeatNumber).join();
    expect(a).not.toBe(b);
  });

  it("seats late entries at the shortest table", () => {
    const tables = [table(1, [1, 2, 3, 4, 5, 6, 7]), table(2, [1, 2, 3, 4, 5])];
    for (let i = 0; i < 20; i++) {
      const m = chooseSeatForNewEntry(tables, "late", "SHORTEST_TABLE_RANDOM_SEAT", createCryptoRng());
      expect(m?.toTableId).toBe("t2");
      expect([6, 7, 8, 9]).toContain(m?.toSeatNumber);
    }
  });

  it("detects stale plans", () => {
    const tables = [table(1, [1]), table(2)];
    const errors = validatePlan(tables, [{ entryId: "t1-s1", fromTableId: "t1", fromSeatNumber: 2, toTableId: "t2", toSeatNumber: 1 }]);
    expect(errors[0]).toMatch(/no longer at the expected seat/);
    const occupied = validatePlan([table(1, [1]), table(2, [1])], [{ entryId: "t1-s1", fromTableId: "t1", fromSeatNumber: 1, toTableId: "t2", toSeatNumber: 1 }]);
    expect(occupied[0]).toMatch(/occupied/);
  });
});

describe("table balancing", () => {
  it("analyzes imbalance", () => {
    const a = analyzeBalance([table(1, [1, 2, 3, 4, 5, 6, 7, 8, 9]), table(2, [1, 2, 3, 4, 5, 6])], 1);
    expect(a.balanced).toBe(false);
    expect(a.imbalance).toBe(3);
    expect(a.severe).toBe(true);
  });

  it("recommends moves from the longest to the shortest table until within tolerance", () => {
    const tables = [table(1, [1, 2, 3, 4, 5, 6, 7, 8, 9]), table(2, [1, 2, 3, 4, 5, 6])];
    const moves = recommendBalanceMoves(tables, { maxImbalance: 1, playerSelection: "RANDOM", rng: createSeededRng(3) });
    expect(moves).toHaveLength(1);
    expect(moves[0]!.fromTableId).toBe("t1");
    expect(moves[0]!.toTableId).toBe("t2");
    expect(moves[0]!.explanation).toMatch(/imbalance 3 > 1/);
    expect(validatePlan(tables, moves)).toEqual([]);
  });

  it("moves the player due to post the big blind next when the button is known", () => {
    const t1 = table(1, [1, 2, 3, 4, 5, 6, 7, 8, 9], { dealerButtonSeat: 4 });
    // button 4 → SB 5, BB 6, next BB 7
    expect(nextBigBlindSeat(toWork([t1])[0]!)).toBe(7);
    const moves = recommendBalanceMoves([t1, table(2, [1, 2, 3, 4, 5, 6, 7])], {
      maxImbalance: 1,
      playerSelection: "BIG_BLIND_NEXT",
      rng: createSeededRng(1),
    });
    expect(moves[0]!.fromSeatNumber).toBe(7);
  });

  it("does nothing when balanced", () => {
    expect(recommendBalanceMoves([table(1, [1, 2, 3]), table(2, [1, 2])], { maxImbalance: 1, playerSelection: "RANDOM", rng: createSeededRng(1) })).toEqual([]);
  });
});

describe("table breaking", () => {
  it("recommends breaking when players fit on fewer tables", () => {
    const tables = [table(1, [1, 2, 3, 4, 5, 6]), table(2, [1, 2, 3, 4, 5]), table(3, [1, 2, 3, 4, 5])];
    const r = recommendTableBreak(tables, "HIGHEST_NUMBER_FIRST");
    expect(r.shouldBreak).toBe(true);
    expect(r.tableNumber).toBe(3);
    const r2 = recommendTableBreak([table(1, [1, 2, 3, 4, 5, 6, 7, 8]), table(2, [1, 2, 3, 4, 5, 6, 7, 8])], "HIGHEST_NUMBER_FIRST");
    expect(r2.shouldBreak).toBe(false);
  });

  it("distributes every player to open seats, shortest tables first", () => {
    const tables = [table(1, [1, 2, 3, 4, 5, 6]), table(2, [1, 2, 3, 4, 5]), table(3, [1, 2, 3, 4, 5])];
    const moves = planTableBreak(tables, "t3", createCryptoRng());
    expect(moves).toHaveLength(5);
    expect(moves.every((m) => m.fromTableId === "t3" && m.toTableId !== "t3")).toBe(true);
    expect(validatePlan(tables, moves)).toEqual([]);
    const toT1 = moves.filter((m) => m.toTableId === "t1").length;
    const toT2 = moves.filter((m) => m.toTableId === "t2").length;
    expect(6 + toT1 - (5 + toT2)).toBeLessThanOrEqual(1);
  });

  it("refuses to break when seats are insufficient", () => {
    expect(() => planTableBreak([table(1, [1, 2, 3, 4, 5, 6, 7, 8, 9]), table(2, [1, 2])], "t2", createSeededRng(1))).toThrow(/not enough open seats/);
  });
});
