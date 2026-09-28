import { describe, expect, it } from "vitest";
import { TOURNAMENT_STATUSES } from "@pcos/types";
import {
  assertOperationAllowed,
  assertTransition,
  canTransition,
  LIFECYCLE_TRANSITIONS,
  statusAfterResume,
  statusForLevel,
} from "../src/index.js";

describe("tournament state machine", () => {
  it("follows the happy path", () => {
    let s = assertTransition("DRAFT", "PUBLISH");
    expect(s).toBe("SCHEDULED");
    s = assertTransition(s, "OPEN_REGISTRATION");
    s = assertTransition(s, "START_SEATING");
    s = assertTransition(s, "START_TOURNAMENT");
    expect(s).toBe("RUNNING");
    s = assertTransition(s, "PAUSE_CLOCK");
    expect(s).toBe("PAUSED");
    s = assertTransition(s, "FINISH_TOURNAMENT");
    s = assertTransition(s, "FINALIZE_RESULTS");
    expect(s).toBe("FINALIZED");
  });

  it("forbids transitions from terminal states", () => {
    for (const cmd of Object.keys(LIFECYCLE_TRANSITIONS) as (keyof typeof LIFECYCLE_TRANSITIONS)[]) {
      expect(canTransition("FINALIZED", cmd)).toBe(false);
      expect(canTransition("CANCELLED", cmd)).toBe(false);
    }
  });

  it("rejects starting a draft tournament", () => {
    expect(() => assertTransition("DRAFT", "START_TOURNAMENT")).toThrow(/not allowed while the tournament is DRAFT/);
  });

  it("every status has at least one way out except terminal ones", () => {
    for (const s of TOURNAMENT_STATUSES) {
      const exits = Object.values(LIFECYCLE_TRANSITIONS).filter((t) => (t.from as readonly string[]).includes(s));
      if (s === "FINALIZED" || s === "CANCELLED") expect(exits).toHaveLength(0);
      else expect(exits.length).toBeGreaterThan(0);
    }
  });

  it("derives BREAK / RUNNING from the level type", () => {
    expect(statusForLevel("RUNNING", true)).toBe("BREAK");
    expect(statusForLevel("BREAK", false)).toBe("RUNNING");
    expect(statusForLevel("PAUSED", true)).toBe("PAUSED");
    expect(statusForLevel("HAND_FOR_HAND", true)).toBe("HAND_FOR_HAND");
  });

  it("resumes into hand-for-hand when paused from it", () => {
    expect(statusAfterResume("HAND_FOR_HAND", false)).toBe("HAND_FOR_HAND");
    expect(statusAfterResume("RUNNING", true)).toBe("BREAK");
    expect(statusAfterResume(null, false)).toBe("RUNNING");
  });

  it("guards operational commands by status", () => {
    expect(() => assertOperationAllowed("DRAFT", "CHECK_IN")).toThrow();
    expect(() => assertOperationAllowed("RUNNING", "ELIMINATE_PLAYERS")).not.toThrow();
    expect(() => assertOperationAllowed("SCHEDULED", "ELIMINATE_PLAYERS")).toThrow();
    expect(() => assertOperationAllowed("FINALIZED", "REBUY")).toThrow();
  });
});
