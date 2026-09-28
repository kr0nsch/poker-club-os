import { entryTransactions, tournamentEntries } from "@pcos/db";
import { assertAddonAllowed, assertRebuyAllowed, ruleViolation } from "@pcos/domain";
import type { EntryStatus, TournamentFormat, TournamentStatus } from "@pcos/types";
import { and, eq } from "drizzle-orm";
import { notFound } from "../../errors.js";
import type { CommandContext } from "../context.js";
import type { Handler } from "../executor.js";
import { getEntry, getRegistration, playerName, releaseSeat, updateRegistrationStatus } from "../ops.js";
import { policies } from "../repo.js";

async function entryTransactionsOf(ctx: CommandContext, entryId: string) {
  return ctx.tx.select().from(entryTransactions).where(eq(entryTransactions.entryId, entryId));
}

async function addTransaction(
  ctx: CommandContext,
  entryId: string,
  type: "REBUY" | "ADD_ON" | "CHIP_ADJUSTMENT" | "BOUNTY_WON",
  chips: number,
  amount: number,
  reason?: string,
) {
  const [row] = await ctx.tx
    .insert(entryTransactions)
    .values({
      organizationId: ctx.tournament.organizationId,
      tournamentId: ctx.tournament.id,
      entryId,
      type,
      chips,
      amount,
      reason: reason ?? null,
      actionId: ctx.actionId,
      createdBy: ctx.actor.userId,
      createdAt: ctx.now,
    })
    .returning();
  ctx.touch(`entry:${entryId}`);
  ctx.emit({ name: "entry.updated", data: { entryId, transactionId: row!.id, type, chips, amount }, aggregateType: "entry", aggregateId: entryId });
  ctx.statsChanged();
  return row!;
}

export async function voidTransaction(ctx: CommandContext, transactionId: string, reason: string) {
  const [tx] = await ctx.tx
    .select()
    .from(entryTransactions)
    .where(and(eq(entryTransactions.id, transactionId), eq(entryTransactions.tournamentId, ctx.tournament.id)));
  if (!tx) throw notFound("transaction");
  if (tx.voided) throw ruleViolation("transaction is already voided");
  if (tx.type === "VOID") throw ruleViolation("a void cannot be voided");
  if (tx.type === "BUY_IN") throw ruleViolation("void the entry to reverse a buy-in");
  await ctx.tx.update(entryTransactions).set({ voided: true }).where(eq(entryTransactions.id, tx.id));
  const [voidRow] = await ctx.tx
    .insert(entryTransactions)
    .values({
      organizationId: ctx.tournament.organizationId,
      tournamentId: ctx.tournament.id,
      entryId: tx.entryId,
      type: "VOID",
      chips: 0,
      amount: 0,
      voidsTransactionId: tx.id,
      reason,
      actionId: ctx.actionId,
      createdBy: ctx.actor.userId,
      createdAt: ctx.now,
    })
    .returning();
  ctx.touch(`entry:${tx.entryId}`, `transaction:${tx.id}`);
  ctx.emit({ name: "entry.updated", data: { entryId: tx.entryId, voidedTransactionId: tx.id, type: tx.type }, aggregateType: "entry", aggregateId: tx.entryId });
  ctx.statsChanged();
  return { voidTransactionId: voidRow!.id, voided: tx };
}

export async function voidEntry(ctx: CommandContext, entryId: string, reason: string) {
  const entry = await getEntry(ctx, entryId);
  if (entry.status === "VOIDED") throw ruleViolation("entry is already voided");
  await ctx.tx.update(tournamentEntries).set({ status: "VOIDED", voidedAt: ctx.now, version: entry.version + 1, updatedAt: ctx.now }).where(eq(tournamentEntries.id, entry.id));
  await ctx.tx.update(entryTransactions).set({ voided: true }).where(and(eq(entryTransactions.entryId, entry.id), eq(entryTransactions.voided, false)));
  const seat = entry.status === "ACTIVE" ? await releaseSeat(ctx, entry.id, "VOID") : null;

  // Registration falls back to the state implied by the remaining entries.
  const reg = await getRegistration(ctx, entry.registrationId);
  const remaining = await ctx.tx
    .select({ status: tournamentEntries.status })
    .from(tournamentEntries)
    .where(and(eq(tournamentEntries.registrationId, reg.id)));
  const live = remaining.filter((e) => e.status !== "VOIDED");
  const next = live.some((e) => e.status === "ACTIVE") ? "PLAYING" : live.length > 0 ? "ELIMINATED" : "CHECKED_IN";
  if (next !== reg.status) await updateRegistrationStatus(ctx, reg, next);

  ctx.touch(`entry:${entry.id}`);
  ctx.emit({ name: "entry.updated", data: { entryId: entry.id, status: "VOIDED", reason }, aggregateType: "entry", aggregateId: entry.id });
  ctx.audit({ entityType: "entry", entityId: entry.id, action: "VOID_ENTRY", before: { status: entry.status }, metadata: { reason } });
  ctx.statsChanged();
  return { entryId: entry.id, releasedSeat: seat };
}

export const entryHandlers = {
  REBUY: (async (ctx, payload) => {
    const entry = await getEntry(ctx, payload.entryId);
    const p = policies(ctx.tournament);
    const txs = await entryTransactionsOf(ctx, entry.id);
    const live = txs.filter((t) => !t.voided && t.type !== "VOID");
    assertRebuyAllowed({
      status: ctx.tournament.status as TournamentStatus,
      format: ctx.tournament.format as TournamentFormat,
      policy: p.rebuy,
      entryStatus: entry.status as EntryStatus,
      rebuysSoFar: live.filter((t) => t.type === "REBUY").length,
      // Live stacks are not tracked; the dealer/floor confirms the threshold at the table.
      currentStack: null,
      clock: ctx.derived,
    });
    const tx = await addTransaction(ctx, entry.id, "REBUY", p.rebuy.chips, p.rebuy.amount);
    ctx.summary(`Rebuy: ${await playerName(ctx, entry.playerId)}`);
    return { transactionId: tx.id };
  }) satisfies Handler<"REBUY">,

  ADD_ON: (async (ctx, payload) => {
    const entry = await getEntry(ctx, payload.entryId);
    const p = policies(ctx.tournament);
    const txs = await entryTransactionsOf(ctx, entry.id);
    assertAddonAllowed({
      status: ctx.tournament.status as TournamentStatus,
      policy: p.addon,
      entryStatus: entry.status as EntryStatus,
      addonsSoFar: txs.filter((t) => !t.voided && t.type === "ADD_ON").length,
      clock: ctx.derived,
    });
    const tx = await addTransaction(ctx, entry.id, "ADD_ON", p.addon.chips, p.addon.amount);
    ctx.summary(`Add-on: ${await playerName(ctx, entry.playerId)}`);
    return { transactionId: tx.id };
  }) satisfies Handler<"ADD_ON">,

  CHIP_ADJUSTMENT: (async (ctx, payload) => {
    const entry = await getEntry(ctx, payload.entryId);
    if (entry.status === "VOIDED") throw ruleViolation("entry is voided");
    const tx = await addTransaction(ctx, entry.id, "CHIP_ADJUSTMENT", payload.chips, 0, payload.reason);
    ctx.summary(`Chip adjustment ${payload.chips > 0 ? "+" : ""}${payload.chips}: ${await playerName(ctx, entry.playerId)}`);
    return { transactionId: tx.id };
  }) satisfies Handler<"CHIP_ADJUSTMENT">,

  VOID_TRANSACTION: (async (ctx, payload) => {
    const r = await voidTransaction(ctx, payload.transactionId, payload.reason);
    ctx.summary(`Voided ${r.voided.type.toLowerCase()} transaction`);
    return { voidTransactionId: r.voidTransactionId };
  }) satisfies Handler<"VOID_TRANSACTION">,

  VOID_ENTRY: (async (ctx, payload) => {
    const r = await voidEntry(ctx, payload.entryId, payload.reason);
    ctx.summary(`Entry voided: ${payload.reason}`);
    return r;
  }) satisfies Handler<"VOID_ENTRY">,
};

export { addTransaction };
