// NotificationService (spec §69): domain code never calls Telegram or email
// directly. It enqueues notifications; transports deliver them asynchronously.

import {
  notificationPreferences,
  notifications,
  organizationSettings,
  players,
  telegramAccountLinks,
  telegramIntegrations,
  telegramDeliveries,
  type Executor,
} from "@pcos/db";
import { computeExpiresAt } from "@pcos/domain";
import {
  DEFAULT_FEATURE_FLAGS,
  NOTIFICATION_TYPES,
  NotificationPreferenceInput,
  type FeatureFlags,
  type NotificationChannel,
  type NotificationType,
  type Severity,
} from "@pcos/types";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { requireOrganization, requirePermission, type Actor } from "../actor.js";
import type { CoreDeps } from "../deps.js";
import { forbidden } from "../errors.js";

export interface EnqueueInput {
  organizationId: string;
  type: NotificationType;
  payload: Record<string, unknown>;
  /** target player (channels resolved from links and preferences) */
  playerId?: string | null;
  /** explicit transport address, e.g. a Telegram chat id (subscriptions, staff chat) */
  telegramChatId?: number | null;
  /** restrict to these channels */
  channels?: NotificationChannel[];
  dedupeKey?: string | null;
  /** event time used to bound the TTL (e.g. tournament start for reminders) */
  eventAt?: Date | null;
}

/** Channels that need the Internet (and therefore wait while the WAN is down). */
export const EXTERNAL_CHANNELS: readonly NotificationChannel[] = ["TELEGRAM", "EMAIL", "SMS", "PUSH"];

export class NotificationService {
  constructor(private readonly deps: CoreDeps) {}

  private async orgPrefs(db: Executor, orgId: string) {
    const [s] = await db.select().from(organizationSettings).where(eq(organizationSettings.organizationId, orgId));
    const flags = { ...DEFAULT_FEATURE_FLAGS, ...((s?.featureFlags ?? {}) as Partial<FeatureFlags>) } as FeatureFlags;
    const types = (s?.notificationTypes ?? {}) as Record<string, boolean>;
    return { flags, types, locale: s?.locale ?? "en" };
  }

  /** Insert notifications for every applicable channel. Safe to call inside a transaction. */
  async enqueue(db: Executor, input: EnqueueInput): Promise<number> {
    const now = this.deps.now();
    const org = await this.orgPrefs(db, input.organizationId);
    if (org.types[input.type] === false) return 0; // disabled by the organization (spec §27)
    const expiresAt = new Date(computeExpiresAt(input.type, now.getTime(), { eventAt: input.eventAt?.getTime() ?? null }));
    if (expiresAt <= now) return 0;
    const wanted = new Set(input.channels ?? (["IN_APP", "TELEGRAM", "EMAIL"] as NotificationChannel[]));
    const rows: (typeof notifications.$inferInsert)[] = [];
    const base = { organizationId: input.organizationId, type: input.type, payload: { ...input.payload, locale: input.payload.locale ?? org.locale }, createdAt: now, expiresAt, nextAttemptAt: now };

    if (input.telegramChatId != null && wanted.has("TELEGRAM") && org.flags.telegram) {
      rows.push({ ...base, channel: "TELEGRAM", playerId: input.playerId ?? null, recipient: String(input.telegramChatId), dedupeKey: input.dedupeKey ? `${input.dedupeKey}:tg:${input.telegramChatId}` : null });
    }

    if (input.playerId) {
      const [player] = await db.select().from(players).where(eq(players.id, input.playerId));
      if (!player || player.status === "BANNED") return 0;
      const prefs = await db.select().from(notificationPreferences).where(and(eq(notificationPreferences.playerId, player.id), eq(notificationPreferences.type, input.type)));
      const allowed = (ch: NotificationChannel) => prefs.find((p) => p.channel === ch)?.enabled !== false;
      const locale = player.language ?? org.locale;
      if (wanted.has("IN_APP") && player.userId && allowed("IN_APP")) {
        rows.push({ ...base, payload: { ...base.payload, locale }, channel: "IN_APP", playerId: player.id, recipient: null, status: "SENT", sentAt: now, dedupeKey: input.dedupeKey ? `${input.dedupeKey}:app` : null });
      }
      if (wanted.has("TELEGRAM") && input.telegramChatId == null && org.flags.telegram && allowed("TELEGRAM")) {
        const [link] = await db
          .select()
          .from(telegramAccountLinks)
          .where(and(eq(telegramAccountLinks.playerId, player.id), eq(telegramAccountLinks.status, "ACTIVE")));
        if (link) {
          rows.push({ ...base, payload: { ...base.payload, locale }, channel: "TELEGRAM", playerId: player.id, recipient: String(link.telegramChatId), dedupeKey: input.dedupeKey ? `${input.dedupeKey}:tg` : null });
        }
      }
      const emailTypes: NotificationType[] = ["REGISTRATION_CONFIRMED", "TOURNAMENT_CANCELLED", "TOURNAMENT_CHANGED", "RESULTS_FINALIZED"];
      if (wanted.has("EMAIL") && this.deps.config.SMTP_HOST && player.email && emailTypes.includes(input.type) && allowed("EMAIL")) {
        rows.push({ ...base, payload: { ...base.payload, locale }, channel: "EMAIL", playerId: player.id, recipient: player.email, dedupeKey: input.dedupeKey ? `${input.dedupeKey}:mail` : null });
      }
    }
    if (rows.length === 0) return 0;
    const inserted = await db.insert(notifications).values(rows).onConflictDoNothing().returning({ id: notifications.id });
    return inserted.length;
  }

  /** Alert for staff (spec §28), delivered to the configured staff Telegram chat. */
  async staffAlert(organizationId: string, severity: Severity, title: string, body: string, dedupeKey?: string) {
    const [tg] = await this.deps.db.select().from(telegramIntegrations).where(eq(telegramIntegrations.organizationId, organizationId));
    const chatId = tg?.staffAlertsChatId ? Number(tg.staffAlertsChatId) : null;
    if (chatId == null || !Number.isFinite(chatId)) return 0;
    return this.enqueue(this.deps.db, {
      organizationId,
      type: "STAFF_ALERT",
      payload: { severity, title, body },
      telegramChatId: chatId,
      channels: ["TELEGRAM"],
      dedupeKey: dedupeKey ?? null,
    });
  }

  // --- player inbox & preferences ------------------------------------------------------------------

  private playerOf(actor: Actor) {
    const p = actor.principal;
    if (p.kind !== "player") throw forbidden("player account required");
    return p;
  }

  async inbox(actor: Actor) {
    const p = this.playerOf(actor);
    return this.deps.db
      .select({ id: notifications.id, type: notifications.type, payload: notifications.payload, createdAt: notifications.createdAt, readAt: notifications.readAt })
      .from(notifications)
      .where(and(eq(notifications.playerId, p.playerId), eq(notifications.channel, "IN_APP")))
      .orderBy(desc(notifications.createdAt))
      .limit(100);
  }

  async markRead(actor: Actor, ids: string[] | "all") {
    const p = this.playerOf(actor);
    await this.deps.db
      .update(notifications)
      .set({ readAt: this.deps.now() })
      .where(and(eq(notifications.playerId, p.playerId), eq(notifications.channel, "IN_APP"), isNull(notifications.readAt), ids === "all" ? undefined : inArray(notifications.id, ids)));
    return { ok: true };
  }

  async preferences(actor: Actor) {
    const p = this.playerOf(actor);
    const rows = await this.deps.db.select().from(notificationPreferences).where(eq(notificationPreferences.playerId, p.playerId));
    const channels: NotificationChannel[] = ["IN_APP", "TELEGRAM", "EMAIL"];
    return NOTIFICATION_TYPES.filter((t) => t !== "STAFF_ALERT").map((type) => ({
      type,
      channels: Object.fromEntries(channels.map((ch) => [ch, rows.find((r) => r.type === type && r.channel === ch)?.enabled ?? true])),
    }));
  }

  async setPreference(actor: Actor, raw: unknown) {
    const p = this.playerOf(actor);
    const input = NotificationPreferenceInput.parse(raw);
    await this.deps.db
      .insert(notificationPreferences)
      .values({ organizationId: p.organizationId, playerId: p.playerId, channel: input.channel, type: input.type, enabled: input.enabled })
      .onConflictDoUpdate({
        target: [notificationPreferences.playerId, notificationPreferences.channel, notificationPreferences.type],
        targetWhere: sql`${notificationPreferences.playerId} is not null`,
        set: { enabled: input.enabled, updatedAt: this.deps.now() },
      });
    return { ok: true };
  }

  // --- administration --------------------------------------------------------------------------------

  async queue(actor: Actor, filter: { status?: string; channel?: string; limit?: number }) {
    requirePermission(actor, "telegram.manage");
    const orgId = requireOrganization(actor);
    const rows = await this.deps.db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.organizationId, orgId),
          filter.status ? eq(notifications.status, filter.status) : undefined,
          filter.channel ? eq(notifications.channel, filter.channel) : sql`${notifications.channel} <> 'IN_APP'`,
        ),
      )
      .orderBy(desc(notifications.createdAt))
      .limit(Math.min(filter.limit ?? 100, 500));
    const [counts] = (
      await this.deps.db.execute<Record<string, number>>(sql`
        select count(*) filter (where status = 'PENDING')::int as pending,
               count(*) filter (where status = 'SENT')::int as sent,
               count(*) filter (where status = 'FAILED')::int as failed,
               count(*) filter (where status = 'EXPIRED')::int as expired
        from notifications where organization_id = ${orgId} and channel <> 'IN_APP'`)
    ).rows;
    return { counts, items: rows.map((r) => ({ ...r, recipient: r.channel === "EMAIL" ? maskEmail(r.recipient) : r.recipient })) };
  }

  async deliveries(actor: Actor, notificationId: string) {
    requirePermission(actor, "telegram.manage");
    const orgId = requireOrganization(actor);
    return this.deps.db
      .select()
      .from(telegramDeliveries)
      .where(and(eq(telegramDeliveries.notificationId, notificationId), eq(telegramDeliveries.organizationId, orgId)))
      .orderBy(desc(telegramDeliveries.createdAt));
  }
}

function maskEmail(v: string | null) {
  if (!v) return v;
  const [u, d] = v.split("@");
  return `${(u ?? "").slice(0, 2)}***@${d ?? ""}`;
}
