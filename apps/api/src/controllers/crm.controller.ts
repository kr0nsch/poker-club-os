import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Query, Res } from "@nestjs/common";
import type { Core } from "@pcos/core";
import type { FastifyReply } from "fastify";
import type { RequestState } from "../http/context.js";
import { Ctx } from "../http/decorators.js";
import { CORE } from "../tokens.js";

@Controller("api/v1")
export class PlayersController {
  constructor(@Inject(CORE) private readonly core: Core) {}

  @Get("players")
  search(@Ctx() ctx: RequestState, @Query() query: Record<string, string>) {
    return this.core.players.search(ctx.staff, query);
  }

  @Post("players")
  create(@Ctx() ctx: RequestState, @Body() body: unknown) {
    return this.core.players.create(ctx.staff, body);
  }

  @Get("players/:id")
  get(@Ctx() ctx: RequestState, @Param("id") id: string) {
    return this.core.players.get(ctx.staff, id);
  }

  @Patch("players/:id")
  update(@Ctx() ctx: RequestState, @Param("id") id: string, @Body() body: unknown) {
    return this.core.players.update(ctx.staff, id, body);
  }

  @HttpCode(200)
  @Post("players/:id/anonymize")
  anonymize(@Ctx() ctx: RequestState, @Param("id") id: string) {
    return this.core.players.anonymize(ctx.staff, id);
  }

  @Post("players/:id/notes")
  note(@Ctx() ctx: RequestState, @Param("id") id: string, @Body() body: unknown) {
    return this.core.players.addNote(ctx.staff, id, body);
  }

  @Post("players/:id/tags")
  tag(@Ctx() ctx: RequestState, @Param("id") id: string, @Body() body: unknown) {
    return this.core.players.addTag(ctx.staff, id, body);
  }

  @Delete("players/:id/tags/:tagId")
  untag(@Ctx() ctx: RequestState, @Param("id") id: string, @Param("tagId") tagId: string) {
    return this.core.players.removeTag(ctx.staff, id, tagId);
  }

  @Post("players/:id/consents")
  consent(@Ctx() ctx: RequestState, @Param("id") id: string, @Body() body: unknown) {
    return this.core.players.recordConsent(ctx.staff, id, body);
  }

  @HttpCode(200)
  @Post("players/:id/kiosk-pin")
  kioskPin(@Ctx() ctx: RequestState, @Param("id") id: string, @Body() body: unknown) {
    return this.core.players.setKioskPin(ctx.staff, id, body);
  }

  @Post("players/:id/one-time-code")
  oneTimeCode(@Ctx() ctx: RequestState, @Param("id") id: string) {
    return this.core.players.issueOneTimeCode(ctx.staff, id);
  }

  @Get("player-tags")
  tags(@Ctx() ctx: RequestState) {
    return this.core.players.listTags(ctx.staff);
  }

  // --- CSV import (spec §39) -------------------------------------------------------------

  @Post("imports/players")
  upload(@Ctx() ctx: RequestState, @Body() body: unknown) {
    return this.core.imports.upload(ctx.staff, body);
  }

  @Get("imports/:id")
  getImport(@Ctx() ctx: RequestState, @Param("id") id: string) {
    return this.core.imports.get(ctx.staff, id);
  }

  @HttpCode(200)
  @Post("imports/:id/mapping")
  mapping(@Ctx() ctx: RequestState, @Param("id") id: string, @Body() body: unknown) {
    return this.core.imports.setMapping(ctx.staff, id, body);
  }

  @HttpCode(200)
  @Post("imports/:id/validate")
  validate(@Ctx() ctx: RequestState, @Param("id") id: string) {
    return this.core.imports.validate(ctx.staff, id);
  }

  @HttpCode(200)
  @Post("imports/:id/apply")
  apply(@Ctx() ctx: RequestState, @Param("id") id: string) {
    return this.core.imports.apply(ctx.staff, id);
  }

  // --- exports ------------------------------------------------------------------------------

  @Get("exports/players.csv")
  async exportPlayers(@Ctx() ctx: RequestState, @Res({ passthrough: true }) reply: FastifyReply) {
    const { filename, csv } = await this.core.reports.exportPlayers(ctx.staff);
    reply.header("content-type", "text/csv; charset=utf-8").header("content-disposition", `attachment; filename="${filename}"`);
    return "﻿" + csv;
  }
}
