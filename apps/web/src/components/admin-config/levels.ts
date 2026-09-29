// Blind level helpers: editable rows, validation, next-level suggestions,
// generated ladders and timeline maths.

import { indexOfPlayLevel, validateStructure } from "@pcos/domain";
import type { AnteType, LevelInput, LevelType, LevelView } from "@pcos/types";
import { parseIntOrNull } from "./utils";

type T = (text: string, vars?: Record<string, string | number | null | undefined>) => string;

/** A level row as typed in the editor. */
export interface EditableLevel {
  key: string;
  type: LevelType;
  smallBlind: string;
  bigBlind: string;
  ante: string;
  anteType: AnteType;
  minutes: string;
  label: string;
  /** preserved from the server, not edited in the table */
  note: string | null;
}

let seq = 0;
export const newKey = () => `lvl-${Date.now().toString(36)}-${(seq++).toString(36)}`;

const minutesText = (seconds: number) => {
  const m = seconds / 60;
  return Number.isInteger(m) ? String(m) : String(Math.round(m * 100) / 100);
};

export function fromViews(levels: readonly Pick<LevelView, "type" | "smallBlind" | "bigBlind" | "ante" | "anteType" | "durationSeconds" | "label" | "note">[]): EditableLevel[] {
  return levels.map((l) => ({
    key: newKey(),
    type: l.type,
    smallBlind: l.type === "PLAY" ? String(l.smallBlind) : "",
    bigBlind: l.type === "PLAY" ? String(l.bigBlind) : "",
    ante: l.type === "PLAY" ? String(l.ante) : "",
    anteType: l.type === "PLAY" ? l.anteType : "NONE",
    minutes: minutesText(l.durationSeconds),
    label: l.label ?? "",
    note: l.note ?? null,
  }));
}

const num = (s: string) => {
  const n = parseIntOrNull(s);
  return n == null || Number.isNaN(n) ? 0 : n;
};

export function durationSecondsOf(l: EditableLevel): number {
  const m = Number.parseFloat(l.minutes.replace(",", "."));
  return Number.isFinite(m) ? Math.round(m * 60) : 0;
}

/** Rows → API payload (assumes validation passed). */
export function toInputs(levels: readonly EditableLevel[]): LevelInput[] {
  return levels.map((l) => {
    const play = l.type === "PLAY";
    return {
      type: l.type,
      smallBlind: play ? num(l.smallBlind) : 0,
      bigBlind: play ? num(l.bigBlind) : 0,
      ante: play ? num(l.ante) : 0,
      anteType: play ? l.anteType : "NONE",
      durationSeconds: durationSecondsOf(l),
      label: l.label.trim() || null,
      note: l.note,
    };
  });
}

/** Stable signature for dirty checks (keys ignored). */
export const levelsSignature = (levels: readonly EditableLevel[]) => JSON.stringify(levels.map(({ key: _key, ...rest }) => rest));

export interface LevelIssue {
  index: number;
  message: string;
  severity: "error" | "warning";
  field?: "smallBlind" | "bigBlind" | "ante" | "anteType" | "minutes" | "label" | "type";
}

/** Per-row checks mirroring LevelInput (zod) plus the domain's structural validation. */
export function validateLevels(levels: readonly EditableLevel[], t: T): LevelIssue[] {
  const issues: LevelIssue[] = [];
  const add = (index: number, message: string, field?: LevelIssue["field"], severity: LevelIssue["severity"] = "error") => issues.push({ index, message, field, severity });
  if (levels.length === 0) add(0, t("Add at least one level"));
  if (levels.length > 200) add(200, t("A structure can have at most 200 levels"));
  levels.forEach((l, i) => {
    const seconds = durationSecondsOf(l);
    if (!l.minutes.trim() || !Number.isFinite(Number.parseFloat(l.minutes.replace(",", ".")))) add(i, t("Enter the duration in minutes"), "minutes");
    else if (seconds < 30) add(i, t("Duration must be at least 30 seconds"), "minutes");
    else if (seconds > 6 * 3600) add(i, t("Duration must be at most 6 hours"), "minutes");
    if (l.label.trim().length > 60) add(i, t("Label must be at most 60 characters"), "label");
    if (l.type !== "PLAY") return;
    const sb = parseIntOrNull(l.smallBlind);
    const bb = parseIntOrNull(l.bigBlind);
    const ante = parseIntOrNull(l.ante);
    if (bb == null || Number.isNaN(bb) || bb <= 0) add(i, t("Big blind must be a positive whole number"), "bigBlind");
    if (sb == null || Number.isNaN(sb) || sb < 0) add(i, t("Small blind must be a whole number"), "smallBlind");
    else if (bb != null && !Number.isNaN(bb) && sb > bb) add(i, t("Small blind cannot exceed the big blind"), "smallBlind");
    if (ante != null && (Number.isNaN(ante) || ante < 0)) add(i, t("Ante must be a whole number"), "ante");
    else if (l.anteType === "NONE" && (ante ?? 0) > 0) add(i, t("Ante is set but the ante type is “No ante”"), "anteType");
    else if (l.anteType !== "NONE" && (ante ?? 0) === 0) add(i, t("Ante type is set but the ante is 0"), "ante", "warning");
  });
  const structural = validateStructure(
    levels.map((l) => ({ type: l.type, durationSeconds: durationSecondsOf(l), smallBlind: num(l.smallBlind), bigBlind: num(l.bigBlind) })),
  );
  const STRUCTURAL: Record<string, string> = {
    "structure needs at least one play level": t("The structure needs at least one play level"),
    "structure cannot start with a break": t("The structure cannot start with a break"),
    "consecutive breaks": t("Two breaks in a row"),
    "big blind decreases compared to previous level": t("Big blind is lower than in the previous level"),
  };
  for (const s of structural) add(s.index, STRUCTURAL[s.message] ?? s.message, s.message.startsWith("big blind") ? "bigBlind" : "type");
  return issues;
}

// --- suggestions ------------------------------------------------------------------------------------

const NICE = [1, 1.5, 2, 3, 4, 5, 6, 8];

/** Smallest "round" chip amount ≥ x (1, 1.5, 2, 3, 4, 5, 6, 8 × 10^k). */
export function niceAtLeast(x: number): number {
  if (x <= 1) return 1;
  let mag = 10 ** Math.floor(Math.log10(x));
  for (let k = 0; k < 3; k++) {
    for (const m of NICE) {
      const v = Math.round(m * mag);
      if (v >= x - 1e-9) return v;
    }
    mag *= 10;
  }
  return Math.ceil(x);
}

/** Next blind level after the given rows: ~20-50% higher big blind, same duration and ante style. */
export function suggestNextLevel(before: readonly EditableLevel[]): EditableLevel {
  const lastPlay = [...before].reverse().find((l) => l.type === "PLAY");
  if (!lastPlay) return { key: newKey(), type: "PLAY", smallBlind: "100", bigBlind: "200", ante: "0", anteType: "NONE", minutes: "20", label: "", note: null };
  const bb = num(lastPlay.bigBlind) || 200;
  const nextBb = niceAtLeast(bb * 1.2);
  const prevAnte = num(lastPlay.ante);
  const ante = lastPlay.anteType === "BIG_BLIND" ? nextBb : lastPlay.anteType === "STANDARD" ? Math.max(1, Math.round((prevAnte * nextBb) / bb)) : 0;
  return {
    key: newKey(),
    type: "PLAY",
    smallBlind: String(Math.round(nextBb / 2)),
    bigBlind: String(nextBb),
    ante: String(ante),
    anteType: lastPlay.anteType,
    minutes: lastPlay.minutes || "20",
    label: "",
    note: null,
  };
}

export function newBreak(before: readonly EditableLevel[], label: string): EditableLevel {
  const lastBreak = [...before].reverse().find((l) => l.type === "BREAK");
  return { key: newKey(), type: "BREAK", smallBlind: "", bigBlind: "", ante: "", anteType: "NONE", minutes: lastBreak?.minutes || "10", label, note: null };
}

/** Ante for an ante type at a big blind (standard ante ≈ 1/8 BB). */
export function anteFor(type: AnteType, bb: number, current: number): number {
  if (type === "NONE") return 0;
  if (type === "BIG_BLIND") return bb;
  return current > 0 && current !== bb ? current : Math.max(1, Math.round(bb / 8));
}

export interface LadderOptions {
  levels: number;
  minutes: number;
  startBigBlind: number;
  breakEvery: number;
  breakMinutes: number;
  anteFromLevel: number | null;
  anteType: AnteType;
  breakLabel: string;
}

/** A complete starting structure for "New structure". */
export function generateLadder(o: LadderOptions): LevelInput[] {
  const out: LevelInput[] = [];
  let bb = Math.max(2, o.startBigBlind);
  for (let n = 1; n <= o.levels; n++) {
    const withAnte = o.anteFromLevel != null && n >= o.anteFromLevel && o.anteType !== "NONE";
    const anteType: AnteType = withAnte ? o.anteType : "NONE";
    out.push({ type: "PLAY", smallBlind: Math.round(bb / 2), bigBlind: bb, ante: withAnte ? anteFor(o.anteType, bb, 0) : 0, anteType, durationSeconds: Math.round(o.minutes * 60), label: null, note: null });
    if (o.breakEvery > 0 && n % o.breakEvery === 0 && n < o.levels) {
      out.push({ type: "BREAK", smallBlind: 0, bigBlind: 0, ante: 0, anteType: "NONE", durationSeconds: Math.round(o.breakMinutes * 60), label: o.breakLabel, note: null });
    }
    bb = niceAtLeast(bb * 1.2);
  }
  return out;
}

// --- timeline -----------------------------------------------------------------------------------------

export interface TimelineInfo {
  /** start offset (seconds) of each level */
  starts: number[];
  total: number;
  playCount: number;
  breakCount: number;
  /** 1-based play level number per row (null for breaks) */
  playNumbers: (number | null)[];
}

export function timelineOf(levels: readonly { type: LevelType; durationSeconds: number }[]): TimelineInfo {
  const starts: number[] = [];
  const playNumbers: (number | null)[] = [];
  let total = 0;
  let play = 0;
  let breaks = 0;
  for (const l of levels) {
    starts.push(total);
    total += Math.max(0, l.durationSeconds);
    if (l.type === "PLAY") playNumbers.push(++play);
    else {
      breaks++;
      playNumbers.push(null);
    }
  }
  return { starts, total, playCount: play, breakCount: breaks, playNumbers };
}

/** Level `n` (1-based play level) of a structure and the offset at which it ends. */
export function playLevelInfo(levels: readonly LevelView[] | null | undefined, n: number): { level: LevelView; endOffsetSeconds: number } | null {
  if (!levels || !Number.isInteger(n) || n < 1) return null;
  const idx = indexOfPlayLevel(levels, n);
  if (idx < 0) return null;
  let end = 0;
  for (let i = 0; i <= idx; i++) end += levels[i]!.durationSeconds;
  return { level: levels[idx]!, endOffsetSeconds: end };
}
