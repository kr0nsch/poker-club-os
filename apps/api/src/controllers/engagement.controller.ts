import { Body, Controller, Delete, Get, Headers, HttpCode, Inject, Param, Post, Put, Query } from "@nestjs/common";
import { AppError, forbidden, type Core } from "@pcos/core";
import { verifyWebhookSecret, type TgUpdate } from "@pcos/telegram";
import type { RequestState } from "../http/context.js";
import { Auth, Ctx, Public, SkipCsrf } from "../http/decorators.js";
import { CORE } from "../tokens.js";

@Controller("api/v1")
export class LeaguesController {
  constructor(@Inject(CORE) private readonly core: Core) {}

  @Get("score-rules")
  rules(@Ctx() ctx: RequestState) {
    return this.core.leagues.listScoreRules(ctx.staff);
  }

  @Post("score-rules")
  createRule(@Ctx() ctx: RequestState, @Body() body: unknown) {
    return this.core.leagues.saveScoreRule(ctx.staff, body);
  }

  @Put("score-rules/:id")
  updateRule(@Ctx() ctx: RequestState, @Param("id") id: string, @Body() body: unknown) {
    return this.core.leagues.saveScoreRule(ctx.staff, body, id);
  }

  @HttpCode(200)
  @Post("score-rules/preview")
  preview(@Ctx() ctx: RequestState, @Body() body: { rule: unknown; entrants?: number; players?: number; buyIn?: number }) {
    return this.core.leagues.previewScoreRule(ctx.staff, body?.rule, body ?? {});
  }

  @Get("leagues")
  leagues(@Ctx() ctx: RequestState) {
    return this.core.leagues.listLeagues(ctx.staff);
  }

  @Post("leagues")
  createLeague(@Ctx() ctx: RequestState, @Body() body: unknown) {
    return this.core.leagues.saveLeague(ctx.staff, body);
  }

  @Put("leagues/:id")
  updateLeague(@Ctx() ctx: RequestState, @Param("id") id: string, @Body() body: unknown) {
    return this.core.leagues.saveLeague(ctx.staff, body, id);
  }

  @Post("leagues/:id/seasons")
  createSeason(@Ctx() ctx: RequestState, @Param("id") id: string, @Body() body: unknown) {
    return this.core.leagues.saveSeason(ctx.staff, id, body);
  }

  @Put("leagues/:id/seasons/:seasonId")
  updateSeason(@Ctx() ctx: RequestState, @Param("id") id: string, @Param("seasonId") seasonId: string, @Body() body: unknown) {
    return this.core.leagues.saveSeason(ctx.staff, id, body, seasonId);
  }

  @Get("series")
  series(@Ctx() ctx: RequestState) {
    return this.core.leagues.listSeries(ctx.staff);
  }

  @Post("series")
  createSeries(@Ctx() ctx: RequestState, @Body() body: unknown) {
    return this.core.leagues.saveSeries(ctx.staff, body);
  }

  @Put("series/:id")
  updateSeries(@Ctx() ctx: RequestState, @Param("id") id: string, @Body() body: unknown) {
    return this.core.leagues.saveSeries(ctx.staff, body, id);
  }

  @Get("seasons/:id/leaderboard")
  leaderboard(@Ctx() ctx: RequestState, @Param("id") id: string) {
    return this.core.leagues.leaderboard(ctx.staff, id);
  }

  @HttpCode(200)
  @Post("seasons/:id/recalculate")
  recalc(@Ctx() ctx: RequestState, @Param("id") id: string) {
    return this.core.leagues.recalculate(ctx.staff, id);
  }
}

@Controller("api/v1")
export class CommunicationController {
  constructor(@Inject(CORE) private readonly core: Core) {}

  @Get("announcements")
  announcements(@Ctx() ctx: RequestState, @Query("tournamentId") tournamentId?: string, @Query("venueId") venueId?: string) {
    return this.core.announcements.list(ctx.staff, { tournamentId, venueId });
  }

  @Post("announcements")
  announce(@Ctx() ctx: RequestState, @Body() body: unknown) {
    return this.core.announcements.create(ctx.staff, body);
  }

  @Get("notifications/queue")
  queue(@Ctx() ctx: RequestState, @Query() q: { status?: string; channel?: string; limit?: string }) {
    return this.core.notifications.queue(ctx.staff, { status: q.status, channel: q.channel, limit: q.limit ? Number(q.limit) : undefined });
  }

  @Get("notifications/:id/deliveries")
  deliveries(@Ctx() ctx: RequestState, @Param("id") id: string) {
    return this.core.notifications.deliveries(ctx.staff, id);
  }

  // --- Telegram administration --------------------------------------------------------------------

  @Get("telegram/integration")
  integration(@Ctx() ctx: RequestState) {
    return this.core.telegram.getIntegration(ctx.staff);
  }

  @Put("telegram/integration")
  saveIntegration(@Ctx() ctx: RequestState, @Body() body: unknown) {
    return this.core.telegram.saveIntegration(ctx.staff, body);
  }

  @HttpCode(200)
  @Post("telegram/test")
  test(@Ctx() ctx: RequestState) {
    return this.core.telegram.testMessage(ctx.staff);
  }

  // --- Telegram account linking (players and staff) ----------------------------------------------------

  @Auth("session")
  @Get("telegram/link")
  linkStatus(@Ctx() ctx: RequestState) {
    return this.core.telegram.linkStatus(ctx.account);
  }

  @Auth("session")
  @Post("telegram/link")
  deepLink(@Ctx() ctx: RequestState) {
    return this.core.telegram.createDeepLink(ctx.account);
  }

  @Auth("session")
  @HttpCode(200)
  @Post("telegram/link/code")
  linkCode(@Ctx() ctx: RequestState, @Body() body: unknown) {
    return this.core.telegram.linkWithCode(ctx.account, body);
  }

  @Auth("session")
  @Delete("telegram/link")
  unlink(@Ctx() ctx: RequestState) {
    return this.core.telegram.unlink(ctx.account);
  }

  /** CLOUD_WEBHOOK mode (spec §20 Mode B): Telegram → gateway → edge. Secret header verified. */
  @Public()
  @SkipCsrf()
  @HttpCode(200)
  @Post("telegram/webhook/:organizationId")
  async webhook(@Param("organizationId") organizationId: string, @Headers("x-telegram-bot-api-secret-token") secret: string | undefined, @Body() update: TgUpdate) {
    const expected = this.core.config.TELEGRAM_WEBHOOK_SECRET;
    if (!expected || !verifyWebhookSecret(secret, expected)) throw forbidden("invalid webhook secret");
    if (!update || typeof update.update_id !== "number") throw new AppError("VALIDATION_ERROR", "invalid update");
    await this.core.bot.handleUpdate(organizationId, update);
    return { ok: true };
  }

  // --- displays & kiosks (administration) ----------------------------------------------------------

  @Get("display-templates")
  templates(@Ctx() ctx: RequestState) {
    return this.core.displays.listTemplates(ctx.staff);
  }

  @Post("display-templates")
  createTemplate(@Ctx() ctx: RequestState, @Body() body: unknown) {
    return this.core.displays.saveTemplate(ctx.staff, body);
  }

  @Put("display-templates/:id")
  updateTemplate(@Ctx() ctx: RequestState, @Param("id") id: string, @Body() body: unknown) {
    return this.core.displays.saveTemplate(ctx.staff, body, id);
  }

  @Delete("display-templates/:id")
  deleteTemplate(@Ctx() ctx: RequestState, @Param("id") id: string) {
    return this.core.displays.deleteTemplate(ctx.staff, id);
  }

  @Get("display-tokens")
  tokens(@Ctx() ctx: RequestState) {
    return this.core.displays.listTokens(ctx.staff);
  }

  @Post("display-tokens")
  createToken(@Ctx() ctx: RequestState, @Body() body: unknown) {
    return this.core.displays.createToken(ctx.staff, body);
  }

  @HttpCode(200)
  @Post("display-tokens/:id/revoke")
  revokeToken(@Ctx() ctx: RequestState, @Param("id") id: string) {
    return this.core.displays.revokeToken(ctx.staff, id);
  }

  // --- audit & analytics ------------------------------------------------------------------------------

  @Get("audit")
  audit(@Ctx() ctx: RequestState, @Query() q: Record<string, string>) {
    return this.core.reports.audit(ctx.staff, q);
  }

  @Get("reports/dashboard")
  dashboard(@Ctx() ctx: RequestState, @Query("venueId") venueId?: string, @Query("tz") tz?: string) {
    return this.core.reports.dashboard(ctx.staff, { venueId, timezone: tz });
  }

  @Get("reports/analytics")
  analytics(@Ctx() ctx: RequestState, @Query("from") from?: string, @Query("to") to?: string) {
    return this.core.reports.analytics(ctx.staff, { from, to });
  }
}

/** Device-token endpoints: TV displays and kiosks (token in the URL, no cookies). */
@Controller("api/v1")
export class DeviceTokenController {
  constructor(@Inject(CORE) private readonly core: Core) {}

  @Public()
  @Get("display/:token/state")
  state(@Param("token") token: string) {
    return this.core.displays.state(token);
  }

  @Public()
  @SkipCsrf()
  @HttpCode(200)
  @Post("kiosk/:token/check-in")
  checkIn(@Param("token") token: string, @Body() body: unknown, @Ctx() ctx: RequestState) {
    return this.core.displays.kioskCheckIn(token, body, ctx.ip);
  }
}
