// Telegram integration administration, account linking and Mini App sign-in
// (spec §22, §26, §29, §31, §88).

import {
  organizationSettings,
  players,
  telegramAccountLinks,
  telegramIntegrations,
  telegramLinkTokens,
  users,
  type Executor,
} from "@pcos/db";
import { TelegramApiError, TelegramBotClient, verifyWebAppInitData, type TgUser } from "@pcos/telegram";
import { TelegramIntegrationInput, TelegramLinkCodeInput, TelegramMiniAppAuthInput } from "@pcos/types";
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import { requireOrganization, requirePermission, type Actor } from "../actor.js";
import { writeAudit } from "../audit.js";
import { randomCode, randomToken, sha256 } from "../crypto.js";
import type { CoreDeps } from "../deps.js";
import { AppError, forbidden, notFound, unauthenticated } from "../errors.js";
import type { AuthService } from "../services/auth.service.js";
import { orgFlags } from "../tournaments/snapshot.js";
import type { TelegramBotProvider } from "./bot-provider.js";

const LINK_TTL_MS = 15 * 60_000;
const CODE_TTL_MS = 10 * 60_000;

export class TelegramService {
  constructor(
    private readonly deps: CoreDeps,
    private readonly bots: TelegramBotProvider,
    private readonly auth: AuthService,
  ) {}

  // --- administration ------------------------------------------------------------------------------

  async getIntegration(actor: Actor) {
    requirePermission(actor, "telegram.manage");
    const orgId = requireOrganization(actor);
    const [row] = await this.deps.db.select().from(telegramIntegrations).where(eq(telegramIntegrations.organizationId, orgId));
    const cfg = await this.bots.config(orgId);
    const flags = await orgFlags(this.deps.db, orgId);
    return {
      enabled: row?.enabled ?? cfg.enabled,
      mode: row?.mode ?? cfg.mode,
      botUsername: row?.botUsername ?? cfg.username,
      status: row?.status ?? (cfg.token ? "OFFLINE" : "DISABLED"),
      lastUpdateAt: row?.lastUpdateAt?.toISOString() ?? null,
      lastError: row?.lastError ?? null,
      staffAlertsChatId: row?.staffAlertsChatId ?? null,
      tokenConfigured: !!cfg.token,
      tokenSource: cfg.source,
      staffMutationCommandsEnabled: flags.telegramStaffCommands,
    };
  }

  /** Omitted fields keep their stored value; `staffAlertsChatId: null` clears it. */
  async saveIntegration(actor: Actor, raw: unknown) {
    requirePermission(actor, "telegram.manage");
    const orgId = requireOrganization(actor);
    const input = TelegramIntegrationInput.parse(raw);
    const [current] = await this.deps.db.select().from(telegramIntegrations).where(eq(telegramIntegrations.organizationId, orgId));
    let botUsername = input.botUsername ?? current?.botUsername ?? null;
    const staffAlertsChatId = input.staffAlertsChatId !== undefined ? input.staffAlertsChatId : (current?.staffAlertsChatId ?? null);
    let status = input.enabled ? "CONNECTING" : "DISABLED";
    let lastError: string | null = null;
    if (input.botToken) {
      // Verify the token when the Internet is available; saving never depends on it.
      try {
        const me = await new TelegramBotClient(input.botToken, { apiBase: this.deps.config.TELEGRAM_API_BASE, timeoutMs: 5_000 }).getMe();
        botUsername = me.username ?? botUsername;
      } catch (e) {
        if (e instanceof TelegramApiError && e.kind === "unauthorized") throw new AppError("VALIDATION_ERROR", "Telegram rejected this bot token");
        if (e instanceof TelegramApiError && e.networkDown) {
          status = input.enabled ? "WAITING_FOR_NETWORK" : status;
          lastError = "token not verified: Internet unavailable";
        }
      }
    }
    const now = this.deps.now();
    await this.deps.db.transaction(async (tx) => {
      const values = {
        enabled: input.enabled,
        mode: input.mode,
        botUsername,
        status,
        lastError,
        staffAlertsChatId,
        updatedAt: now,
        ...(input.botToken ? { encryptedBotToken: this.deps.secrets.seal(input.botToken) } : {}),
      };
      await tx
        .insert(telegramIntegrations)
        .values({ organizationId: orgId, ...values })
        .onConflictDoUpdate({ target: telegramIntegrations.organizationId, set: values });
      const flag = JSON.stringify({ telegram: input.enabled });
      await tx
        .insert(organizationSettings)
        .values({ organizationId: orgId, featureFlags: { telegram: input.enabled } })
        .onConflictDoUpdate({
          target: organizationSettings.organizationId,
          set: { featureFlags: sql`${organizationSettings.featureFlags} || ${flag}::jsonb`, updatedAt: now },
        });
      await writeAudit(
        tx,
        actor,
        this.deps.edgeNodeId,
        {
          organizationId: orgId,
          entityType: "telegram_integration",
          entityId: orgId,
          action: "TELEGRAM_INTEGRATION_UPDATED",
          // never the token itself
          after: { enabled: input.enabled, mode: input.mode, botUsername, tokenChanged: !!input.botToken, staffAlertsChatId },
        },
        now,
      );
    });
    this.bots.invalidate(orgId);
    return this.getIntegration(actor);
  }

  /** Immediate test message to the staff chat (admin action; not queued). */
  async testMessage(actor: Actor) {
    requirePermission(actor, "telegram.manage");
    const orgId = requireOrganization(actor);
    const client = await this.bots.clientFor(orgId);
    const [row] = await this.deps.db.select().from(telegramIntegrations).where(eq(telegramIntegrations.organizationId, orgId));
    if (!client) throw new AppError("FEATURE_DISABLED", "Telegram integration is not enabled or has no token");
    if (!row?.staffAlertsChatId) throw new AppError("VALIDATION_ERROR", "set a staff alerts chat id first");
    try {
      await client.sendMessage({ chat_id: Number(row.staffAlertsChatId), text: "✅ Poker Club OS: Telegram connection works." });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  // --- account linking (spec §22) ----------------------------------------------------------------------

  private linkSubject(actor: Actor): { playerId: string | null; userId: string | null; orgId: string } {
    const p = actor.principal;
    if (p.kind === "player") return { playerId: p.playerId, userId: null, orgId: p.organizationId };
    if (p.kind === "staff") return { playerId: null, userId: p.userId, orgId: p.organizationId };
    throw unauthenticated();
  }

  /** Single-use, short-lived deep link: https://t.me/<bot>?start=link_<token>. */
  async createDeepLink(actor: Actor) {
    const s = this.linkSubject(actor);
    const cfg = await this.bots.config(s.orgId);
    if (!cfg.enabled || !cfg.username) throw new AppError("FEATURE_DISABLED", "Telegram bot is not configured");
    const token = randomToken(24);
    const expiresAt = new Date(this.deps.now().getTime() + LINK_TTL_MS);
    await this.deps.db.insert(telegramLinkTokens).values({ organizationId: s.orgId, kind: "DEEP_LINK", playerId: s.playerId, userId: s.userId, tokenHash: sha256(token), expiresAt });
    return { url: `https://t.me/${cfg.username}?start=link_${token}`, expiresAt: expiresAt.toISOString() };
  }

  /** Bot side of the deep link: validate the token and bind the Telegram user id. */
  async consumeDeepLink(organizationId: string, token: string, from: TgUser, chatId: number) {
    const now = this.deps.now();
    return this.deps.db.transaction(async (tx) => {
      const [t] = await tx
        .select()
        .from(telegramLinkTokens)
        .where(and(eq(telegramLinkTokens.organizationId, organizationId), eq(telegramLinkTokens.tokenHash, sha256(token)), eq(telegramLinkTokens.kind, "DEEP_LINK")))
        .for("update");
      if (!t || t.usedAt || t.expiresAt <= now) return { ok: false as const, reason: "This link has expired or was already used. Create a new one in the web app." };
      await tx.update(telegramLinkTokens).set({ usedAt: now, telegramUserId: from.id, telegramChatId: chatId }).where(eq(telegramLinkTokens.id, t.id));
      const name = await this.bind(tx, organizationId, { playerId: t.playerId, userId: t.userId }, from, chatId, now);
      return { ok: true as const, name };
    });
  }

  /** Reverse flow: the bot issues a code, the logged-in user enters it on the web. */
  async issueCode(organizationId: string, from: TgUser, chatId: number) {
    const code = randomCode(8);
    await this.deps.db.insert(telegramLinkTokens).values({
      organizationId,
      kind: "CODE",
      tokenHash: sha256(`${organizationId}:${code}`),
      telegramUserId: from.id,
      telegramChatId: chatId,
      expiresAt: new Date(this.deps.now().getTime() + CODE_TTL_MS),
    });
    return code;
  }

  async linkWithCode(actor: Actor, raw: unknown) {
    const s = this.linkSubject(actor);
    const { code } = TelegramLinkCodeInput.parse(raw);
    const rl = await this.deps.rateLimiter.hit(`tg-code:${actor.userId ?? actor.ip}`, 10, 900);
    if (!rl.allowed) throw new AppError("RATE_LIMITED", "too many attempts");
    const now = this.deps.now();
    const name = await this.deps.db.transaction(async (tx) => {
      const [t] = await tx
        .select()
        .from(telegramLinkTokens)
        .where(and(eq(telegramLinkTokens.organizationId, s.orgId), eq(telegramLinkTokens.tokenHash, sha256(`${s.orgId}:${code}`)), eq(telegramLinkTokens.kind, "CODE")))
        .for("update");
      if (!t || t.usedAt || t.expiresAt <= now || t.telegramUserId == null || t.telegramChatId == null) throw new AppError("VALIDATION_ERROR", "code is invalid or expired");
      await tx.update(telegramLinkTokens).set({ usedAt: now, playerId: s.playerId, userId: s.userId }).where(eq(telegramLinkTokens.id, t.id));
      return this.bind(tx, s.orgId, s, { id: t.telegramUserId, is_bot: false, first_name: "" }, t.telegramChatId, now);
    });
    await writeAudit(this.deps.db, actor, this.deps.edgeNodeId, { organizationId: s.orgId, entityType: "telegram_link", entityId: s.playerId ?? s.userId, action: "TELEGRAM_LINKED", metadata: { via: "code" } });
    return { ok: true, name };
  }

  private async bind(tx: Executor, orgId: string, subject: { playerId: string | null; userId: string | null }, from: TgUser, chatId: number, now: Date) {
    // Identify by the stable Telegram user id — never by username (spec §22).
    await tx
      .update(telegramAccountLinks)
      .set({ status: "REVOKED", revokedAt: now })
      .where(
        and(
          eq(telegramAccountLinks.organizationId, orgId),
          eq(telegramAccountLinks.status, "ACTIVE"),
          or(
            eq(telegramAccountLinks.telegramUserId, from.id),
            subject.playerId ? eq(telegramAccountLinks.playerId, subject.playerId) : undefined,
            subject.userId ? eq(telegramAccountLinks.userId, subject.userId) : undefined,
          ),
        ),
      );
    await tx.insert(telegramAccountLinks).values({
      organizationId: orgId,
      playerId: subject.playerId,
      userId: subject.userId,
      telegramUserId: from.id,
      telegramChatId: chatId,
      telegramUsername: from.username ?? null,
      status: "ACTIVE",
      linkedAt: now,
      verifiedAt: now,
    });
    await writeAudit(
      tx,
      { principal: { kind: "system", organizationId: orgId, name: "telegram" }, userId: subject.userId, deviceId: null, ip: null, channel: "TELEGRAM" },
      this.deps.edgeNodeId,
      { organizationId: orgId, entityType: "telegram_link", entityId: subject.playerId ?? subject.userId, action: "TELEGRAM_LINKED", metadata: { telegramUserId: from.id } },
      now,
    );
    if (subject.playerId) {
      const [p] = await tx.select({ n: players.displayName }).from(players).where(eq(players.id, subject.playerId));
      return p?.n ?? "player";
    }
    const [u] = await tx.select({ n: users.displayName }).from(users).where(eq(users.id, subject.userId!));
    return u?.n ?? "staff member";
  }

  async unlink(actor: Actor) {
    const s = this.linkSubject(actor);
    const now = this.deps.now();
    await this.deps.db
      .update(telegramAccountLinks)
      .set({ status: "REVOKED", revokedAt: now })
      .where(
        and(
          eq(telegramAccountLinks.organizationId, s.orgId),
          eq(telegramAccountLinks.status, "ACTIVE"),
          s.playerId ? eq(telegramAccountLinks.playerId, s.playerId) : eq(telegramAccountLinks.userId, s.userId!),
        ),
      );
    await writeAudit(this.deps.db, actor, this.deps.edgeNodeId, { organizationId: s.orgId, entityType: "telegram_link", entityId: s.playerId ?? s.userId, action: "TELEGRAM_UNLINKED" });
    return { ok: true };
  }

  async linkStatus(actor: Actor) {
    const s = this.linkSubject(actor);
    const cfg = await this.bots.config(s.orgId);
    const [link] = await this.deps.db
      .select()
      .from(telegramAccountLinks)
      .where(
        and(
          eq(telegramAccountLinks.organizationId, s.orgId),
          eq(telegramAccountLinks.status, "ACTIVE"),
          s.playerId ? eq(telegramAccountLinks.playerId, s.playerId) : eq(telegramAccountLinks.userId, s.userId!),
        ),
      );
    return {
      available: cfg.enabled && !!cfg.username,
      botUsername: cfg.username,
      linked: !!link,
      telegramUsername: link?.telegramUsername ?? null,
      linkedAt: link?.linkedAt.toISOString() ?? null,
    };
  }

  /** Active link of a Telegram user within an organization. */
  async linkOf(organizationId: string, telegramUserId: number) {
    const [link] = await this.deps.db
      .select()
      .from(telegramAccountLinks)
      .where(and(eq(telegramAccountLinks.organizationId, organizationId), eq(telegramAccountLinks.telegramUserId, telegramUserId), eq(telegramAccountLinks.status, "ACTIVE")));
    return link ?? null;
  }

  // --- Mini App (spec §26) --------------------------------------------------------------------------------

  async miniAppAuth(organizationId: string, raw: unknown, ctx: { ip: string | null; userAgent: string | null }) {
    const { initData } = TelegramMiniAppAuthInput.parse(raw);
    const cfg = await this.bots.config(organizationId);
    if (!cfg.token || !cfg.enabled) throw new AppError("FEATURE_DISABLED", "Telegram is not configured");
    let verified;
    try {
      verified = verifyWebAppInitData(initData, cfg.token, 3600, this.deps.now().getTime());
    } catch (e) {
      throw unauthenticated(`invalid Telegram init data: ${e instanceof Error ? e.message : "rejected"}`);
    }
    const link = await this.linkOf(organizationId, verified.user.id);
    if (!link?.playerId) throw forbidden("link your Telegram account to your player profile first (use /link in the bot)");
    const [player] = await this.deps.db.select().from(players).where(eq(players.id, link.playerId));
    if (!player) throw notFound("player");
    let userId = player.userId;
    if (!userId) {
      // Players created at the desk may have no web account yet: create a password-less one.
      const [u] = await this.deps.db
        .insert(users)
        .values({ email: `telegram-${verified.user.id}@players.invalid`, displayName: player.displayName, passwordHash: null })
        .onConflictDoUpdate({ target: users.email, set: { displayName: player.displayName } })
        .returning();
      userId = u!.id;
      await this.deps.db.update(players).set({ userId }).where(and(eq(players.id, player.id), isNull(players.userId)));
    }
    const session = await this.auth.createSession(userId, organizationId, { ...ctx, deviceId: null }, "TELEGRAM");
    return { ...session, playerId: player.id };
  }

  /** Pending link tokens are pruned periodically. */
  async pruneTokens() {
    await this.deps.db.delete(telegramLinkTokens).where(and(isNull(telegramLinkTokens.usedAt), gt(sql`now() - interval '1 day'`, telegramLinkTokens.expiresAt)));
  }
}
