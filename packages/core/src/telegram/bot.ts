// Telegram bot conversation (spec §23-25, §29, §32).
//
// * Button-based navigation; commands are optional shortcuts.
// * Every update is processed at most once (telegram_update_receipts).
// * Registration goes through the same command executor as the web app —
//   the bot contains no separate business rules.
// * Staff commands are read-only by default; state-changing ones require the
//   telegramStaffCommands flag, RBAC, an explicit confirmation with a short
//   timeout, and are audited by the executor.

import { createHash, randomUUID } from "node:crypto";
import {
  leaderboardSnapshots,
  leagues,
  notificationPreferences,
  organizationMembers,
  organizations,
  players,
  seasons,
  telegramSubscriptions,
  telegramUpdateReceipts,
  tournamentRegistrations,
  tournamentResults,
  tournaments,
  venues,
} from "@pcos/db";
import { deriveClock, formatClock } from "@pcos/domain";
import { button, escapeHtml, isButtonUrl, keyboard, type InlineKeyboardMarkup, type TelegramBotClient, type TgUpdate, type TgUser } from "@pcos/telegram";
import { NOTIFICATION_TYPES, permissionsForRoles, type NotificationType } from "@pcos/types";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { Actor } from "../actor.js";
import type { CoreDeps } from "../deps.js";
import { AppError } from "../errors.js";
import type { TournamentCommandExecutor } from "../tournaments/executor.js";
import { anchorFromRow, levelLikes, loadClockRow, loadLevels } from "../tournaments/repo.js";
import { buildPublicSnapshot, lateRegistrationOpenNow, orgFlags } from "../tournaments/snapshot.js";
import type { EdgeService } from "../services/edge.service.js";
import type { TelegramBotProvider } from "./bot-provider.js";
import type { TelegramService } from "./telegram.service.js";

const LIVE = ["RUNNING", "BREAK", "PAUSED", "HAND_FOR_HAND"];
const OPEN = ["SCHEDULED", "REGISTRATION_OPEN", "SEATING", ...LIVE];
const CONFIRM_TTL_MS = 60_000;

/** Deterministic UUID for an operation derived from a Telegram update (idempotent retries). */
function opId(organizationId: string, key: string): string {
  const h = createHash("sha256").update(`${organizationId}:${key}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

interface Reply {
  text: string;
  markup?: InlineKeyboardMarkup;
}

export class TelegramBot {
  private readonly pendingConfirmations = new Map<string, { expiresAt: number; telegramUserId: number; tournamentId: string; action: "PAUSE_CLOCK" | "RESUME_CLOCK" }>();

  constructor(
    private readonly deps: CoreDeps,
    private readonly bots: TelegramBotProvider,
    private readonly telegram: TelegramService,
    private readonly executor: TournamentCommandExecutor,
    private readonly edge: EdgeService,
  ) {}

  /** Entry point for both long polling and webhooks. Returns false for duplicates. */
  async handleUpdate(organizationId: string, update: TgUpdate): Promise<boolean> {
    const kind = update.callback_query ? "callback" : update.message ? "message" : "other";
    const inserted = await this.deps.db
      .insert(telegramUpdateReceipts)
      .values({ organizationId, updateId: update.update_id, kind })
      .onConflictDoNothing()
      .returning({ id: telegramUpdateReceipts.updateId });
    if (inserted.length === 0) return false; // already processed (spec §32)

    const client = await this.bots.clientFor(organizationId);
    try {
      if (client) {
        if (update.callback_query) await this.onCallback(organizationId, client, update);
        else if (update.message?.text) await this.onMessage(organizationId, client, update);
      }
      await this.deps.db
        .update(telegramUpdateReceipts)
        .set({ status: "PROCESSED", processedAt: this.deps.now() })
        .where(and(eq(telegramUpdateReceipts.organizationId, organizationId), eq(telegramUpdateReceipts.updateId, update.update_id)));
    } catch (e) {
      await this.deps.db
        .update(telegramUpdateReceipts)
        .set({ status: "FAILED", processedAt: this.deps.now(), error: e instanceof Error ? e.message.slice(0, 500) : String(e) })
        .where(and(eq(telegramUpdateReceipts.organizationId, organizationId), eq(telegramUpdateReceipts.updateId, update.update_id)));
      throw e;
    }
    return true;
  }

  // --- routing ---------------------------------------------------------------------------------------

  private async onMessage(orgId: string, client: TelegramBotClient, update: TgUpdate) {
    const msg = update.message!;
    const from = msg.from;
    if (!from || msg.chat.type !== "private") return; // the bot talks to individuals only
    const [cmd, ...args] = msg.text!.trim().split(/\s+/);
    const command = (cmd ?? "").toLowerCase().replace(/@.*$/, "");
    let reply: Reply;
    switch (command) {
      case "/start":
        reply = await this.start(orgId, from, msg.chat.id, args[0]);
        break;
      case "/events":
        reply = await this.events(orgId, msg.chat.id);
        break;
      case "/my":
        reply = await this.myRegistrations(orgId, from);
        break;
      case "/live":
        reply = await this.live(orgId, from);
        break;
      case "/seat":
        reply = await this.live(orgId, from, true);
        break;
      case "/standings":
        reply = await this.standings(orgId, from);
        break;
      case "/link": {
        const code = await this.telegram.issueCode(orgId, from, msg.chat.id);
        reply = { text: `🔗 Your linking code: <code>${code}</code>\nEnter it in the web app under <i>Profile → Telegram</i> within 10 minutes.` };
        break;
      }
      case "/status":
        reply = await this.staffStatus(orgId, from);
        break;
      case "/pause":
      case "/resume":
        reply = await this.staffClockCommand(orgId, from, command === "/pause" ? "PAUSE_CLOCK" : "RESUME_CLOCK", args[0]);
        break;
      case "/finish":
      case "/reset":
      case "/cancel":
      case "/refund":
        reply = { text: "⛔ This command is disabled. State-changing operations are performed in the floor application." };
        break;
      case "/help":
      case "/menu":
      default:
        reply = await this.menu(orgId, from);
    }
    await this.send(client, msg.chat.id, reply);
  }

  private async onCallback(orgId: string, client: TelegramBotClient, update: TgUpdate) {
    const cq = update.callback_query!;
    const chatId = cq.message?.chat.id ?? cq.from.id;
    const data = cq.data ?? "";
    const [head, arg] = data.split(":", 2) as [string, string | undefined];
    let reply: Reply;
    let toast: string | undefined;
    try {
      switch (head) {
        case "m":
          reply = await this.menu(orgId, cq.from);
          break;
        case "ev":
          reply = arg ? await this.eventDetail(orgId, cq.from, arg) : await this.events(orgId, chatId);
          break;
        case "sc": {
          const r = await this.toggleSchedule(orgId, cq.from, chatId);
          reply = r.reply;
          toast = r.on ? "You will be told about new tournaments" : "New-tournament alerts off";
          break;
        }
        case "rg":
          reply = await this.register(orgId, cq.from, arg!, update.update_id);
          break;
        case "cx":
          reply = await this.cancelRegistration(orgId, cq.from, arg!, update.update_id);
          break;
        case "fl":
        case "uf":
          reply = await this.follow(orgId, cq.from, chatId, arg!, head === "fl");
          toast = head === "fl" ? "Following" : "Unfollowed";
          break;
        case "my":
          reply = await this.myRegistrations(orgId, cq.from);
          break;
        case "lv":
          reply = await this.live(orgId, cq.from);
          break;
        case "st":
          reply = await this.live(orgId, cq.from, true);
          break;
        case "lb":
          reply = await this.standings(orgId, cq.from);
          break;
        case "rs":
          reply = await this.results(orgId, cq.from);
          break;
        case "nt":
          reply = await this.notificationSettings(orgId, cq.from, arg as NotificationType | undefined);
          break;
        case "cf":
          reply = await this.confirmStaffCommand(orgId, cq.from, arg!);
          break;
        default:
          reply = await this.menu(orgId, cq.from);
      }
    } catch (e) {
      reply = { text: `⚠️ ${escapeHtml(e instanceof AppError || e instanceof Error ? e.message : "Something went wrong")}`, markup: keyboard([[button.callback("« Menu", "m")]]) };
    }
    await client.answerCallbackQuery(cq.id, toast).catch(() => undefined);
    await this.send(client, chatId, reply);
  }

  private async send(client: TelegramBotClient, chatId: number, reply: Reply) {
    await client.sendMessage({ chat_id: chatId, text: reply.text, parse_mode: "HTML", reply_markup: reply.markup, link_preview_options: { is_disabled: true } });
  }

  // --- helpers ---------------------------------------------------------------------------------------

  private webUrl(path = "") {
    const base = this.deps.config.APP_URL;
    return base ? `${base.replace(/\/$/, "")}${path}` : null;
  }

  private async org(orgId: string) {
    const [o] = await this.deps.db.select().from(organizations).where(eq(organizations.id, orgId));
    return o!;
  }

  private async playerOf(orgId: string, from: TgUser) {
    const link = await this.telegram.linkOf(orgId, from.id);
    return link?.playerId ? { link, playerId: link.playerId } : null;
  }

  private async requirePlayer(orgId: string, from: TgUser) {
    const p = await this.playerOf(orgId, from);
    if (!p) throw new AppError("FORBIDDEN", "Link your player account first: open the web app (Profile → Telegram) or send /link.");
    return p;
  }

  /** Actor for a linked player acting through the bot (same rules as the web app). */
  private async playerActor(orgId: string, playerId: string): Promise<Actor> {
    const [p] = await this.deps.db.select({ userId: players.userId }).from(players).where(eq(players.id, playerId));
    const userId = p?.userId ?? null;
    return { principal: { kind: "player", userId: userId ?? playerId, organizationId: orgId, playerId }, userId, deviceId: null, ip: null, channel: "TELEGRAM" };
  }

  // --- screens ---------------------------------------------------------------------------------------------

  private async menu(orgId: string, from: TgUser): Promise<Reply> {
    const org = await this.org(orgId);
    const linked = await this.playerOf(orgId, from);
    const flags = await orgFlags(this.deps.db, orgId);
    const web = this.webUrl(`/p/${org.slug}`);
    const miniApp = flags.telegramMiniApp ? this.webUrl(`/tg/${org.slug}`) : null;
    return {
      text: `♠️ <b>${escapeHtml(org.name)}</b>\n${linked ? "Choose an option:" : "Choose an option. Link your player account to register and receive seat notifications (/link)."}`,
      markup: keyboard([
        [button.callback("📅 Upcoming tournaments", "ev"), button.callback("📝 My registrations", "my")],
        [button.callback("🎲 Current tournament", "lv"), button.callback("🪑 My seat", "st")],
        [button.callback("🏆 League standings", "lb"), button.callback("📊 My results", "rs")],
        [button.callback("🔔 Notifications", "nt"), isButtonUrl(web) ? button.url("🌐 Open Poker Club", web) : null],
        [isButtonUrl(miniApp) && miniApp.startsWith("https://") ? button.webApp("📱 Mini App", miniApp) : null],
      ]),
    };
  }

  private async start(orgId: string, from: TgUser, chatId: number, payload?: string): Promise<Reply> {
    if (payload?.startsWith("link_")) {
      const res = await this.telegram.consumeDeepLink(orgId, payload.slice(5), from, chatId);
      if (!res.ok) return { text: `⚠️ ${escapeHtml(res.reason)}` };
      const menu = await this.menu(orgId, from);
      return { text: `✅ Telegram linked to <b>${escapeHtml(res.name)}</b>.\n\n${menu.text}`, markup: menu.markup };
    }
    if (payload?.startsWith("t_")) {
      const [t] = await this.deps.db.select().from(tournaments).where(and(eq(tournaments.organizationId, orgId), eq(tournaments.slug, payload.slice(2)), eq(tournaments.published, true)));
      if (t) return this.eventDetail(orgId, from, t.id);
    }
    return this.menu(orgId, from);
  }

  private async events(orgId: string, chatId: number): Promise<Reply> {
    const rows = await this.deps.db
      .select({ t: tournaments, venue: venues.name })
      .from(tournaments)
      .innerJoin(venues, eq(venues.id, tournaments.venueId))
      .where(and(eq(tournaments.organizationId, orgId), eq(tournaments.published, true), eq(tournaments.publicVisibility, "PUBLIC"), inArray(tournaments.status, OPEN)))
      .orderBy(asc(tournaments.startAt))
      .limit(8);
    // Schedule followers hear when registration opens and about club-wide announcements.
    const following = !!(await this.scheduleSubscription(orgId, chatId));
    const followButton = button.callback(following ? "🔕 Stop new-tournament alerts" : "🔔 Alert me about new tournaments", "sc");
    if (rows.length === 0) return { text: "No upcoming tournaments are published right now.", markup: keyboard([[followButton], [button.callback("« Menu", "m")]]) };
    const lines = rows.map(({ t, venue }) => `• <b>${escapeHtml(t.name)}</b>\n  ${fmtDate(t.startAt)} · ${escapeHtml(venue)} · ${t.format} · ${statusLabel(t.status)}`);
    return {
      text: `📅 <b>Upcoming tournaments</b>\n\n${lines.join("\n")}`,
      markup: keyboard([...rows.map(({ t }) => [button.callback(`${LIVE.includes(t.status) ? "🔴 " : ""}${t.name}`.slice(0, 60), `ev:${t.id}`)]), [followButton], [button.callback("« Menu", "m")]]),
    };
  }

  private async scheduleSubscription(orgId: string, chatId: number) {
    const [sub] = await this.deps.db
      .select()
      .from(telegramSubscriptions)
      .where(and(eq(telegramSubscriptions.organizationId, orgId), eq(telegramSubscriptions.telegramChatId, chatId), eq(telegramSubscriptions.topic, "schedule")));
    return sub ?? null;
  }

  private async toggleSchedule(orgId: string, from: TgUser, chatId: number): Promise<{ reply: Reply; on: boolean }> {
    const sub = await this.scheduleSubscription(orgId, chatId);
    if (sub) await this.deps.db.delete(telegramSubscriptions).where(eq(telegramSubscriptions.id, sub.id));
    else {
      const p = await this.playerOf(orgId, from);
      await this.deps.db.insert(telegramSubscriptions).values({ organizationId: orgId, telegramChatId: chatId, playerId: p?.playerId ?? null, topic: "schedule" }).onConflictDoNothing();
    }
    return { reply: await this.events(orgId, chatId), on: !sub };
  }

  private async eventDetail(orgId: string, from: TgUser, tournamentId: string): Promise<Reply> {
    const [row] = await this.deps.db
      .select({ t: tournaments, venue: venues.name })
      .from(tournaments)
      .innerJoin(venues, eq(venues.id, tournaments.venueId))
      .where(and(eq(tournaments.id, tournamentId), eq(tournaments.organizationId, orgId), eq(tournaments.published, true)));
    if (!row) return { text: "Tournament not found.", markup: keyboard([[button.callback("« Back", "ev")]]) };
    const { t } = row;
    const snap = await buildPublicSnapshot(this.deps.db, t, this.deps.now(), { playerId: (await this.playerOf(orgId, from))?.playerId ?? null });
    const org = await this.org(orgId);
    const buyIn = t.buyIn ? `${(t.buyIn.amount / 100).toFixed(0)}${t.buyIn.fee ? ` + ${(t.buyIn.fee / 100).toFixed(0)}` : ""} ${t.buyIn.currency}` : "—";
    const mine = snap.myRegistration;
    const lines = [
      `<b>${escapeHtml(t.name)}</b>`,
      `🗓 ${fmtDate(t.startAt)} · ${escapeHtml(row.venue)}`,
      `🎯 ${t.gameType} ${t.format} · stack ${t.startingStack.toLocaleString("en")} · buy-in ${escapeHtml(buyIn)}`,
      `👥 ${snap.stats.registrations}${t.maxPlayers ? `/${t.maxPlayers}` : ""} registered · ${statusLabel(t.status)}`,
      mine ? `✅ Your registration: <b>${mine.status}</b>` : "",
    ].filter(Boolean);
    const levels = await loadLevels(this.deps.db, t.structureId);
    const canRegister = !mine && lateRegistrationOpenNow(t, levels, await loadClockRow(this.deps.db, t.id), this.deps.now().getTime());
    const canCancel = mine && ["REGISTERED", "RESERVED", "WAITLISTED"].includes(mine.status);
    const [sub] = await this.deps.db
      .select()
      .from(telegramSubscriptions)
      .where(and(eq(telegramSubscriptions.organizationId, orgId), eq(telegramSubscriptions.telegramChatId, from.id), eq(telegramSubscriptions.topic, `tournament:${t.id}`)));
    const live = this.webUrl(`/p/${org.slug}/live/${t.slug}`);
    const page = this.webUrl(`/p/${org.slug}/t/${t.slug}`);
    return {
      text: lines.join("\n"),
      markup: keyboard([
        [canRegister ? button.callback("📝 Register", `rg:${t.id}`) : null, canCancel ? button.callback("✖️ Cancel registration", `cx:${t.id}`) : null],
        [LIVE.includes(t.status) && isButtonUrl(live) ? button.url("🔴 Live page", live) : null, isButtonUrl(page) ? button.url("🌐 Open web app", page) : null],
        [button.callback(sub ? "🔕 Unfollow" : "🔔 Follow", `${sub ? "uf" : "fl"}:${t.id}`)],
        [button.callback("« Back", "ev")],
      ]),
    };
  }

  private async register(orgId: string, from: TgUser, tournamentId: string, updateId: number): Promise<Reply> {
    const p = await this.requirePlayer(orgId, from);
    const flags = await orgFlags(this.deps.db, orgId);
    if (!flags.playerRegistration) throw new AppError("FEATURE_DISABLED", "Online registration is disabled.");
    const [t] = await this.deps.db.select().from(tournaments).where(and(eq(tournaments.id, tournamentId), eq(tournaments.organizationId, orgId)));
    if (!t) throw new AppError("NOT_FOUND", "tournament not found");
    const res = await this.executor.execute(
      t.id,
      {
        type: "REGISTER_PLAYER",
        payload: { playerId: p.playerId, source: "TELEGRAM", reserveOnly: false },
        expectedVersion: t.version,
        // Same update → same operation id → never a double registration (spec §32).
        clientOperationId: opId(orgId, `tg-update:${updateId}`),
      },
      await this.playerActor(orgId, p.playerId),
    ).catch((e: unknown) => {
      if (e instanceof AppError && e.code === "DUPLICATE") return null;
      throw e;
    });
    const detail = await this.eventDetail(orgId, from, tournamentId);
    const status = (res?.result as { status?: string } | undefined)?.status;
    return { text: `${res === null ? "ℹ️ You are already registered." : status === "WAITLISTED" ? "🕒 You are on the waitlist." : "✅ Registered!"}\n\n${detail.text}`, markup: detail.markup };
  }

  private async cancelRegistration(orgId: string, from: TgUser, tournamentId: string, updateId: number): Promise<Reply> {
    const p = await this.requirePlayer(orgId, from);
    const [t] = await this.deps.db.select().from(tournaments).where(and(eq(tournaments.id, tournamentId), eq(tournaments.organizationId, orgId)));
    if (!t) throw new AppError("NOT_FOUND", "tournament not found");
    const [reg] = await this.deps.db
      .select()
      .from(tournamentRegistrations)
      .where(and(eq(tournamentRegistrations.tournamentId, t.id), eq(tournamentRegistrations.playerId, p.playerId), inArray(tournamentRegistrations.status, ["REGISTERED", "RESERVED", "WAITLISTED"])));
    if (!reg) return this.eventDetail(orgId, from, tournamentId);
    await this.executor.execute(
      t.id,
      { type: "CANCEL_REGISTRATION", payload: { registrationId: reg.id, reason: "cancelled via Telegram" }, expectedVersion: t.version, clientOperationId: opId(orgId, `tg-update:${updateId}`) },
      await this.playerActor(orgId, p.playerId),
    );
    const detail = await this.eventDetail(orgId, from, tournamentId);
    return { text: `✖️ Registration cancelled.\n\n${detail.text}`, markup: detail.markup };
  }

  private async follow(orgId: string, from: TgUser, chatId: number, tournamentId: string, on: boolean): Promise<Reply> {
    const topicName = `tournament:${tournamentId}`;
    if (on) {
      const p = await this.playerOf(orgId, from);
      await this.deps.db.insert(telegramSubscriptions).values({ organizationId: orgId, telegramChatId: chatId, playerId: p?.playerId ?? null, topic: topicName }).onConflictDoNothing();
    } else {
      await this.deps.db
        .delete(telegramSubscriptions)
        .where(and(eq(telegramSubscriptions.organizationId, orgId), eq(telegramSubscriptions.telegramChatId, chatId), eq(telegramSubscriptions.topic, topicName)));
    }
    return this.eventDetail(orgId, from, tournamentId);
  }

  private async myRegistrations(orgId: string, from: TgUser): Promise<Reply> {
    const p = await this.requirePlayer(orgId, from);
    const rows = await this.deps.db
      .select({ r: tournamentRegistrations, t: tournaments })
      .from(tournamentRegistrations)
      .innerJoin(tournaments, eq(tournaments.id, tournamentRegistrations.tournamentId))
      .where(and(eq(tournamentRegistrations.playerId, p.playerId), inArray(tournaments.status, OPEN), inArray(tournamentRegistrations.status, ["RESERVED", "REGISTERED", "CHECKED_IN", "PLAYING", "WAITLISTED"])))
      .orderBy(asc(tournaments.startAt))
      .limit(10);
    if (rows.length === 0) return { text: "You have no upcoming registrations.", markup: keyboard([[button.callback("📅 Upcoming tournaments", "ev")], [button.callback("« Menu", "m")]]) };
    return {
      text: `📝 <b>My registrations</b>\n\n${rows.map(({ r, t }) => `• <b>${escapeHtml(t.name)}</b> — ${fmtDate(t.startAt)}\n  ${r.status}${r.waitlistPosition ? ` (#${r.waitlistPosition})` : ""}`).join("\n")}`,
      markup: keyboard([...rows.map(({ t }) => [button.callback(t.name.slice(0, 60), `ev:${t.id}`)]), [button.callback("« Menu", "m")]]),
    };
  }

  private async live(orgId: string, from: TgUser, seatOnly = false): Promise<Reply> {
    const p = await this.playerOf(orgId, from);
    let rows = p
      ? await this.deps.db
          .select({ t: tournaments })
          .from(tournamentRegistrations)
          .innerJoin(tournaments, eq(tournaments.id, tournamentRegistrations.tournamentId))
          .where(and(eq(tournamentRegistrations.playerId, p.playerId), inArray(tournaments.status, [...LIVE, "SEATING"]), inArray(tournamentRegistrations.status, ["CHECKED_IN", "PLAYING", "REGISTERED"])))
      : [];
    if (rows.length === 0 && !seatOnly) {
      rows = await this.deps.db
        .select({ t: tournaments })
        .from(tournaments)
        .where(and(eq(tournaments.organizationId, orgId), inArray(tournaments.status, LIVE), eq(tournaments.published, true)))
        .orderBy(desc(tournaments.startedAt))
        .limit(3);
    }
    if (rows.length === 0) return { text: seatOnly ? "You have no seat in a running tournament." : "No tournament is running right now.", markup: keyboard([[button.callback("« Menu", "m")]]) };
    const parts: string[] = [];
    for (const { t } of rows) {
      const snap = await buildPublicSnapshot(this.deps.db, t, this.deps.now(), { playerId: p?.playerId ?? null });
      if (seatOnly) {
        parts.push(snap.mySeat ? `🪑 <b>${escapeHtml(t.name)}</b>: table <b>${snap.mySeat.tableNumber}</b>, seat <b>${snap.mySeat.seatNumber}</b>` : `🪑 <b>${escapeHtml(t.name)}</b>: no seat assigned yet`);
        continue;
      }
      const levels = await loadLevels(this.deps.db, t.structureId);
      const clock = deriveClock(anchorFromRow(await loadClockRow(this.deps.db, t.id)), levelLikes(levels), this.deps.now().getTime());
      const lvl = levels[clock.levelIndex];
      const blinds = lvl && lvl.type === "PLAY" ? `${lvl.smallBlind.toLocaleString("en")}/${lvl.bigBlind.toLocaleString("en")}${lvl.ante ? ` (ante ${lvl.ante.toLocaleString("en")})` : ""}` : "Break";
      parts.push(
        [
          `🔴 <b>${escapeHtml(t.name)}</b> — ${statusLabel(t.status)}`,
          `Level ${clock.playLevelNumber}${clock.isBreak ? " (break)" : ""}: ${blinds}`,
          `⏱ ${formatClock(clock.remainingMs)}${t.status === "PAUSED" ? " (paused)" : ""}`,
          `👥 ${snap.stats.remaining} of ${snap.stats.entries} entries · avg ${snap.stats.averageStack?.toLocaleString("en") ?? "—"}`,
          snap.mySeat ? `🪑 Your seat: table ${snap.mySeat.tableNumber}, seat ${snap.mySeat.seatNumber}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      );
    }
    return { text: parts.join("\n\n"), markup: keyboard([[button.callback("🔄 Refresh", seatOnly ? "st" : "lv")], [button.callback("« Menu", "m")]]) };
  }

  private async standings(orgId: string, from: TgUser): Promise<Reply> {
    const [league] = await this.deps.db.select().from(leagues).where(and(eq(leagues.organizationId, orgId), eq(leagues.status, "ACTIVE"))).limit(1);
    const [season] = league ? await this.deps.db.select().from(seasons).where(eq(seasons.leagueId, league.id)).orderBy(desc(seasons.startsOn)).limit(1) : [];
    const [snap] = season ? await this.deps.db.select().from(leaderboardSnapshots).where(eq(leaderboardSnapshots.seasonId, season.id)).orderBy(desc(leaderboardSnapshots.computedAt)).limit(1) : [];
    if (!league || !season || !snap) return { text: "No league standings yet.", markup: keyboard([[button.callback("« Menu", "m")]]) };
    const rows = snap.rows as { rank: number; playerId: string; playerName: string; points: number }[];
    const p = await this.playerOf(orgId, from);
    const me = p ? rows.find((r) => r.playerId === p.playerId) : undefined;
    const top = rows.slice(0, 10).map((r) => `${r.rank}. ${escapeHtml(r.playerName)} — ${r.points}`);
    return {
      text: `🏆 <b>${escapeHtml(league.name)}</b> · ${escapeHtml(season.name)}\n\n${top.join("\n")}${me && me.rank > 10 ? `\n…\n${me.rank}. <b>You</b> — ${me.points}` : ""}`,
      markup: keyboard([[button.callback("« Menu", "m")]]),
    };
  }

  private async results(orgId: string, from: TgUser): Promise<Reply> {
    const p = await this.requirePlayer(orgId, from);
    const rows = await this.deps.db
      .select({ r: tournamentResults, t: tournaments })
      .from(tournamentResults)
      .innerJoin(tournaments, eq(tournaments.id, tournamentResults.tournamentId))
      .where(and(eq(tournamentResults.playerId, p.playerId), eq(tournamentResults.status, "FINALIZED")))
      .orderBy(desc(tournaments.startAt))
      .limit(8);
    if (rows.length === 0) return { text: "No finalized results yet.", markup: keyboard([[button.callback("« Menu", "m")]]) };
    return {
      text: `📊 <b>My results</b>\n\n${rows.map(({ r, t }) => `• ${fmtDate(t.startAt)} <b>${escapeHtml(t.name)}</b>: #${r.position}${typeof r.points === "number" ? ` · ${r.points} pts` : ""}`).join("\n")}`,
      markup: keyboard([[button.callback("« Menu", "m")]]),
    };
  }

  private async notificationSettings(orgId: string, from: TgUser, toggle?: NotificationType): Promise<Reply> {
    const p = await this.requirePlayer(orgId, from);
    const types = NOTIFICATION_TYPES.filter((t) => !["STAFF_ALERT", "ANNOUNCEMENT"].includes(t));
    if (toggle && (types as string[]).includes(toggle)) {
      const [cur] = await this.deps.db
        .select()
        .from(notificationPreferences)
        .where(and(eq(notificationPreferences.playerId, p.playerId), eq(notificationPreferences.channel, "TELEGRAM"), eq(notificationPreferences.type, toggle)));
      const enabled = !(cur?.enabled ?? true);
      if (cur) await this.deps.db.update(notificationPreferences).set({ enabled, updatedAt: this.deps.now() }).where(eq(notificationPreferences.id, cur.id));
      else await this.deps.db.insert(notificationPreferences).values({ organizationId: orgId, playerId: p.playerId, channel: "TELEGRAM", type: toggle, enabled });
    }
    const prefs = await this.deps.db.select().from(notificationPreferences).where(and(eq(notificationPreferences.playerId, p.playerId), eq(notificationPreferences.channel, "TELEGRAM")));
    const on = (t: string) => prefs.find((x) => x.type === t)?.enabled ?? true;
    return {
      text: "🔔 <b>Telegram notifications</b>\nTap to switch on/off.",
      markup: keyboard([...types.map((t) => [button.callback(`${on(t) ? "✅" : "❌"} ${t.replace(/_/g, " ").toLowerCase()}`, `nt:${t}`)]), [button.callback("« Menu", "m")]]),
    };
  }

  // --- staff (read-only by default, spec §29) ------------------------------------------------------------

  private async staffOf(orgId: string, from: TgUser) {
    const link = await this.telegram.linkOf(orgId, from.id);
    if (!link?.userId) return null;
    const [m] = await this.deps.db
      .select()
      .from(organizationMembers)
      .where(and(eq(organizationMembers.organizationId, orgId), eq(organizationMembers.userId, link.userId), eq(organizationMembers.status, "ACTIVE")));
    const roles = (m?.roles ?? []).filter((r) => r !== "PLAYER");
    if (roles.length === 0) return null;
    return { userId: link.userId, roles, permissions: permissionsForRoles(roles), venueIds: m?.venueIds ?? null };
  }

  private async staffStatus(orgId: string, from: TgUser): Promise<Reply> {
    const staff = await this.staffOf(orgId, from);
    if (!staff || !staff.permissions.has("edge.read")) return { text: "⛔ Staff access required. Link your staff account in the web app first." };
    const status = await this.edge.status(true);
    const components = await this.edge.components();
    const active = await this.deps.db
      .select()
      .from(tournaments)
      .where(and(eq(tournaments.organizationId, orgId), inArray(tournaments.status, [...LIVE, "SEATING", "REGISTRATION_OPEN"])))
      .orderBy(asc(tournaments.startAt));
    const lines = [
      `🖥 <b>Edge ${escapeHtml(status.nodeId)}</b>: ${status.status}${status.wanOnline ? "" : " (WAN offline)"}`,
      components.map((c) => `${c.state === "OK" ? "🟢" : c.state === "DISABLED" ? "⚪" : c.state === "DEGRADED" ? "🟠" : "🔴"} ${c.name}`).join("  "),
      "",
      ...(active.length ? await Promise.all(active.map(async (t) => this.tournamentLine(t))) : ["No active tournaments."]),
    ];
    return { text: lines.join("\n") };
  }

  private async tournamentLine(t: typeof tournaments.$inferSelect) {
    const snap = await buildPublicSnapshot(this.deps.db, t, this.deps.now(), { playerId: null });
    const levels = await loadLevels(this.deps.db, t.structureId);
    const clock = deriveClock(anchorFromRow(await loadClockRow(this.deps.db, t.id)), levelLikes(levels), this.deps.now().getTime());
    return `🎲 <b>${escapeHtml(t.name)}</b> — ${statusLabel(t.status)}, L${clock.playLevelNumber} ${formatClock(clock.remainingMs)}, ${snap.stats.remaining}/${snap.stats.entries} left, ${snap.stats.registrations} regs`;
  }

  private async staffClockCommand(orgId: string, from: TgUser, action: "PAUSE_CLOCK" | "RESUME_CLOCK", arg?: string): Promise<Reply> {
    const flags = await orgFlags(this.deps.db, orgId);
    if (!flags.telegramStaffCommands) return { text: "⛔ State-changing staff commands are disabled for this organization." };
    const staff = await this.staffOf(orgId, from);
    if (!staff?.permissions.has("tournament.clock.control")) return { text: "⛔ You are not allowed to control the clock." };
    const live = await this.deps.db
      .select()
      .from(tournaments)
      .where(and(eq(tournaments.organizationId, orgId), inArray(tournaments.status, LIVE), arg ? eq(tournaments.slug, arg) : undefined));
    if (live.length !== 1) return { text: live.length === 0 ? "No matching running tournament." : `Several tournaments are running; specify one: ${live.map((t) => t.slug).join(", ")}` };
    const t = live[0]!;
    const nonce = randomUUID().slice(0, 12);
    this.pendingConfirmations.set(nonce, { expiresAt: Date.now() + CONFIRM_TTL_MS, telegramUserId: from.id, tournamentId: t.id, action });
    return {
      text: `⚠️ Confirm <b>${action === "PAUSE_CLOCK" ? "pause" : "resume"}</b> of <b>${escapeHtml(t.name)}</b>? (expires in 60 s)`,
      markup: keyboard([[button.callback("✅ Confirm", `cf:${nonce}`)]]),
    };
  }

  private async confirmStaffCommand(orgId: string, from: TgUser, nonce: string): Promise<Reply> {
    const pending = this.pendingConfirmations.get(nonce);
    this.pendingConfirmations.delete(nonce);
    if (!pending || pending.expiresAt < Date.now() || pending.telegramUserId !== from.id) return { text: "⌛ Confirmation expired." };
    const flags = await orgFlags(this.deps.db, orgId);
    const staff = await this.staffOf(orgId, from);
    if (!flags.telegramStaffCommands || !staff?.permissions.has("tournament.clock.control")) return { text: "⛔ Not allowed." };
    const [t] = await this.deps.db.select().from(tournaments).where(eq(tournaments.id, pending.tournamentId));
    if (!t) return { text: "Tournament not found." };
    const actor: Actor = {
      principal: { kind: "staff", userId: staff.userId, organizationId: orgId, roles: staff.roles, permissions: staff.permissions, venueIds: staff.venueIds },
      userId: staff.userId,
      deviceId: null,
      ip: null,
      channel: "TELEGRAM",
    };
    await this.executor.execute(t.id, { type: pending.action, payload: {}, expectedVersion: t.version, clientOperationId: opId(orgId, `tg-confirm:${nonce}`) }, actor);
    return { text: `✅ ${pending.action === "PAUSE_CLOCK" ? "Paused" : "Resumed"}: ${escapeHtml(t.name)}` };
  }
}

function fmtDate(d: Date) {
  return d.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function statusLabel(s: string) {
  return (
    {
      SCHEDULED: "scheduled",
      REGISTRATION_OPEN: "registration open",
      SEATING: "seating",
      RUNNING: "running",
      BREAK: "on break",
      PAUSED: "paused",
      HAND_FOR_HAND: "hand-for-hand",
      FINISHED: "finished",
      FINALIZED: "final",
      CANCELLED: "cancelled",
    } as Record<string, string>
  )[s] ?? s.toLowerCase();
}
