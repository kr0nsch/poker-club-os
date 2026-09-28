// Undo through compensating operations (spec §63). History is never deleted:
// each undo is a new operational action linked to the one it compensates.

import type { CommandType } from "@pcos/types";

export interface UndoableAction {
  type: CommandType | "RESTORE_CLOCK" | "CLOCK_AUTO_ADVANCE";
  compensatedByActionId: string | null;
  compensatesActionId: string | null;
}

/** What an action is undone by. */
export const COMPENSATIONS: Partial<Record<CommandType, string>> = {
  ELIMINATE_PLAYERS: "RESTORE_PLAYER",
  MOVE_PLAYER: "MOVE_PLAYER_CORRECTION",
  APPLY_BALANCE: "MOVE_PLAYER_CORRECTION",
  ASSIGN_SEAT: "RELEASE_SEAT",
  REBUY: "VOID_TRANSACTION",
  ADD_ON: "VOID_TRANSACTION",
  CHIP_ADJUSTMENT: "VOID_TRANSACTION",
  CREATE_ENTRY: "VOID_ENTRY",
  CHECK_IN: "UNDO_CHECK_IN",
  REGISTER_PLAYER: "CANCEL_REGISTRATION",
  MARK_NO_SHOW: "RESTORE_REGISTRATION",
  CANCEL_REGISTRATION: "RESTORE_REGISTRATION",
  PAUSE_CLOCK: "RESTORE_CLOCK",
  RESUME_CLOCK: "RESTORE_CLOCK",
  NEXT_LEVEL: "RESTORE_CLOCK",
  PREVIOUS_LEVEL: "RESTORE_CLOCK",
  SET_LEVEL: "RESTORE_CLOCK",
  ADJUST_CLOCK: "RESTORE_CLOCK",
  SET_REMAINING: "RESTORE_CLOCK",
  CLOSE_LATE_REGISTRATION: "REOPEN_LATE_REGISTRATION",
  REOPEN_LATE_REGISTRATION: "CLOSE_LATE_REGISTRATION",
  SET_SEAT_LOCK: "SET_SEAT_LOCK",
  START_HAND_FOR_HAND: "END_HAND_FOR_HAND",
};

export function undoability(action: UndoableAction): { undoable: true; compensation: string } | { undoable: false; reason: string } {
  if (action.compensatedByActionId) return { undoable: false, reason: "already undone" };
  if (action.compensatesActionId) return { undoable: false, reason: "this action is itself an undo; perform the original action again instead" };
  const c = COMPENSATIONS[action.type as CommandType];
  if (!c) return { undoable: false, reason: `${action.type} cannot be undone automatically` };
  return { undoable: true, compensation: c };
}
