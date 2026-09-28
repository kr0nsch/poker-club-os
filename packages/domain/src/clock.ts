// Tournament clock (spec §16, §51, §79).
//
// The persisted state is a small anchor: status, the level index the anchor
// refers to, and `startedAt` — the wall-clock instant at which that level
// would have started had it never been paused. Everything visible (current
// level, remaining time, next break) is *derived* from the anchor, the level
// list and "now". Consequences:
//   * a server reboot never restarts a level from full duration;
//   * any client can animate the countdown locally from the same anchor;
//   * the Internet plays no role at all.

import type { ClockStatus } from "@pcos/types";
import { invalidState } from "./errors.js";
import { nextBreakIndex, playLevelNumberAt, type LevelLike } from "./levels.js";

export interface ClockAnchor {
  status: ClockStatus;
  levelIndex: number;
  /** epoch ms; set when RUNNING */
  startedAt: number | null;
  /** epoch ms; set when PAUSED */
  pausedAt: number | null;
  /** ms remaining in the level at the moment of pausing; set when PAUSED */
  remainingAtPauseMs: number | null;
}

export interface DerivedClock {
  status: ClockStatus;
  levelIndex: number;
  level: LevelLike | null;
  playLevelNumber: number;
  isBreak: boolean;
  remainingMs: number;
  elapsedMs: number;
  levelDurationMs: number;
  /** epoch ms when the current level ends (RUNNING only) */
  levelEndsAt: number | null;
  /** true when the last level's time is used up; the clock holds at 0 */
  structureComplete: boolean;
  nextLevelIndex: number | null;
  nextBreakIndex: number | null;
  /** ms until the next break starts, when determinable */
  msUntilNextBreak: number | null;
}

export const INITIAL_CLOCK: ClockAnchor = {
  status: "NOT_STARTED",
  levelIndex: 0,
  startedAt: null,
  pausedAt: null,
  remainingAtPauseMs: null,
};

const durMs = (levels: readonly LevelLike[], i: number) => (levels[i]?.durationSeconds ?? 0) * 1000;

function assertLevels(levels: readonly LevelLike[]) {
  if (levels.length === 0) throw invalidState("tournament structure has no levels");
}

/** Pure derivation of the visible clock from the persisted anchor. */
export function deriveClock(anchor: ClockAnchor, levels: readonly LevelLike[], now: number): DerivedClock {
  const last = levels.length - 1;
  let index = Math.min(Math.max(anchor.levelIndex, 0), Math.max(last, 0));
  let remaining: number;
  let levelEndsAt: number | null = null;
  let structureComplete = false;

  switch (anchor.status) {
    case "RUNNING": {
      let start = anchor.startedAt ?? now;
      // Walk forward through levels whose time has fully elapsed.
      for (;;) {
        const d = durMs(levels, index);
        if (now < start + d || levels.length === 0) {
          remaining = start + d - now;
          levelEndsAt = start + d;
          break;
        }
        if (index >= last) {
          remaining = 0;
          levelEndsAt = start + d;
          structureComplete = true;
          break;
        }
        start += d;
        index++;
      }
      break;
    }
    case "PAUSED":
      remaining = Math.max(0, anchor.remainingAtPauseMs ?? durMs(levels, index));
      structureComplete = index >= last && remaining === 0;
      break;
    case "FINISHED":
      remaining = Math.max(0, anchor.remainingAtPauseMs ?? 0);
      break;
    case "NOT_STARTED":
    default:
      remaining = durMs(levels, index);
      break;
  }

  const level = levels[index] ?? null;
  const levelDurationMs = durMs(levels, index);
  const nb = nextBreakIndex(levels, index);
  let msUntilNextBreak: number | null = null;
  if (nb !== null) {
    msUntilNextBreak = remaining;
    for (let i = index + 1; i < nb; i++) msUntilNextBreak += durMs(levels, i);
  }

  return {
    status: anchor.status,
    levelIndex: index,
    level,
    playLevelNumber: playLevelNumberAt(levels, index),
    isBreak: level?.type === "BREAK",
    remainingMs: remaining,
    elapsedMs: Math.max(0, levelDurationMs - remaining),
    levelDurationMs,
    levelEndsAt,
    structureComplete,
    nextLevelIndex: index < last ? index + 1 : null,
    nextBreakIndex: nb,
    msUntilNextBreak,
  };
}

/**
 * Rewrites a RUNNING anchor so that `levelIndex` is the level currently in
 * play (auto-advance materialisation). Returns the same object when nothing
 * changed. Used by the clock ticker to persist level changes and broadcast them.
 */
export function materialize(anchor: ClockAnchor, levels: readonly LevelLike[], now: number): ClockAnchor {
  if (anchor.status !== "RUNNING") return anchor;
  const d = deriveClock(anchor, levels, now);
  if (d.levelIndex === anchor.levelIndex) return anchor;
  return {
    ...anchor,
    levelIndex: d.levelIndex,
    startedAt: (d.levelEndsAt ?? now) - d.levelDurationMs,
  };
}

export function startClock(levels: readonly LevelLike[], now: number): ClockAnchor {
  assertLevels(levels);
  return { status: "RUNNING", levelIndex: 0, startedAt: now, pausedAt: null, remainingAtPauseMs: null };
}

export function pauseClock(anchor: ClockAnchor, levels: readonly LevelLike[], now: number): ClockAnchor {
  if (anchor.status !== "RUNNING") throw invalidState(`clock is ${anchor.status}, cannot pause`);
  const d = deriveClock(anchor, levels, now);
  return { status: "PAUSED", levelIndex: d.levelIndex, startedAt: null, pausedAt: now, remainingAtPauseMs: d.remainingMs };
}

export function resumeClock(anchor: ClockAnchor, levels: readonly LevelLike[], now: number): ClockAnchor {
  if (anchor.status !== "PAUSED") throw invalidState(`clock is ${anchor.status}, cannot resume`);
  const remaining = anchor.remainingAtPauseMs ?? durMs(levels, anchor.levelIndex);
  return {
    status: "RUNNING",
    levelIndex: anchor.levelIndex,
    startedAt: now - (durMs(levels, anchor.levelIndex) - remaining),
    pausedAt: null,
    remainingAtPauseMs: null,
  };
}

/** Jump to a level with its full duration, preserving running/paused state. */
export function setLevel(anchor: ClockAnchor, levels: readonly LevelLike[], levelIndex: number, now: number): ClockAnchor {
  assertLevels(levels);
  if (levelIndex < 0 || levelIndex >= levels.length) throw invalidState(`level index ${levelIndex} out of range`);
  if (anchor.status === "NOT_STARTED" || anchor.status === "FINISHED") throw invalidState(`clock is ${anchor.status}`);
  if (anchor.status === "RUNNING") {
    return { status: "RUNNING", levelIndex, startedAt: now, pausedAt: null, remainingAtPauseMs: null };
  }
  return { status: "PAUSED", levelIndex, startedAt: null, pausedAt: anchor.pausedAt ?? now, remainingAtPauseMs: durMs(levels, levelIndex) };
}

export function nextLevel(anchor: ClockAnchor, levels: readonly LevelLike[], now: number): ClockAnchor {
  const d = deriveClock(anchor, levels, now);
  if (d.levelIndex >= levels.length - 1) throw invalidState("already at the last level");
  return setLevel(anchor, levels, d.levelIndex + 1, now);
}

export function previousLevel(anchor: ClockAnchor, levels: readonly LevelLike[], now: number): ClockAnchor {
  const d = deriveClock(anchor, levels, now);
  if (d.levelIndex <= 0) throw invalidState("already at the first level");
  return setLevel(anchor, levels, d.levelIndex - 1, now);
}

/** Set the remaining time of the current level (may exceed the nominal duration). */
export function setRemaining(anchor: ClockAnchor, levels: readonly LevelLike[], remainingMs: number, now: number): ClockAnchor {
  if (remainingMs < 0) throw invalidState("remaining time cannot be negative");
  const d = deriveClock(anchor, levels, now);
  if (anchor.status === "RUNNING") {
    return { status: "RUNNING", levelIndex: d.levelIndex, startedAt: now - (d.levelDurationMs - remainingMs), pausedAt: null, remainingAtPauseMs: null };
  }
  if (anchor.status === "PAUSED") {
    return { ...anchor, levelIndex: d.levelIndex, remainingAtPauseMs: remainingMs };
  }
  throw invalidState(`clock is ${anchor.status}`);
}

/** Add (positive) or remove (negative) time from the current level. */
export function adjustClock(anchor: ClockAnchor, levels: readonly LevelLike[], deltaMs: number, now: number): ClockAnchor {
  const d = deriveClock(anchor, levels, now);
  return setRemaining(anchor, levels, Math.max(0, d.remainingMs + deltaMs), now);
}

export function finishClock(anchor: ClockAnchor, levels: readonly LevelLike[], now: number): ClockAnchor {
  const d = deriveClock(anchor, levels, now);
  return { status: "FINISHED", levelIndex: d.levelIndex, startedAt: null, pausedAt: now, remainingAtPauseMs: d.remainingMs };
}

/** Re-open a finished clock in PAUSED state (e.g. the last elimination was a mistake). */
export function reopenClock(anchor: ClockAnchor, levels: readonly LevelLike[], now: number): ClockAnchor {
  if (anchor.status !== "FINISHED") throw invalidState(`clock is ${anchor.status}`);
  return { status: "PAUSED", levelIndex: anchor.levelIndex, startedAt: null, pausedAt: now, remainingAtPauseMs: anchor.remainingAtPauseMs ?? durMs(levels, anchor.levelIndex) };
}

/**
 * Restore a previously captured anchor as a compensating action (undo of a
 * clock command). A running clock keeps the time that has elapsed since.
 */
export function restoreClock(before: ClockAnchor, levels: readonly LevelLike[], _now: number): ClockAnchor {
  assertLevels(levels);
  return { ...before };
}

/** Server time offset estimation for clients (NTP-style, single sample). */
export function estimateOffset(clientSentAt: number, serverTime: number, clientReceivedAt: number): { offsetMs: number; rttMs: number } {
  const rtt = Math.max(0, clientReceivedAt - clientSentAt);
  return { offsetMs: serverTime + rtt / 2 - clientReceivedAt, rttMs: rtt };
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(h > 0 ? 2 : 1, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
