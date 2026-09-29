// Read models: full staff snapshot and the public projection used by TV
// displays and player live pages (no personal data beyond display names).

import {
  announcements,
  floorRequests,
  organizationSettings,
  organizations,
  tournamentResults,
  tournamentTables,
  players,
  venues,
  type Executor,
} from "@pcos/db";
import {
  DEFAULT_FEATURE_FLAGS,
  type AnnouncementView,
  type FeatureFlags,
  type FloorRequestView,
  type PublicLiveSnapshot,
  type TournamentSnapshot,
  type TournamentStatus,
} from "@pcos/types";
import { deriveClock, isLateRegistrationOpen, isLive } from "@pcos/domain";
import { and, asc, desc, eq, gt, isNull, ne, or } from "drizzle-orm";
import { computeTournamentStats } from "./stats.js";
import {
  anchorFromRow,
  iso,
  levelLikes,
  policies,
  type ClockRow,
  type LevelRow,
  loadClockRow,
  loadEntries,
  loadLevels,
  loadRegistrations,
  loadSeatingState,
  loadTransactions,
  toClockView,
  toDetailView,
  toEntryViews,
  toLevelView,
  toRegistrationView,
  toTableViews,
  type TournamentRow,
} from "./repo.js";

/** Late registration as the rules evaluate it right now (level/time based closing included). */
export function lateRegistrationOpenNow(t: TournamentRow, levels: readonly LevelRow[], clock: ClockRow, nowMs: number): boolean {
  if (t.status === "REGISTRATION_OPEN") return true;
  // Not yet open (draft/scheduled) or already over.
  if (t.status !== "SEATING" && !isLive(t.status as TournamentStatus)) return false;
  return isLateRegistrationOpen({
    status: t.status as TournamentStatus,
    policy: policies(t).lateReg,
    manuallyClosed: t.lateRegistrationClosed,
    clock: deriveClock(anchorFromRow(clock), levelLikes(levels), nowMs),
    now: nowMs,
  });
}

export async function orgFlags(db: Executor, organizationId: string): Promise<FeatureFlags> {
  const [s] = await db.select().from(organizationSettings).where(eq(organizationSettings.organizationId, organizationId));
  return { ...DEFAULT_FEATURE_FLAGS, ...((s?.featureFlags ?? {}) as Partial<FeatureFlags>) };
}

export async function loadAnnouncements(db: Executor, t: Pick<TournamentRow, "id" | "venueId">, now: Date, limit = 20): Promise<AnnouncementView[]> {
  const rows = await db
    .select()
    .from(announcements)
    .where(
      and(
        or(eq(announcements.tournamentId, t.id), and(isNull(announcements.tournamentId), eq(announcements.venueId, t.venueId))),
        or(isNull(announcements.displayUntil), gt(announcements.displayUntil, new Date(now.getTime() - 3600_000))),
      ),
    )
    .orderBy(desc(announcements.createdAt))
    .limit(limit);
  return rows.map((a) => ({
    id: a.id,
    tournamentId: a.tournamentId,
    venueId: a.venueId,
    body: a.body,
    severity: a.severity as AnnouncementView["severity"],
    channels: a.channels,
    createdAt: a.createdAt.toISOString(),
    displayUntil: iso(a.displayUntil),
  }));
}

export async function buildSnapshot(db: Executor, t: TournamentRow, now: Date): Promise<TournamentSnapshot> {
  const flags = await orgFlags(db, t.organizationId);
  const levels = await loadLevels(db, t.structureId);
  const clock = await loadClockRow(db, t.id);
  const seating = await loadSeatingState(db, t.id);
  const regs = await loadRegistrations(db, t.id);
  const entries = await loadEntries(db, t.id);
  const txs = await loadTransactions(db, t.id);
  const stats = await computeTournamentStats(db, t, flags);
  const requests = await db
    .select({ r: floorRequests, tableNumber: tournamentTables.tableNumber })
    .from(floorRequests)
    .innerJoin(tournamentTables, eq(tournamentTables.id, floorRequests.tableId))
    .where(and(eq(floorRequests.tournamentId, t.id), ne(floorRequests.status, "RESOLVED")))
    .orderBy(asc(floorRequests.createdAt));
  const floor: FloorRequestView[] = requests.map(({ r, tableNumber }) => ({
    id: r.id,
    tableId: r.tableId,
    tableNumber,
    kind: r.kind as FloorRequestView["kind"],
    seatNumber: r.seatNumber,
    message: r.message,
    status: r.status as FloorRequestView["status"],
    createdAt: r.createdAt.toISOString(),
  }));
  return {
    tournament: toDetailView(t, stats.registrations),
    clock: toClockView(clock),
    levels: levels.map(toLevelView),
    stats,
    tables: toTableViews(seating),
    registrations: regs.map(toRegistrationView),
    entries: toEntryViews(entries, txs, seating),
    floorRequests: floor,
    announcements: await loadAnnouncements(db, t, now),
    serverTime: now.toISOString(),
  };
}

export async function buildPublicSnapshot(
  db: Executor,
  t: TournamentRow,
  now: Date,
  viewer: { playerId: string | null; forceSeating?: boolean } = { playerId: null },
): Promise<PublicLiveSnapshot> {
  const flags = await orgFlags(db, t.organizationId);
  const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, t.organizationId));
  const [venue] = await db.select({ name: venues.name }).from(venues).where(eq(venues.id, t.venueId));
  const levels = await loadLevels(db, t.structureId);
  const clock = await loadClockRow(db, t.id);
  const stats = await computeTournamentStats(db, t, flags);
  const seating = await loadSeatingState(db, t.id);
  const tableNumber = new Map(seating.tables.map((x) => [x.id, x.tableNumber]));

  const showSeating = flags.publicSeatList || viewer.forceSeating === true;
  const seatList = showSeating
    ? seating.assignments
        .map((a) => ({ playerName: a.playerName, tableNumber: tableNumber.get(a.tableId) ?? 0, seatNumber: a.seatNumber }))
        .sort((a, b) => a.playerName.localeCompare(b.playerName))
    : null;

  let results: { position: number; playerName: string }[];
  const finalRows = await db
    .select({ position: tournamentResults.position, playerName: players.displayName })
    .from(tournamentResults)
    .innerJoin(players, eq(players.id, tournamentResults.playerId))
    .where(eq(tournamentResults.tournamentId, t.id))
    .orderBy(asc(tournamentResults.position))
    .limit(100);
  if (finalRows.length > 0) results = finalRows;
  else {
    const entries = await loadEntries(db, t.id);
    results = entries
      .filter((e) => e.e.status === "ELIMINATED" && e.e.finishPosition != null)
      .map((e) => ({ position: e.e.finishPosition!, playerName: e.playerName }))
      .sort((a, b) => a.position - b.position);
  }

  let mySeat: PublicLiveSnapshot["mySeat"] = null;
  let myRegistration: PublicLiveSnapshot["myRegistration"] = null;
  if (viewer.playerId) {
    const a = seating.assignments.find((x) => x.playerId === viewer.playerId);
    if (a) mySeat = { tableNumber: tableNumber.get(a.tableId) ?? 0, seatNumber: a.seatNumber };
    const regs = await loadRegistrations(db, t.id);
    const mine = regs.filter((r) => r.r.playerId === viewer.playerId).sort((x, y) => y.r.registeredAt.getTime() - x.r.registeredAt.getTime())[0];
    if (mine) myRegistration = { status: mine.r.status as NonNullable<PublicLiveSnapshot["myRegistration"]>["status"], checkInCode: mine.r.checkInCode };
  }

  return {
    tournament: {
      id: t.id,
      name: t.name,
      status: t.status as PublicLiveSnapshot["tournament"]["status"],
      format: t.format as PublicLiveSnapshot["tournament"]["format"],
      gameType: t.gameType as PublicLiveSnapshot["tournament"]["gameType"],
      startAt: t.startAt.toISOString(),
      startingStack: t.startingStack,
      buyIn: t.buyIn ?? null,
      lateRegistrationClosed: t.lateRegistrationClosed,
      registrationOpen: lateRegistrationOpenNow(t, levels, clock, now.getTime()),
      version: t.version,
      venueName: venue?.name ?? "",
      organizationName: org?.name ?? "",
    },
    clock: toClockView(clock),
    levels: levels.map(toLevelView),
    stats: { ...stats, prizePool: flags.prizeTracking ? stats.prizePool : null },
    announcements: (await loadAnnouncements(db, t, now)).filter((a) => a.channels.includes("PLAYER_LIVE") || a.channels.includes("DISPLAY")),
    seating: seatList,
    results,
    mySeat,
    myRegistration,
    serverTime: now.toISOString(),
  };
}
