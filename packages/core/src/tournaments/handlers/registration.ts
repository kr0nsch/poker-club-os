import { players, tournamentEntries, tournamentRegistrations } from "@pcos/db";
import { decideNewEntry, isLateRegistrationOpen, isLive, ruleViolation } from "@pcos/domain";
import { ACTIVE_REGISTRATION_STATUSES, type EntryStatus, type RegistrationStatus, type TournamentFormat, type TournamentStatus } from "@pcos/types";
import { and, asc, eq, inArray, max } from "drizzle-orm";
import { randomCode } from "../../crypto.js";
import { AppError, forbidden, notFound } from "../../errors.js";
import type { CommandContext } from "../context.js";
import type { Handler } from "../executor.js";
import { createEntry, getRegistration, playerName, seatEntry, updateRegistrationStatus } from "../ops.js";
import { countOccupyingRegistrations, policies, type RegistrationRow } from "../repo.js";

const SELF_SERVICE_SOURCES = new Set(["PLAYER_WEB", "PLAYER_QR", "TELEGRAM", "TELEGRAM_MINI_APP", "KIOSK"]);

export function lateRegOpen(ctx: CommandContext): boolean {
  return isLateRegistrationOpen({
    status: ctx.tournament.status as TournamentStatus,
    policy: policies(ctx.tournament).lateReg,
    manuallyClosed: ctx.tournament.lateRegistrationClosed,
    clock: ctx.derived,
    now: ctx.nowMs,
  });
}

function assertOwnRegistration(ctx: CommandContext, playerId: string) {
  const p = ctx.actor.principal;
  if (p.kind === "player" && p.playerId !== playerId) throw forbidden("players can only manage their own registration");
}

/** Promote the oldest waitlisted registration when a place frees up. */
async function promoteFromWaitlist(ctx: CommandContext) {
  const limit = ctx.tournament.maxPlayers;
  if (limit == null) return null;
  const occupying = await countOccupyingRegistrations(ctx.tx, ctx.tournament.id);
  if (occupying >= limit) return null;
  const [next] = await ctx.tx
    .select()
    .from(tournamentRegistrations)
    .where(and(eq(tournamentRegistrations.tournamentId, ctx.tournament.id), eq(tournamentRegistrations.status, "WAITLISTED")))
    .orderBy(asc(tournamentRegistrations.waitlistPosition), asc(tournamentRegistrations.registeredAt))
    .limit(1);
  if (!next) return null;
  await updateRegistrationStatus(ctx, next, "REGISTERED", { waitlistPosition: null });
  ctx.audit({ entityType: "registration", entityId: next.id, action: "WAITLIST_PROMOTED", after: { playerId: next.playerId } });
  return next.id;
}

async function checkIn(ctx: CommandContext, reg: RegistrationRow) {
  if (reg.status !== "REGISTERED" && reg.status !== "RESERVED") {
    throw ruleViolation(`cannot check in a registration that is ${reg.status}`);
  }
  return updateRegistrationStatus(ctx, reg, "CHECKED_IN", { checkedInAt: ctx.now });
}

async function newEntryFor(ctx: CommandContext, reg: RegistrationRow) {
  const entries = await ctx.tx
    .select({ status: tournamentEntries.status })
    .from(tournamentEntries)
    .where(and(eq(tournamentEntries.tournamentId, ctx.tournament.id), eq(tournamentEntries.playerId, reg.playerId)))
    .orderBy(asc(tournamentEntries.entryNumber));
  const p = policies(ctx.tournament);
  const decision = decideNewEntry({
    status: ctx.tournament.status as TournamentStatus,
    policy: p.lateReg,
    manuallyClosed: ctx.tournament.lateRegistrationClosed,
    clock: ctx.derived,
    now: ctx.nowMs,
    format: ctx.tournament.format as TournamentFormat,
    reentryPolicy: p.reentry,
    playerEntries: entries.map((e) => ({ status: e.status as EntryStatus })),
    registrationStatus: (reg.status === "ELIMINATED" ? "PLAYING" : reg.status) as RegistrationStatus,
  });
  if (!decision.allowed) throw ruleViolation(decision.reason);
  if (decision.type === "REENTRY") ctx.require("entry.reentry");
  return createEntry(ctx, reg, decision.type);
}

export const registrationHandlers = {
  REGISTER_PLAYER: (async (ctx, payload) => {
    assertOwnRegistration(ctx, payload.playerId);
    const isPlayer = ctx.actor.principal.kind === "player";
    if (isPlayer) {
      if (!ctx.flags.playerRegistration) throw new AppError("FEATURE_DISABLED", "online registration is disabled");
      if (!SELF_SERVICE_SOURCES.has(payload.source)) throw forbidden("invalid registration source");
      if (!ctx.tournament.published || ctx.tournament.publicVisibility === "PRIVATE") throw notFound("tournament");
      if (ctx.tournament.status !== "REGISTRATION_OPEN" && !(isLive(ctx.tournament.status as TournamentStatus) && lateRegOpen(ctx))) {
        throw ruleViolation("registration is not open");
      }
    }
    if (isLive(ctx.tournament.status as TournamentStatus) && !lateRegOpen(ctx)) throw ruleViolation("late registration is closed");

    const [player] = await ctx.tx
      .select()
      .from(players)
      .where(and(eq(players.id, payload.playerId), eq(players.organizationId, ctx.tournament.organizationId)));
    if (!player) throw notFound("player");
    if (player.status === "BANNED") throw ruleViolation("player is banned");
    if (player.status === "MERGED") throw ruleViolation("player record was merged into another record");

    const [existing] = await ctx.tx
      .select({ id: tournamentRegistrations.id, status: tournamentRegistrations.status })
      .from(tournamentRegistrations)
      .where(
        and(
          eq(tournamentRegistrations.tournamentId, ctx.tournament.id),
          eq(tournamentRegistrations.playerId, payload.playerId),
          inArray(tournamentRegistrations.status, [...ACTIVE_REGISTRATION_STATUSES, "WAITLISTED"]),
        ),
      );
    if (existing) throw new AppError("DUPLICATE", `player is already registered (${existing.status})`, { details: { registrationId: existing.id } });

    const occupying = await countOccupyingRegistrations(ctx.tx, ctx.tournament.id);
    const full = ctx.tournament.maxPlayers != null && occupying >= ctx.tournament.maxPlayers;
    let waitlistPosition: number | null = null;
    if (full) {
      const [row] = await ctx.tx
        .select({ n: max(tournamentRegistrations.waitlistPosition) })
        .from(tournamentRegistrations)
        .where(eq(tournamentRegistrations.tournamentId, ctx.tournament.id));
      waitlistPosition = (row?.n ?? 0) + 1;
    }
    const status = full ? "WAITLISTED" : payload.reserveOnly ? "RESERVED" : "REGISTERED";
    const [reg] = await ctx.tx
      .insert(tournamentRegistrations)
      .values({
        organizationId: ctx.tournament.organizationId,
        tournamentId: ctx.tournament.id,
        playerId: payload.playerId,
        status,
        source: payload.source,
        checkInCode: randomCode(10),
        waitlistPosition,
        createdBy: ctx.actor.userId,
        registeredAt: ctx.now,
      })
      .returning();
    ctx.touch(`player:${payload.playerId}`, `registration:${reg!.id}`);
    ctx.emit({
      name: "registration.created",
      data: { registrationId: reg!.id, playerId: payload.playerId, playerName: player.displayName, status, source: payload.source, waitlistPosition },
      aggregateType: "registration",
      aggregateId: reg!.id,
    });
    ctx.statsChanged();
    ctx.summary(`${player.displayName} registered${full ? " (waitlist)" : ""}`);
    return { registrationId: reg!.id, status, waitlistPosition, checkInCode: reg!.checkInCode };
  }) satisfies Handler<"REGISTER_PLAYER">,

  CANCEL_REGISTRATION: (async (ctx, payload) => {
    const reg = await getRegistration(ctx, payload.registrationId);
    assertOwnRegistration(ctx, reg.playerId);
    const allowed: RegistrationStatus[] =
      ctx.actor.principal.kind === "player" ? ["RESERVED", "REGISTERED", "WAITLISTED"] : ["RESERVED", "REGISTERED", "WAITLISTED", "CHECKED_IN"];
    if (!allowed.includes(reg.status as RegistrationStatus)) {
      throw ruleViolation(reg.status === "PLAYING" ? "player has an entry; void the entry first" : `cannot cancel a registration that is ${reg.status}`);
    }
    await updateRegistrationStatus(ctx, reg, "CANCELLED", { cancelledAt: ctx.now, waitlistPosition: null });
    const promoted = await promoteFromWaitlist(ctx);
    ctx.summary(`Registration cancelled: ${await playerName(ctx, reg.playerId)}`);
    if (payload.reason) ctx.audit({ entityType: "registration", entityId: reg.id, action: "CANCEL_REASON", metadata: { reason: payload.reason } });
    return { previousStatus: reg.status, promotedRegistrationId: promoted };
  }) satisfies Handler<"CANCEL_REGISTRATION">,

  CHECK_IN: (async (ctx, payload) => {
    let reg = await getRegistration(ctx, payload.registrationId);
    reg = await checkIn(ctx, reg);
    let entry = null;
    let seat = null;
    if (payload.createEntry) {
      ctx.require("entry.create");
      entry = await newEntryFor(ctx, reg);
      seat = await seatEntry(ctx, entry.id, payload.seat, isLive(ctx.tournament.status as TournamentStatus) ? "LATE_REGISTRATION" : "INITIAL_SEATING");
    }
    const name = await playerName(ctx, reg.playerId);
    ctx.summary(`${name} checked in${seat ? ` → table ${seat.toTableNumber} seat ${seat.toSeatNumber}` : ""}`);
    return { registrationId: reg.id, entryId: entry?.id ?? null, seat: seat ? { tableId: seat.toTableId, tableNumber: seat.toTableNumber, seatNumber: seat.toSeatNumber } : null };
  }) satisfies Handler<"CHECK_IN">,

  UNDO_CHECK_IN: (async (ctx, payload) => {
    const reg = await getRegistration(ctx, payload.registrationId);
    if (reg.status !== "CHECKED_IN") throw ruleViolation(reg.status === "PLAYING" ? "player has an entry; void it or undo the check-in action" : `registration is ${reg.status}`);
    await updateRegistrationStatus(ctx, reg, "REGISTERED", { checkedInAt: null });
    ctx.summary(`Check-in undone: ${await playerName(ctx, reg.playerId)}`);
    return { registrationId: reg.id };
  }) satisfies Handler<"UNDO_CHECK_IN">,

  MARK_NO_SHOW: (async (ctx, payload) => {
    const reg = await getRegistration(ctx, payload.registrationId);
    if (reg.status !== "REGISTERED" && reg.status !== "RESERVED") throw ruleViolation(`cannot mark ${reg.status} registration as no-show`);
    await updateRegistrationStatus(ctx, reg, "NO_SHOW");
    const promoted = await promoteFromWaitlist(ctx);
    ctx.summary(`No-show: ${await playerName(ctx, reg.playerId)}`);
    return { previousStatus: reg.status, promotedRegistrationId: promoted };
  }) satisfies Handler<"MARK_NO_SHOW">,

  PROMOTE_WAITLIST: (async (ctx, payload) => {
    const reg = await getRegistration(ctx, payload.registrationId);
    if (reg.status !== "WAITLISTED") throw ruleViolation("registration is not on the waitlist");
    const occupying = await countOccupyingRegistrations(ctx.tx, ctx.tournament.id);
    const override = ctx.tournament.maxPlayers != null && occupying >= ctx.tournament.maxPlayers;
    await updateRegistrationStatus(ctx, reg, "REGISTERED", { waitlistPosition: null });
    if (override) ctx.audit({ entityType: "registration", entityId: reg.id, action: "CAPACITY_OVERRIDE", metadata: { occupying, maxPlayers: ctx.tournament.maxPlayers } });
    ctx.summary(`Promoted from waitlist: ${await playerName(ctx, reg.playerId)}`);
    return { registrationId: reg.id, capacityOverride: override };
  }) satisfies Handler<"PROMOTE_WAITLIST">,

  CREATE_ENTRY: (async (ctx, payload) => {
    let reg = await getRegistration(ctx, payload.registrationId);
    if (reg.status === "REGISTERED" || reg.status === "RESERVED") {
      ctx.require("registration.checkin");
      reg = await checkIn(ctx, reg);
    }
    const entry = await newEntryFor(ctx, reg);
    const seat = await seatEntry(ctx, entry.id, payload.seat, isLive(ctx.tournament.status as TournamentStatus) ? "LATE_REGISTRATION" : "INITIAL_SEATING");
    ctx.summary(`${entry.type === "REENTRY" ? "Re-entry" : "Entry"} #${entry.entryNumber}: ${await playerName(ctx, reg.playerId)}`);
    return {
      entryId: entry.id,
      type: entry.type,
      entryNumber: entry.entryNumber,
      seat: seat ? { tableId: seat.toTableId, tableNumber: seat.toTableNumber, seatNumber: seat.toSeatNumber } : null,
    };
  }) satisfies Handler<"CREATE_ENTRY">,
};
