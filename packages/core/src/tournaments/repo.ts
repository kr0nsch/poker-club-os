// Data access helpers for the live tournament engine: loading rows and mapping
// them to domain structures and read models.

import {
  entryTransactions,
  players,
  structureLevels,
  tournamentClockStates,
  tournamentEntries,
  tournamentRegistrations,
  tournaments,
  tournamentSeatAssignments,
  tournamentSeatLocks,
  tournamentTables,
  type Executor,
} from "@pcos/db";
import type { ClockAnchor, SeatingTable } from "@pcos/domain";
import type {
  AddonPolicy,
  BountyPolicy,
  ClockView,
  EntryView,
  HouseRulesConfig,
  LateRegistrationPolicy,
  LevelView,
  RebuyPolicy,
  ReentryPolicy,
  RegistrationView,
  TableView,
  TournamentDetailView,
  TournamentStatus,
  TournamentSummaryView,
} from "@pcos/types";
import { and, asc, eq, inArray, ne } from "drizzle-orm";

export type TournamentRow = typeof tournaments.$inferSelect;
export type LevelRow = typeof structureLevels.$inferSelect;
export type ClockRow = typeof tournamentClockStates.$inferSelect;
export type EntryRow = typeof tournamentEntries.$inferSelect;
export type RegistrationRow = typeof tournamentRegistrations.$inferSelect;
export type TableRow = typeof tournamentTables.$inferSelect;
export type AssignmentRow = typeof tournamentSeatAssignments.$inferSelect;
export type TransactionRow = typeof entryTransactions.$inferSelect;

export const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

// --- tournament ------------------------------------------------------------------

export function policies(t: TournamentRow) {
  return {
    lateReg: t.lateRegistrationPolicy as LateRegistrationPolicy,
    reentry: t.reentryPolicy as ReentryPolicy,
    rebuy: t.rebuyPolicy as RebuyPolicy,
    addon: t.addonPolicy as AddonPolicy,
    bounty: t.bountyPolicy as BountyPolicy,
    houseRules: t.houseRules as HouseRulesConfig,
  };
}

export function toSummaryView(t: TournamentRow, registrationCount: number): TournamentSummaryView {
  return {
    id: t.id,
    organizationId: t.organizationId,
    venueId: t.venueId,
    name: t.name,
    slug: t.slug,
    status: t.status as TournamentStatus,
    format: t.format as TournamentSummaryView["format"],
    gameType: t.gameType as TournamentSummaryView["gameType"],
    startAt: t.startAt.toISOString(),
    published: t.published,
    publicVisibility: t.publicVisibility as TournamentSummaryView["publicVisibility"],
    maxPlayers: t.maxPlayers,
    registrationCount,
    buyIn: t.buyIn ?? null,
    version: t.version,
  };
}

export function toDetailView(t: TournamentRow, registrationCount: number): TournamentDetailView {
  const p = policies(t);
  return {
    ...toSummaryView(t, registrationCount),
    description: t.description,
    startingStack: t.startingStack,
    tableSize: t.tableSize,
    expectedPlayers: t.expectedPlayers,
    registrationOpenAt: iso(t.registrationOpenAt),
    registrationCloseAt: iso(t.registrationCloseAt),
    lateRegistrationPolicy: p.lateReg,
    reentryPolicy: p.reentry,
    rebuyPolicy: p.rebuy,
    addonPolicy: p.addon,
    bountyPolicy: p.bounty,
    lateRegistrationClosed: t.lateRegistrationClosed,
    structureId: t.structureId,
    templateId: t.templateId,
    seriesId: t.seriesId,
    seasonId: t.seasonId,
    houseRules: p.houseRules,
    houseRulesProfileId: t.houseRulesProfileId,
    pausedFromStatus: (t.pausedFromStatus as TournamentStatus | null) ?? null,
    startedAt: iso(t.startedAt),
    finishedAt: iso(t.finishedAt),
    finalizedAt: iso(t.finalizedAt),
    cancelledAt: iso(t.cancelledAt),
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

// --- levels & clock ---------------------------------------------------------------

export async function loadLevels(db: Executor, structureId: string): Promise<LevelRow[]> {
  return db.select().from(structureLevels).where(eq(structureLevels.structureId, structureId)).orderBy(asc(structureLevels.position));
}

export function toLevelView(l: LevelRow, index: number): LevelView {
  return {
    id: l.id,
    index,
    type: l.type as LevelView["type"],
    smallBlind: l.smallBlind,
    bigBlind: l.bigBlind,
    ante: l.ante,
    anteType: l.anteType as LevelView["anteType"],
    durationSeconds: l.durationSeconds,
    label: l.label,
    note: l.note,
  };
}

export const levelLikes = (levels: readonly LevelRow[]) =>
  levels.map((l) => ({ type: l.type as "PLAY" | "BREAK", durationSeconds: l.durationSeconds }));

export async function loadClockRow(db: Executor, tournamentId: string): Promise<ClockRow> {
  const [row] = await db.select().from(tournamentClockStates).where(eq(tournamentClockStates.tournamentId, tournamentId));
  if (row) return row;
  const [created] = await db.insert(tournamentClockStates).values({ tournamentId }).onConflictDoNothing().returning();
  if (created) return created;
  const [again] = await db.select().from(tournamentClockStates).where(eq(tournamentClockStates.tournamentId, tournamentId));
  return again!;
}

export function anchorFromRow(r: ClockRow): ClockAnchor {
  return {
    status: r.clockStatus as ClockAnchor["status"],
    levelIndex: r.currentLevelIndex,
    startedAt: r.startedAt ? r.startedAt.getTime() : null,
    pausedAt: r.pausedAt ? r.pausedAt.getTime() : null,
    remainingAtPauseMs: r.remainingAtPauseMs ?? null,
  };
}

export function rowFromAnchor(a: ClockAnchor, levels: readonly LevelRow[]) {
  return {
    clockStatus: a.status,
    currentLevelIndex: a.levelIndex,
    currentLevelId: levels[a.levelIndex]?.id ?? null,
    startedAt: a.startedAt != null ? new Date(a.startedAt) : null,
    pausedAt: a.pausedAt != null ? new Date(a.pausedAt) : null,
    remainingAtPauseMs: a.remainingAtPauseMs != null ? Math.round(a.remainingAtPauseMs) : null,
  };
}

export function toClockView(r: Pick<ClockRow, "clockStatus" | "currentLevelIndex" | "currentLevelId" | "startedAt" | "pausedAt" | "remainingAtPauseMs" | "version">): ClockView {
  return {
    status: r.clockStatus as ClockView["status"],
    levelIndex: r.currentLevelIndex,
    levelId: r.currentLevelId,
    startedAt: iso(r.startedAt),
    pausedAt: iso(r.pausedAt),
    remainingAtPauseMs: r.remainingAtPauseMs ?? null,
    version: r.version,
  };
}

// --- tables & seats --------------------------------------------------------------------

export interface SeatingState {
  tables: TableRow[];
  assignments: (AssignmentRow & { playerName: string })[];
  locks: (typeof tournamentSeatLocks.$inferSelect)[];
  seating: SeatingTable[];
}

// Queries run sequentially: inside a transaction they share one connection.
export async function loadSeatingState(db: Executor, tournamentId: string): Promise<SeatingState> {
  const tables = await db.select().from(tournamentTables).where(eq(tournamentTables.tournamentId, tournamentId)).orderBy(asc(tournamentTables.tableNumber));
  const assignments = await db
    .select({ a: tournamentSeatAssignments, playerName: players.displayName })
    .from(tournamentSeatAssignments)
    .innerJoin(players, eq(players.id, tournamentSeatAssignments.playerId))
    .where(and(eq(tournamentSeatAssignments.tournamentId, tournamentId), eq(tournamentSeatAssignments.status, "ACTIVE")));
  const locks = await db.select().from(tournamentSeatLocks).where(eq(tournamentSeatLocks.tournamentId, tournamentId));
  const flat = assignments.map((r) => ({ ...r.a, playerName: r.playerName }));
  const seating: SeatingTable[] = tables.map((t) => ({
    id: t.id,
    tableNumber: t.tableNumber,
    capacity: t.capacity,
    status: t.status as SeatingTable["status"],
    seats: new Map(flat.filter((a) => a.tableId === t.id).map((a) => [a.seatNumber, a.entryId])),
    lockedSeats: new Set(locks.filter((l) => l.tableId === t.id).map((l) => l.seatNumber)),
    dealerButtonSeat: t.dealerButtonSeat,
  }));
  return { tables, assignments: flat, locks, seating };
}

export function toTableViews(state: SeatingState): TableView[] {
  return state.tables.map((t) => {
    const seats = [];
    for (let s = 1; s <= t.capacity; s++) {
      const a = state.assignments.find((x) => x.tableId === t.id && x.seatNumber === s);
      const lock = state.locks.find((l) => l.tableId === t.id && l.seatNumber === s);
      seats.push({
        seatNumber: s,
        assignmentId: a?.id ?? null,
        entryId: a?.entryId ?? null,
        playerId: a?.playerId ?? null,
        playerName: a?.playerName ?? null,
        present: a?.present ?? false,
        locked: !!lock,
        lockReason: lock?.reason ?? null,
      });
    }
    return {
      id: t.id,
      tableNumber: t.tableNumber,
      capacity: t.capacity,
      status: t.status as TableView["status"],
      dealerButtonSeat: t.dealerButtonSeat,
      occupied: seats.filter((s) => s.entryId).length,
      seats,
    };
  });
}

// --- registrations & entries -----------------------------------------------------------------

export async function loadRegistrations(db: Executor, tournamentId: string) {
  return db
    .select({ r: tournamentRegistrations, p: { displayName: players.displayName, nickname: players.nickname, memberNumber: players.memberNumber } })
    .from(tournamentRegistrations)
    .innerJoin(players, eq(players.id, tournamentRegistrations.playerId))
    .where(eq(tournamentRegistrations.tournamentId, tournamentId))
    .orderBy(asc(tournamentRegistrations.registeredAt));
}

export function toRegistrationView(row: Awaited<ReturnType<typeof loadRegistrations>>[number]): RegistrationView {
  const r = row.r;
  return {
    id: r.id,
    playerId: r.playerId,
    playerName: row.p.displayName,
    nickname: row.p.nickname,
    memberNumber: row.p.memberNumber,
    status: r.status as RegistrationView["status"],
    source: r.source as RegistrationView["source"],
    registeredAt: r.registeredAt.toISOString(),
    checkedInAt: iso(r.checkedInAt),
    cancelledAt: iso(r.cancelledAt),
    checkInCode: r.checkInCode,
    waitlistPosition: r.waitlistPosition,
  };
}

export async function loadEntries(db: Executor, tournamentId: string) {
  return db
    .select({ e: tournamentEntries, playerName: players.displayName })
    .from(tournamentEntries)
    .innerJoin(players, eq(players.id, tournamentEntries.playerId))
    .where(eq(tournamentEntries.tournamentId, tournamentId))
    .orderBy(asc(tournamentEntries.createdAt));
}

export async function loadTransactions(db: Executor, tournamentId: string): Promise<TransactionRow[]> {
  return db.select().from(entryTransactions).where(eq(entryTransactions.tournamentId, tournamentId)).orderBy(asc(entryTransactions.createdAt));
}

export function toEntryViews(
  entries: Awaited<ReturnType<typeof loadEntries>>,
  transactions: readonly TransactionRow[],
  seating: SeatingState,
): EntryView[] {
  return entries.map(({ e, playerName }) => {
    const tx = transactions.filter((t) => t.entryId === e.id && !t.voided && t.type !== "VOID");
    const seat = seating.assignments.find((a) => a.entryId === e.id);
    const table = seat ? seating.tables.find((t) => t.id === seat.tableId) : undefined;
    return {
      id: e.id,
      registrationId: e.registrationId,
      playerId: e.playerId,
      playerName,
      entryNumber: e.entryNumber,
      type: e.type as EntryView["type"],
      status: e.status as EntryView["status"],
      chips: tx.reduce((n, t) => n + t.chips, 0),
      rebuys: tx.filter((t) => t.type === "REBUY").length,
      addons: tx.filter((t) => t.type === "ADD_ON").length,
      tableId: seat?.tableId ?? null,
      tableNumber: table?.tableNumber ?? null,
      seatNumber: seat?.seatNumber ?? null,
      eliminatedAt: iso(e.eliminatedAt),
      finishPosition: e.finishPosition,
      eliminatedByEntryId: e.eliminatedByEntryId,
      version: e.version,
      createdAt: e.createdAt.toISOString(),
    };
  });
}

export async function countOccupyingRegistrations(db: Executor, tournamentId: string): Promise<number> {
  const rows = await db
    .select({ id: tournamentRegistrations.id })
    .from(tournamentRegistrations)
    .where(
      and(
        eq(tournamentRegistrations.tournamentId, tournamentId),
        inArray(tournamentRegistrations.status, ["RESERVED", "REGISTERED", "CHECKED_IN", "PLAYING", "ELIMINATED"]),
      ),
    );
  return rows.length;
}

export async function registrationCounts(db: Executor, tournamentIds: string[]): Promise<Map<string, number>> {
  if (tournamentIds.length === 0) return new Map();
  const rows = await db
    .select({ tournamentId: tournamentRegistrations.tournamentId })
    .from(tournamentRegistrations)
    .where(
      and(
        inArray(tournamentRegistrations.tournamentId, tournamentIds),
        ne(tournamentRegistrations.status, "CANCELLED"),
        ne(tournamentRegistrations.status, "WAITLISTED"),
        ne(tournamentRegistrations.status, "NO_SHOW"),
      ),
    );
  const out = new Map<string, number>();
  for (const r of rows) out.set(r.tournamentId, (out.get(r.tournamentId) ?? 0) + 1);
  return out;
}

export async function lockTournament(db: Executor, tournamentId: string, organizationId: string | null): Promise<TournamentRow | undefined> {
  const where = organizationId ? and(eq(tournaments.id, tournamentId), eq(tournaments.organizationId, organizationId)) : eq(tournaments.id, tournamentId);
  const [row] = await db.select().from(tournaments).where(where).for("update");
  return row;
}
