import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Put, Query, Res } from "@nestjs/common";
import type { Core } from "@pcos/core";
import type { FastifyReply } from "fastify";
import QRCode from "qrcode";
import type { RequestState } from "../http/context.js";
import { Ctx } from "../http/decorators.js";
import { CORE } from "../tokens.js";

@Controller("api/v1")
export class StructuresController {
  constructor(@Inject(CORE) private readonly core: Core) {}

  @Get("structures")
  list(@Ctx() ctx: RequestState) {
    return this.core.structures.list(ctx.staff);
  }

  @Post("structures")
  create(@Ctx() ctx: RequestState, @Body() body: unknown) {
    return this.core.structures.create(ctx.staff, body);
  }

  @Get("structures/:id")
  get(@Ctx() ctx: RequestState, @Param("id") id: string) {
    return this.core.structures.get(ctx.staff, id);
  }

  @Patch("structures/:id")
  rename(@Ctx() ctx: RequestState, @Param("id") id: string, @Body() body: unknown) {
    return this.core.structures.rename(ctx.staff, id, body);
  }

  @Put("structures/:id/levels")
  levels(@Ctx() ctx: RequestState, @Param("id") id: string, @Body() body: unknown) {
    return this.core.structures.replaceLevels(ctx.staff, id, body);
  }

  @Post("structures/:id/duplicate")
  duplicate(@Ctx() ctx: RequestState, @Param("id") id: string, @Body() body: { name?: string }) {
    return this.core.structures.duplicate(ctx.staff, id, body?.name);
  }

  @Delete("structures/:id")
  remove(@Ctx() ctx: RequestState, @Param("id") id: string) {
    return this.core.structures.remove(ctx.staff, id);
  }

  @Get("templates")
  templates(@Ctx() ctx: RequestState) {
    return this.core.structures.listTemplates(ctx.staff);
  }

  @Post("templates")
  createTemplate(@Ctx() ctx: RequestState, @Body() body: unknown) {
    return this.core.structures.saveTemplate(ctx.staff, body);
  }

  @Get("templates/:id")
  template(@Ctx() ctx: RequestState, @Param("id") id: string) {
    return this.core.structures.getTemplate(ctx.staff, id);
  }

  @Put("templates/:id")
  updateTemplate(@Ctx() ctx: RequestState, @Param("id") id: string, @Body() body: unknown) {
    return this.core.structures.saveTemplate(ctx.staff, body, id);
  }

  @Delete("templates/:id")
  deleteTemplate(@Ctx() ctx: RequestState, @Param("id") id: string) {
    return this.core.structures.deleteTemplate(ctx.staff, id);
  }

  @Post("templates/:id/tournaments")
  fromTemplate(@Ctx() ctx: RequestState, @Param("id") id: string, @Body() body: unknown) {
    return this.core.tournaments.createFromTemplate(ctx.staff, id, body);
  }

  @Get("house-rules")
  houseRules(@Ctx() ctx: RequestState) {
    return this.core.structures.listHouseRules(ctx.staff);
  }

  @Post("house-rules")
  createHouseRules(@Ctx() ctx: RequestState, @Body() body: unknown) {
    return this.core.structures.saveHouseRules(ctx.staff, body);
  }

  @Put("house-rules/:id")
  updateHouseRules(@Ctx() ctx: RequestState, @Param("id") id: string, @Body() body: unknown) {
    return this.core.structures.saveHouseRules(ctx.staff, body, id);
  }
}

@Controller("api/v1/tournaments")
export class TournamentsController {
  constructor(@Inject(CORE) private readonly core: Core) {}

  @Get()
  list(@Ctx() ctx: RequestState, @Query() query: Record<string, string>) {
    return this.core.tournaments.list(ctx.staff, query);
  }

  @Post()
  create(@Ctx() ctx: RequestState, @Body() body: unknown) {
    return this.core.tournaments.create(ctx.staff, body);
  }

  @Get(":id")
  get(@Ctx() ctx: RequestState, @Param("id") id: string) {
    return this.core.tournaments.get(ctx.staff, id);
  }

  @Patch(":id")
  update(@Ctx() ctx: RequestState, @Param("id") id: string, @Body() body: unknown) {
    return this.core.tournaments.update(ctx.staff, id, body);
  }

  @Get(":id/snapshot")
  snapshot(@Ctx() ctx: RequestState, @Param("id") id: string) {
    return this.core.tournaments.snapshot(ctx.staff, id);
  }

  /**
   * Single command endpoint for every live mutation (spec §84-85):
   * { type, payload, expectedVersion, clientOperationId }.
   */
  @HttpCode(200)
  @Post(":id/commands")
  command(@Ctx() ctx: RequestState, @Param("id") id: string, @Body() body: unknown) {
    return this.core.executor.execute(id, body, ctx.staff);
  }

  @Get(":id/actions")
  actions(@Ctx() ctx: RequestState, @Param("id") id: string, @Query("limit") limit?: string) {
    return this.core.tournaments.actions(ctx.staff, id, limit ? Number(limit) : 100);
  }

  @Get(":id/movements")
  movements(@Ctx() ctx: RequestState, @Param("id") id: string) {
    return this.core.tournaments.movements(ctx.staff, id);
  }

  @Get(":id/seating/preview")
  seatingPreview(@Ctx() ctx: RequestState, @Param("id") id: string) {
    return this.core.tournaments.seatingPreview(ctx.staff, id);
  }

  @Get(":id/balance/preview")
  balancePreview(@Ctx() ctx: RequestState, @Param("id") id: string) {
    return this.core.tournaments.balancePreview(ctx.staff, id);
  }

  @Get(":id/break/preview")
  breakPreview(@Ctx() ctx: RequestState, @Param("id") id: string, @Query("tableId") tableId?: string) {
    return this.core.tournaments.breakPreview(ctx.staff, id, tableId);
  }

  @Get(":id/results.csv")
  async results(@Ctx() ctx: RequestState, @Param("id") id: string, @Res({ passthrough: true }) reply: FastifyReply) {
    const { filename, csv } = await this.core.reports.exportResults(ctx.staff, id);
    reply.header("content-type", "text/csv; charset=utf-8").header("content-disposition", `attachment; filename="${filename}"`);
    return "﻿" + csv;
  }

  /** QR codes for registration / live page / Telegram deep link (spec §45). */
  @Get(":id/qr")
  async qr(@Ctx() ctx: RequestState, @Param("id") id: string) {
    const t = await this.core.tournaments.get(ctx.staff, id);
    const org = await this.core.org.getOrganization(ctx.staff);
    const venue = await this.core.org.getVenue(org.id, t.venueId);
    const bot = await this.core.bots.config(org.id);
    const local = (venue.localUrl ?? this.core.config.LOCAL_APP_URL ?? null)?.replace(/\/$/, "") ?? null;
    const pub = (this.core.config.APP_URL ?? venue.publicUrl ?? null)?.replace(/\/$/, "") ?? null;
    const links = {
      localRegistration: local ? `${local}/p/${org.slug}/t/${t.slug}` : null,
      localLive: local ? `${local}/p/${org.slug}/live/${t.slug}` : null,
      publicRegistration: pub ? `${pub}/p/${org.slug}/t/${t.slug}` : null,
      telegram: bot.enabled && bot.username ? `https://t.me/${bot.username}?start=t_${t.slug}` : null,
    };
    const codes: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(links)) codes[k] = v ? await QRCode.toDataURL(v, { margin: 1, width: 360 }) : null;
    return { links, qr: codes };
  }
}
