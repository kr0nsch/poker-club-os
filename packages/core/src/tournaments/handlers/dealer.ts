import { devices, floorRequests, seatMovements, tournamentSeatAssignments, tournamentTables } from "@pcos/db";
import { ruleViolation } from "@pcos/domain";
import { topic } from "@pcos/types";
import { and, eq } from "drizzle-orm";
import { can } from "../../actor.js";
import { forbidden, notFound } from "../../errors.js";
import type { CommandContext } from "../context.js";
import type { Handler } from "../executor.js";

/**
 * Dealers without floor permissions may only operate the table assigned to
 * their device (when an assignment exists). Device identity is supplementary
 * to user authentication, never a replacement (spec §12).
 */
async function assertDealerTable(ctx: CommandContext, tableId: string) {
  const [table] = await ctx.tx
    .select()
    .from(tournamentTables)
    .where(and(eq(tournamentTables.id, tableId), eq(tournamentTables.tournamentId, ctx.tournament.id)));
  if (!table) throw notFound("table");
  if (can(ctx.actor, "seat.move") || !ctx.actor.deviceId) return table;
  const [device] = await ctx.tx
    .select({ assignedTableId: devices.assignedTableId })
    .from(devices)
    .where(and(eq(devices.organizationId, ctx.tournament.organizationId), eq(devices.deviceId, ctx.actor.deviceId)));
  if (device?.assignedTableId && device.assignedTableId !== tableId) throw forbidden("this device is assigned to another table");
  return table;
}

async function createFloorRequest(ctx: CommandContext, tableId: string, tableNumber: number, kind: "CALL_FLOOR" | "BUST_REPORT", seatNumber: number | null, message: string | null) {
  const [req] = await ctx.tx
    .insert(floorRequests)
    .values({
      organizationId: ctx.tournament.organizationId,
      tournamentId: ctx.tournament.id,
      tableId,
      kind,
      seatNumber,
      message,
      createdBy: ctx.actor.userId,
      deviceId: ctx.actor.deviceId,
      createdAt: ctx.now,
    })
    .returning();
  ctx.touch(`floor:${req!.id}`);
  ctx.emit({
    name: "floor.request.created",
    topics: [topic.table(tableId)],
    data: { requestId: req!.id, tableId, tableNumber, kind, seatNumber, message, createdAt: ctx.now.toISOString() },
    aggregateType: "floor_request",
    aggregateId: req!.id,
    syncable: false,
  });
  return req!;
}

export const dealerHandlers = {
  DEALER_MARK_PRESENT: (async (ctx, payload) => {
    await assertDealerTable(ctx, payload.tableId);
    const updated = await ctx.tx
      .update(tournamentSeatAssignments)
      .set({ present: payload.present })
      .where(
        and(
          eq(tournamentSeatAssignments.tableId, payload.tableId),
          eq(tournamentSeatAssignments.seatNumber, payload.seatNumber),
          eq(tournamentSeatAssignments.status, "ACTIVE"),
        ),
      )
      .returning();
    if (updated.length === 0) throw ruleViolation("seat is empty");
    ctx.touch(`presence:${payload.tableId}:${payload.seatNumber}`);
    ctx.emit({ name: "table.updated", topics: [topic.table(payload.tableId)], data: { tableId: payload.tableId, seatNumber: payload.seatNumber, present: payload.present }, syncable: false });
    ctx.summary(`Seat ${payload.seatNumber} marked ${payload.present ? "present" : "absent"}`);
    return { entryId: updated[0]!.entryId };
  }) satisfies Handler<"DEALER_MARK_PRESENT">,

  DEALER_REQUEST_FLOOR: (async (ctx, payload) => {
    const table = await assertDealerTable(ctx, payload.tableId);
    const req = await createFloorRequest(ctx, table.id, table.tableNumber, "CALL_FLOOR", null, payload.message ?? null);
    ctx.summary(`Floor called to table ${table.tableNumber}`);
    return { requestId: req.id };
  }) satisfies Handler<"DEALER_REQUEST_FLOOR">,

  DEALER_REPORT_BUST: (async (ctx, payload) => {
    const table = await assertDealerTable(ctx, payload.tableId);
    const [seat] = await ctx.tx
      .select()
      .from(tournamentSeatAssignments)
      .where(
        and(
          eq(tournamentSeatAssignments.tableId, table.id),
          eq(tournamentSeatAssignments.seatNumber, payload.seatNumber),
          eq(tournamentSeatAssignments.status, "ACTIVE"),
        ),
      );
    if (!seat) throw ruleViolation("seat is empty");
    // A dealer report is a request; the floor/TD confirms the elimination (spec §61).
    const req = await createFloorRequest(ctx, table.id, table.tableNumber, "BUST_REPORT", payload.seatNumber, `entry:${seat.entryId}`);
    ctx.summary(`Bust reported at table ${table.tableNumber} seat ${payload.seatNumber}`);
    return { requestId: req.id, entryId: seat.entryId };
  }) satisfies Handler<"DEALER_REPORT_BUST">,

  DEALER_CONFIRM_MOVEMENT: (async (ctx, payload) => {
    const [m] = await ctx.tx
      .select()
      .from(seatMovements)
      .where(and(eq(seatMovements.id, payload.movementId), eq(seatMovements.tournamentId, ctx.tournament.id)));
    if (!m) throw notFound("movement");
    if (m.toTableId) await assertDealerTable(ctx, m.toTableId);
    if (m.confirmedAt) return { movementId: m.id, alreadyConfirmed: true };
    await ctx.tx.update(seatMovements).set({ confirmedAt: ctx.now }).where(eq(seatMovements.id, m.id));
    ctx.touch(`movement:${m.id}`);
    ctx.emit({ name: "table.updated", topics: m.toTableId ? [topic.table(m.toTableId)] : [], data: { movementId: m.id, confirmed: true }, syncable: false });
    ctx.summary(`Movement confirmed at table ${m.toTableNumber}`);
    return { movementId: m.id, alreadyConfirmed: false };
  }) satisfies Handler<"DEALER_CONFIRM_MOVEMENT">,

  RESOLVE_FLOOR_REQUEST: (async (ctx, payload) => {
    const [req] = await ctx.tx
      .select()
      .from(floorRequests)
      .where(and(eq(floorRequests.id, payload.requestId), eq(floorRequests.tournamentId, ctx.tournament.id)));
    if (!req) throw notFound("floor request");
    await ctx.tx
      .update(floorRequests)
      .set({ status: payload.resolution, resolvedAt: payload.resolution === "RESOLVED" ? ctx.now : null, resolvedBy: ctx.actor.userId })
      .where(eq(floorRequests.id, req.id));
    ctx.touch(`floor:${req.id}`);
    ctx.emit({ name: "floor.request.updated", topics: [topic.table(req.tableId)], data: { requestId: req.id, status: payload.resolution }, syncable: false });
    ctx.summary(`Floor request ${payload.resolution.toLowerCase()}`);
    return { requestId: req.id };
  }) satisfies Handler<"RESOLVE_FLOOR_REQUEST">,
};
