import { z } from "zod";
import { REGISTRATION_SOURCES } from "../enums.js";
import type { Permission } from "../permissions.js";

// Every critical tournament mutation is an explicit command (spec §42, §85).
// Envelope: { type, payload, expectedVersion, clientOperationId }.

const Empty = z.strictObject({}).default({});
const Reason = z.string().trim().min(3).max(500);
const LevelIndex = z.number().int().min(0).max(500);

const SeatRef = z.object({ tableId: z.uuid(), seatNumber: z.number().int().min(1).max(11) });
const SeatTarget = z.union([z.literal("AUTO"), z.literal("NONE"), SeatRef]);

export const PlannedMove = z.object({
  entryId: z.uuid(),
  fromTableId: z.uuid().nullable(),
  fromSeatNumber: z.number().int().min(1).max(11).nullable(),
  toTableId: z.uuid(),
  toSeatNumber: z.number().int().min(1).max(11),
});
export type PlannedMove = z.infer<typeof PlannedMove>;

export const COMMAND_PAYLOADS = {
  // --- lifecycle -----------------------------------------------------------
  PUBLISH: Empty,
  UNPUBLISH: Empty,
  OPEN_REGISTRATION: Empty,
  START_SEATING: z.object({ draw: z.boolean().default(true) }).default({ draw: true }),
  START_TOURNAMENT: Empty,
  FINISH_TOURNAMENT: z
    .object({
      /** Remaining active entries in finishing order (1st first) — required when more than one player remains (deal). */
      finalOrder: z.array(z.uuid()).max(20).optional(),
    })
    .default({}),
  REOPEN_TOURNAMENT: z.object({ reason: Reason }),
  CANCEL_TOURNAMENT: z.object({ reason: Reason }),
  CLOSE_LATE_REGISTRATION: Empty,
  REOPEN_LATE_REGISTRATION: Empty,
  START_HAND_FOR_HAND: Empty,
  END_HAND_FOR_HAND: Empty,
  // --- clock ---------------------------------------------------------------
  PAUSE_CLOCK: Empty,
  RESUME_CLOCK: Empty,
  // `fromLevelIndex`: the level the operator was looking at. If the clock has
  // auto-advanced meanwhile the command is rejected instead of skipping a level.
  NEXT_LEVEL: z.object({ fromLevelIndex: LevelIndex.optional() }).default({}),
  PREVIOUS_LEVEL: z.object({ fromLevelIndex: LevelIndex.optional() }).default({}),
  SET_LEVEL: z.object({ levelIndex: LevelIndex }),
  ADJUST_CLOCK: z.object({ deltaSeconds: z.number().int().min(-6 * 3600).max(6 * 3600), fromLevelIndex: LevelIndex.optional() }),
  SET_REMAINING: z.object({ remainingSeconds: z.number().int().min(0).max(6 * 3600), fromLevelIndex: LevelIndex.optional() }),
  // --- registration --------------------------------------------------------
  REGISTER_PLAYER: z.object({
    playerId: z.uuid(),
    source: z.enum(REGISTRATION_SOURCES).default("STAFF"),
    reserveOnly: z.boolean().default(false),
  }),
  CANCEL_REGISTRATION: z.object({ registrationId: z.uuid(), reason: z.string().trim().max(500).optional() }),
  CHECK_IN: z.object({
    registrationId: z.uuid(),
    /** Create the initial entry (buy-in) at the same time. */
    createEntry: z.boolean().default(true),
    seat: SeatTarget.default("AUTO"),
  }),
  UNDO_CHECK_IN: z.object({ registrationId: z.uuid() }),
  MARK_NO_SHOW: z.object({ registrationId: z.uuid() }),
  PROMOTE_WAITLIST: z.object({ registrationId: z.uuid() }),
  // --- entries -------------------------------------------------------------
  CREATE_ENTRY: z.object({ registrationId: z.uuid(), seat: SeatTarget.default("AUTO") }),
  REBUY: z.object({ entryId: z.uuid() }),
  ADD_ON: z.object({ entryId: z.uuid() }),
  CHIP_ADJUSTMENT: z.object({ entryId: z.uuid(), chips: z.number().int().min(-1e9).max(1e9), reason: Reason }),
  VOID_TRANSACTION: z.object({ transactionId: z.uuid(), reason: Reason }),
  VOID_ENTRY: z.object({ entryId: z.uuid(), reason: Reason }),
  // --- tables & seats ------------------------------------------------------
  ADD_TABLES: z.object({ count: z.number().int().min(1).max(100), capacity: z.number().int().min(2).max(11).optional() }),
  CLOSE_TABLE: z.object({ tableId: z.uuid() }),
  SET_SEAT_LOCK: z.object({ tableId: z.uuid(), seatNumber: z.number().int().min(1).max(11), locked: z.boolean(), reason: z.string().max(200).optional() }),
  SET_DEALER_BUTTON: z.object({ tableId: z.uuid(), seatNumber: z.number().int().min(1).max(11).nullable() }),
  /** Either apply a previewed plan (`moves`) or let the server draw now (`generate`), creating tables as needed. */
  APPLY_INITIAL_SEATING: z
    .object({ moves: z.array(PlannedMove).max(5000).optional(), generate: z.boolean().default(false) })
    .refine((v) => v.generate || (v.moves && v.moves.length > 0), "provide moves or set generate"),
  ASSIGN_SEAT: z.object({ entryId: z.uuid(), seat: SeatTarget.default("AUTO") }),
  MOVE_PLAYER: z.object({
    entryId: z.uuid(),
    fromTableId: z.uuid(),
    fromSeatNumber: z.number().int().min(1).max(11),
    toTableId: z.uuid(),
    toSeatNumber: z.number().int().min(1).max(11),
    reason: z.enum(["MANUAL", "CORRECTION"]).default("MANUAL"),
  }),
  APPLY_BALANCE: z.object({ moves: z.array(PlannedMove).min(1).max(200) }),
  BREAK_TABLE: z.object({ tableId: z.uuid(), moves: z.array(PlannedMove).max(20) }),
  // --- eliminations & corrections -------------------------------------------
  ELIMINATE_PLAYERS: z.object({
    /** Entries busted in the same hand, ordered by stack at start of hand (largest first). */
    entryIds: z.array(z.uuid()).min(1).max(20),
    eliminatedByEntryId: z.uuid().nullish(),
  }),
  RESTORE_PLAYER: z.object({ entryId: z.uuid(), reason: Reason }),
  UNDO_ACTION: z.object({ actionId: z.uuid(), reason: Reason }),
  // --- results -------------------------------------------------------------
  FINALIZE_RESULTS: Empty,
  CORRECT_RESULT: z.object({ playerId: z.uuid(), position: z.number().int().min(1).max(5000), reason: Reason }),
  // --- dealer --------------------------------------------------------------
  DEALER_MARK_PRESENT: z.object({ tableId: z.uuid(), seatNumber: z.number().int().min(1).max(11), present: z.boolean() }),
  DEALER_REQUEST_FLOOR: z.object({ tableId: z.uuid(), message: z.string().trim().max(300).optional() }),
  DEALER_REPORT_BUST: z.object({ tableId: z.uuid(), seatNumber: z.number().int().min(1).max(11) }),
  DEALER_CONFIRM_MOVEMENT: z.object({ movementId: z.uuid() }),
  RESOLVE_FLOOR_REQUEST: z.object({ requestId: z.uuid(), resolution: z.enum(["ACKNOWLEDGED", "RESOLVED"]) }),
} as const;

export type CommandType = keyof typeof COMMAND_PAYLOADS;
export const COMMAND_TYPES = Object.keys(COMMAND_PAYLOADS) as CommandType[];

export type CommandPayload<T extends CommandType> = z.infer<(typeof COMMAND_PAYLOADS)[T]>;

const envelope = <T extends CommandType>(type: T) =>
  z.object({
    type: z.literal(type),
    payload: COMMAND_PAYLOADS[type],
    expectedVersion: z.number().int().min(0),
    clientOperationId: z.uuid(),
  });

export const TournamentCommand = z.discriminatedUnion(
  "type",
  COMMAND_TYPES.map((t) => envelope(t)) as unknown as [ReturnType<typeof envelope>, ...ReturnType<typeof envelope>[]],
);

export type TournamentCommand = {
  [T in CommandType]: {
    type: T;
    payload: CommandPayload<T>;
    expectedVersion: number;
    clientOperationId: string;
  };
}[CommandType];

export type CommandOf<T extends CommandType> = Extract<TournamentCommand, { type: T }>;

/**
 * Concurrency policy per command:
 *  STRICT  — expectedVersion must equal the current tournament version
 *            (plan-based commands computed from a snapshot).
 *  REBASE  — accepted on a newer version when no action since expectedVersion
 *            touched the same entities (see OperationalAction.affectedKeys).
 */
export const COMMAND_CONCURRENCY: Record<CommandType, "STRICT" | "REBASE"> = {
  PUBLISH: "REBASE",
  UNPUBLISH: "REBASE",
  OPEN_REGISTRATION: "REBASE",
  START_SEATING: "STRICT",
  START_TOURNAMENT: "REBASE",
  FINISH_TOURNAMENT: "STRICT",
  REOPEN_TOURNAMENT: "STRICT",
  CANCEL_TOURNAMENT: "STRICT",
  CLOSE_LATE_REGISTRATION: "REBASE",
  REOPEN_LATE_REGISTRATION: "REBASE",
  START_HAND_FOR_HAND: "REBASE",
  END_HAND_FOR_HAND: "REBASE",
  PAUSE_CLOCK: "REBASE",
  RESUME_CLOCK: "REBASE",
  NEXT_LEVEL: "REBASE",
  PREVIOUS_LEVEL: "REBASE",
  SET_LEVEL: "REBASE",
  ADJUST_CLOCK: "REBASE",
  SET_REMAINING: "REBASE",
  REGISTER_PLAYER: "REBASE",
  CANCEL_REGISTRATION: "REBASE",
  CHECK_IN: "REBASE",
  UNDO_CHECK_IN: "REBASE",
  MARK_NO_SHOW: "REBASE",
  PROMOTE_WAITLIST: "REBASE",
  CREATE_ENTRY: "REBASE",
  REBUY: "REBASE",
  ADD_ON: "REBASE",
  CHIP_ADJUSTMENT: "REBASE",
  VOID_TRANSACTION: "REBASE",
  VOID_ENTRY: "REBASE",
  ADD_TABLES: "REBASE",
  CLOSE_TABLE: "REBASE",
  SET_SEAT_LOCK: "REBASE",
  SET_DEALER_BUTTON: "REBASE",
  APPLY_INITIAL_SEATING: "STRICT",
  ASSIGN_SEAT: "REBASE",
  MOVE_PLAYER: "REBASE",
  APPLY_BALANCE: "STRICT",
  BREAK_TABLE: "STRICT",
  ELIMINATE_PLAYERS: "REBASE",
  RESTORE_PLAYER: "REBASE",
  UNDO_ACTION: "REBASE",
  FINALIZE_RESULTS: "STRICT",
  CORRECT_RESULT: "REBASE",
  DEALER_MARK_PRESENT: "REBASE",
  DEALER_REQUEST_FLOOR: "REBASE",
  DEALER_REPORT_BUST: "REBASE",
  DEALER_CONFIRM_MOVEMENT: "REBASE",
  RESOLVE_FLOOR_REQUEST: "REBASE",
};

/** Permission required to issue each command. */
export const COMMAND_PERMISSIONS: Record<CommandType, Permission> = {
  PUBLISH: "tournament.publish",
  UNPUBLISH: "tournament.publish",
  OPEN_REGISTRATION: "tournament.publish",
  START_SEATING: "tournament.start",
  START_TOURNAMENT: "tournament.start",
  FINISH_TOURNAMENT: "tournament.finalize",
  REOPEN_TOURNAMENT: "tournament.finalize",
  CANCEL_TOURNAMENT: "tournament.cancel",
  CLOSE_LATE_REGISTRATION: "tournament.clock.control",
  REOPEN_LATE_REGISTRATION: "tournament.clock.control",
  START_HAND_FOR_HAND: "tournament.clock.control",
  END_HAND_FOR_HAND: "tournament.clock.control",
  PAUSE_CLOCK: "tournament.clock.control",
  RESUME_CLOCK: "tournament.clock.control",
  NEXT_LEVEL: "tournament.clock.control",
  PREVIOUS_LEVEL: "tournament.clock.control",
  SET_LEVEL: "tournament.clock.control",
  ADJUST_CLOCK: "tournament.clock.control",
  SET_REMAINING: "tournament.clock.control",
  REGISTER_PLAYER: "registration.create",
  CANCEL_REGISTRATION: "registration.cancel",
  CHECK_IN: "registration.checkin",
  UNDO_CHECK_IN: "registration.checkin",
  MARK_NO_SHOW: "registration.checkin",
  PROMOTE_WAITLIST: "registration.create",
  CREATE_ENTRY: "entry.create",
  REBUY: "entry.rebuy",
  ADD_ON: "entry.rebuy",
  CHIP_ADJUSTMENT: "entry.rebuy",
  VOID_TRANSACTION: "entry.void",
  VOID_ENTRY: "entry.void",
  ADD_TABLES: "table.manage",
  CLOSE_TABLE: "table.manage",
  SET_SEAT_LOCK: "table.manage",
  SET_DEALER_BUTTON: "table.manage",
  APPLY_INITIAL_SEATING: "seat.assign",
  ASSIGN_SEAT: "seat.assign",
  MOVE_PLAYER: "seat.move",
  APPLY_BALANCE: "seat.move",
  BREAK_TABLE: "table.break",
  ELIMINATE_PLAYERS: "player.eliminate",
  RESTORE_PLAYER: "player.restore",
  UNDO_ACTION: "player.restore",
  FINALIZE_RESULTS: "tournament.finalize",
  CORRECT_RESULT: "results.correct",
  DEALER_MARK_PRESENT: "dealer.table.operate",
  DEALER_REQUEST_FLOOR: "dealer.table.operate",
  DEALER_REPORT_BUST: "dealer.table.operate",
  DEALER_CONFIRM_MOVEMENT: "dealer.table.operate",
  RESOLVE_FLOOR_REQUEST: "seat.move",
};

/** Commands where the actor's `reentry` flavour needs an extra permission check. */
export const REENTRY_PERMISSION: Permission = "entry.reentry";
