// Tournament lifecycle state machine (spec §42). Status changes only through
// explicit commands; arbitrary status overwrites are impossible by design.

import type { CommandType, TournamentStatus } from "@pcos/types";
import { LIVE_TOURNAMENT_STATUSES } from "@pcos/types";
import { invalidState } from "./errors.js";

export const LIFECYCLE_TRANSITIONS = {
  PUBLISH: { from: ["DRAFT"], to: "SCHEDULED" },
  UNPUBLISH: { from: ["SCHEDULED"], to: "DRAFT" },
  OPEN_REGISTRATION: { from: ["SCHEDULED"], to: "REGISTRATION_OPEN" },
  START_SEATING: { from: ["REGISTRATION_OPEN"], to: "SEATING" },
  START_TOURNAMENT: { from: ["REGISTRATION_OPEN", "SEATING"], to: "RUNNING" },
  PAUSE_CLOCK: { from: ["RUNNING", "BREAK", "HAND_FOR_HAND"], to: "PAUSED" },
  RESUME_CLOCK: { from: ["PAUSED"], to: "RUNNING" },
  START_HAND_FOR_HAND: { from: ["RUNNING"], to: "HAND_FOR_HAND" },
  END_HAND_FOR_HAND: { from: ["HAND_FOR_HAND"], to: "RUNNING" },
  FINISH_TOURNAMENT: { from: ["RUNNING", "BREAK", "PAUSED", "HAND_FOR_HAND"], to: "FINISHED" },
  REOPEN_TOURNAMENT: { from: ["FINISHED"], to: "PAUSED" },
  FINALIZE_RESULTS: { from: ["FINISHED"], to: "FINALIZED" },
  CANCEL_TOURNAMENT: {
    from: ["DRAFT", "SCHEDULED", "REGISTRATION_OPEN", "SEATING", "RUNNING", "BREAK", "PAUSED", "HAND_FOR_HAND"],
    to: "CANCELLED",
  },
} as const satisfies Partial<Record<CommandType, { from: readonly TournamentStatus[]; to: TournamentStatus }>>;

export type LifecycleCommand = keyof typeof LIFECYCLE_TRANSITIONS;

export function isLifecycleCommand(type: CommandType): type is LifecycleCommand {
  return type in LIFECYCLE_TRANSITIONS;
}

export function canTransition(status: TournamentStatus, command: LifecycleCommand): boolean {
  return (LIFECYCLE_TRANSITIONS[command].from as readonly TournamentStatus[]).includes(status);
}

export function assertTransition(status: TournamentStatus, command: LifecycleCommand): TournamentStatus {
  if (!canTransition(status, command)) {
    throw invalidState(`${command} is not allowed while the tournament is ${status}`, { status, command });
  }
  return LIFECYCLE_TRANSITIONS[command].to;
}

export const isLive = (s: TournamentStatus) => LIVE_TOURNAMENT_STATUSES.includes(s);
export const isPreStart = (s: TournamentStatus) => s === "DRAFT" || s === "SCHEDULED" || s === "REGISTRATION_OPEN" || s === "SEATING";
export const isClosed = (s: TournamentStatus) => s === "FINISHED" || s === "FINALIZED" || s === "CANCELLED";

/**
 * Status that reflects the clock while live: BREAK during break levels,
 * RUNNING during play levels. PAUSED and HAND_FOR_HAND are explicit and kept.
 */
export function statusForLevel(current: TournamentStatus, isBreakLevel: boolean): TournamentStatus {
  if (current === "RUNNING" && isBreakLevel) return "BREAK";
  if (current === "BREAK" && !isBreakLevel) return "RUNNING";
  return current;
}

/** Status after RESUME_CLOCK, taking into account where the pause came from. */
export function statusAfterResume(pausedFrom: TournamentStatus | null, isBreakLevel: boolean): TournamentStatus {
  if (pausedFrom === "HAND_FOR_HAND") return "HAND_FOR_HAND";
  return isBreakLevel ? "BREAK" : "RUNNING";
}

/** States in which each operational (non-lifecycle) command group is permitted. */
const REGISTRATION_STATES: readonly TournamentStatus[] = ["SCHEDULED", "REGISTRATION_OPEN", "SEATING", ...LIVE_TOURNAMENT_STATUSES];
const CHECKIN_STATES: readonly TournamentStatus[] = ["REGISTRATION_OPEN", "SEATING", ...LIVE_TOURNAMENT_STATUSES];
const SEATING_STATES: readonly TournamentStatus[] = ["REGISTRATION_OPEN", "SEATING", ...LIVE_TOURNAMENT_STATUSES];
const PLAY_STATES: readonly TournamentStatus[] = LIVE_TOURNAMENT_STATUSES;

export const OPERATION_STATES: Partial<Record<CommandType, readonly TournamentStatus[]>> = {
  REGISTER_PLAYER: REGISTRATION_STATES,
  CANCEL_REGISTRATION: REGISTRATION_STATES,
  PROMOTE_WAITLIST: REGISTRATION_STATES,
  CHECK_IN: CHECKIN_STATES,
  UNDO_CHECK_IN: CHECKIN_STATES,
  MARK_NO_SHOW: CHECKIN_STATES,
  CREATE_ENTRY: CHECKIN_STATES,
  REBUY: PLAY_STATES,
  ADD_ON: PLAY_STATES,
  CHIP_ADJUSTMENT: [...PLAY_STATES, "FINISHED"],
  VOID_TRANSACTION: [...CHECKIN_STATES, "FINISHED"],
  VOID_ENTRY: [...CHECKIN_STATES, "FINISHED"],
  ADD_TABLES: SEATING_STATES,
  CLOSE_TABLE: SEATING_STATES,
  SET_SEAT_LOCK: SEATING_STATES,
  SET_DEALER_BUTTON: SEATING_STATES,
  APPLY_INITIAL_SEATING: ["REGISTRATION_OPEN", "SEATING"],
  ASSIGN_SEAT: SEATING_STATES,
  MOVE_PLAYER: SEATING_STATES,
  APPLY_BALANCE: SEATING_STATES,
  BREAK_TABLE: SEATING_STATES,
  ELIMINATE_PLAYERS: PLAY_STATES,
  RESTORE_PLAYER: [...PLAY_STATES, "FINISHED"],
  UNDO_ACTION: [...CHECKIN_STATES, "SCHEDULED", "FINISHED"],
  NEXT_LEVEL: PLAY_STATES,
  PREVIOUS_LEVEL: PLAY_STATES,
  SET_LEVEL: PLAY_STATES,
  ADJUST_CLOCK: PLAY_STATES,
  SET_REMAINING: PLAY_STATES,
  CLOSE_LATE_REGISTRATION: [...CHECKIN_STATES],
  REOPEN_LATE_REGISTRATION: [...CHECKIN_STATES],
  CORRECT_RESULT: ["FINISHED", "FINALIZED"],
  DEALER_MARK_PRESENT: SEATING_STATES,
  DEALER_REQUEST_FLOOR: SEATING_STATES,
  DEALER_REPORT_BUST: PLAY_STATES,
  DEALER_CONFIRM_MOVEMENT: SEATING_STATES,
  RESOLVE_FLOOR_REQUEST: [...SEATING_STATES, "FINISHED"],
};

export function assertOperationAllowed(status: TournamentStatus, command: CommandType): void {
  const allowed = OPERATION_STATES[command];
  if (allowed && !allowed.includes(status)) {
    throw invalidState(`${command} is not allowed while the tournament is ${status}`, { status, command });
  }
}
