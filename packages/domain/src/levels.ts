import type { LevelType } from "@pcos/types";

export interface LevelLike {
  type: LevelType;
  durationSeconds: number;
}

/**
 * 1-based play-level number at `index`. For a break this is the number of play
 * levels completed before it (so the break after level 6 reports 6).
 */
export function playLevelNumberAt(levels: readonly LevelLike[], index: number): number {
  let n = 0;
  for (let i = 0; i <= index && i < levels.length; i++) {
    if (levels[i]!.type === "PLAY") n++;
  }
  return n;
}

/** Index of the level holding the given 1-based play level number, or -1. */
export function indexOfPlayLevel(levels: readonly LevelLike[], playLevelNumber: number): number {
  let n = 0;
  for (let i = 0; i < levels.length; i++) {
    if (levels[i]!.type === "PLAY" && ++n === playLevelNumber) return i;
  }
  return -1;
}

export function nextBreakIndex(levels: readonly LevelLike[], fromIndex: number): number | null {
  for (let i = fromIndex + 1; i < levels.length; i++) {
    if (levels[i]!.type === "BREAK") return i;
  }
  return null;
}

export function nextPlayIndex(levels: readonly LevelLike[], fromIndex: number): number | null {
  for (let i = fromIndex + 1; i < levels.length; i++) {
    if (levels[i]!.type === "PLAY") return i;
  }
  return null;
}

/** Sum of level durations in milliseconds for indexes [from, to). */
export function durationBetweenMs(levels: readonly LevelLike[], from: number, to: number): number {
  let ms = 0;
  for (let i = Math.max(0, from); i < Math.min(to, levels.length); i++) ms += levels[i]!.durationSeconds * 1000;
  return ms;
}

export interface LevelValidationIssue {
  index: number;
  message: string;
}

/** Structural sanity checks beyond per-level schema validation. */
export function validateStructure(
  levels: readonly (LevelLike & { smallBlind: number; bigBlind: number })[],
): LevelValidationIssue[] {
  const issues: LevelValidationIssue[] = [];
  if (!levels.some((l) => l.type === "PLAY")) issues.push({ index: 0, message: "structure needs at least one play level" });
  if (levels[0]?.type === "BREAK") issues.push({ index: 0, message: "structure cannot start with a break" });
  let prevBb = 0;
  levels.forEach((l, i) => {
    if (l.type === "BREAK" && levels[i - 1]?.type === "BREAK") issues.push({ index: i, message: "consecutive breaks" });
    if (l.type === "PLAY") {
      if (l.bigBlind < prevBb) issues.push({ index: i, message: "big blind decreases compared to previous level" });
      prevBb = l.bigBlind;
    }
  });
  return issues;
}
