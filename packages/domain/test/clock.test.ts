import { describe, expect, it } from "vitest";
import {
  adjustClock,
  deriveClock,
  finishClock,
  formatClock,
  INITIAL_CLOCK,
  materialize,
  nextLevel,
  pauseClock,
  previousLevel,
  reopenClock,
  resumeClock,
  setLevel,
  setRemaining,
  startClock,
  type LevelLike,
} from "../src/index.js";

const MIN = 60_000;
const levels: LevelLike[] = [
  { type: "PLAY", durationSeconds: 20 * 60 },
  { type: "PLAY", durationSeconds: 20 * 60 },
  { type: "BREAK", durationSeconds: 10 * 60 },
  { type: "PLAY", durationSeconds: 20 * 60 },
];
const T0 = Date.UTC(2026, 8, 27, 18, 0, 0);

describe("clock derivation", () => {
  it("NOT_STARTED shows the full first level", () => {
    const d = deriveClock(INITIAL_CLOCK, levels, T0);
    expect(d.levelIndex).toBe(0);
    expect(d.remainingMs).toBe(20 * MIN);
    expect(d.levelEndsAt).toBeNull();
  });

  it("counts down while running", () => {
    const a = startClock(levels, T0);
    const d = deriveClock(a, levels, T0 + 5 * MIN);
    expect(d.levelIndex).toBe(0);
    expect(d.remainingMs).toBe(15 * MIN);
    expect(d.levelEndsAt).toBe(T0 + 20 * MIN);
  });

  it("auto-advances through levels and reports breaks", () => {
    const a = startClock(levels, T0);
    const d = deriveClock(a, levels, T0 + 45 * MIN);
    expect(d.levelIndex).toBe(2);
    expect(d.isBreak).toBe(true);
    expect(d.playLevelNumber).toBe(2);
    expect(d.remainingMs).toBe(5 * MIN);
  });

  it("holds at zero when the structure is exhausted", () => {
    const a = startClock(levels, T0);
    const d = deriveClock(a, levels, T0 + 999 * MIN);
    expect(d.levelIndex).toBe(3);
    expect(d.remainingMs).toBe(0);
    expect(d.structureComplete).toBe(true);
  });

  it("computes time until next break across levels", () => {
    const a = startClock(levels, T0);
    const d = deriveClock(a, levels, T0 + 5 * MIN);
    expect(d.nextBreakIndex).toBe(2);
    expect(d.msUntilNextBreak).toBe(35 * MIN);
  });
});

describe("clock commands", () => {
  it("pause freezes remaining time and resume continues from it", () => {
    let a = startClock(levels, T0);
    a = pauseClock(a, levels, T0 + 7 * MIN);
    expect(a.status).toBe("PAUSED");
    expect(a.remainingAtPauseMs).toBe(13 * MIN);
    // time passes while paused — nothing changes
    expect(deriveClock(a, levels, T0 + 60 * MIN).remainingMs).toBe(13 * MIN);
    a = resumeClock(a, levels, T0 + 60 * MIN);
    const d = deriveClock(a, levels, T0 + 61 * MIN);
    expect(d.levelIndex).toBe(0);
    expect(d.remainingMs).toBe(12 * MIN);
  });

  it("pause after an auto-advance captures the derived level", () => {
    const a = pauseClock(startClock(levels, T0), levels, T0 + 25 * MIN);
    expect(a.levelIndex).toBe(1);
    expect(a.remainingAtPauseMs).toBe(15 * MIN);
  });

  it("rejects invalid transitions", () => {
    expect(() => pauseClock(INITIAL_CLOCK, levels, T0)).toThrow(/cannot pause/);
    expect(() => resumeClock(startClock(levels, T0), levels, T0)).toThrow(/cannot resume/);
    expect(() => previousLevel(startClock(levels, T0), levels, T0)).toThrow(/first level/);
    expect(() => setLevel(startClock(levels, T0), levels, 9, T0)).toThrow(/out of range/);
  });

  it("next/previous level restart with full duration", () => {
    let a = startClock(levels, T0);
    a = nextLevel(a, levels, T0 + 3 * MIN);
    let d = deriveClock(a, levels, T0 + 3 * MIN);
    expect(d.levelIndex).toBe(1);
    expect(d.remainingMs).toBe(20 * MIN);
    a = previousLevel(a, levels, T0 + 4 * MIN);
    d = deriveClock(a, levels, T0 + 4 * MIN);
    expect(d.levelIndex).toBe(0);
    expect(d.remainingMs).toBe(20 * MIN);
  });

  it("next level while paused stays paused", () => {
    let a = pauseClock(startClock(levels, T0), levels, T0 + MIN);
    a = nextLevel(a, levels, T0 + 2 * MIN);
    expect(a.status).toBe("PAUSED");
    expect(a.levelIndex).toBe(1);
    expect(a.remainingAtPauseMs).toBe(20 * MIN);
  });

  it("adjusts and sets remaining time", () => {
    let a = startClock(levels, T0);
    a = adjustClock(a, levels, 2 * MIN, T0 + 10 * MIN);
    expect(deriveClock(a, levels, T0 + 10 * MIN).remainingMs).toBe(12 * MIN);
    a = setRemaining(a, levels, 30_000, T0 + 10 * MIN);
    expect(deriveClock(a, levels, T0 + 10 * MIN).remainingMs).toBe(30_000);
    // Removing more time than remains ends the level: a running clock moves on to the next one.
    a = adjustClock(a, levels, -5 * MIN, T0 + 10 * MIN);
    const d = deriveClock(a, levels, T0 + 10 * MIN);
    expect(d.levelIndex).toBe(1);
    expect(d.remainingMs).toBe(20 * MIN);
    // A paused clock holds at zero instead.
    const p = adjustClock(pauseClock(startClock(levels, T0), levels, T0 + MIN), levels, -60 * MIN, T0 + MIN);
    expect(deriveClock(p, levels, T0 + 2 * MIN)).toMatchObject({ levelIndex: 0, remainingMs: 0 });
  });

  it("finish then reopen returns a paused clock", () => {
    const f = finishClock(startClock(levels, T0), levels, T0 + 30 * MIN);
    expect(f.status).toBe("FINISHED");
    const r = reopenClock(f, levels, T0 + 31 * MIN);
    expect(r.status).toBe("PAUSED");
    expect(r.levelIndex).toBe(1);
    expect(r.remainingAtPauseMs).toBe(10 * MIN);
  });
});

describe("server restart / materialization (spec §79, §93)", () => {
  it("reconstructs the correct remaining time from persisted timestamps after downtime", () => {
    const persisted = startClock(levels, T0);
    // Server was down from minute 12 to minute 18; nothing was written meanwhile.
    const afterReboot = deriveClock(persisted, levels, T0 + 18 * MIN);
    expect(afterReboot.levelIndex).toBe(0);
    expect(afterReboot.remainingMs).toBe(2 * MIN); // NOT restarted from 20:00
  });

  it("materialize rewrites the anchor to the current level without changing the countdown", () => {
    const a = startClock(levels, T0);
    const now = T0 + 47 * MIN;
    const m = materialize(a, levels, now);
    expect(m.levelIndex).toBe(2);
    expect(m.startedAt).toBe(T0 + 40 * MIN);
    expect(deriveClock(m, levels, now).remainingMs).toBe(deriveClock(a, levels, now).remainingMs);
    expect(materialize(m, levels, now)).toBe(m);
  });
});

describe("formatClock", () => {
  it("formats minutes and hours", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(59_001)).toBe("1:00");
    expect(formatClock(20 * MIN)).toBe("20:00");
    expect(formatClock(3 * 3600_000 + 5_000)).toBe("3:00:05");
  });
});
