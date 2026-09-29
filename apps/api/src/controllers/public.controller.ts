// Player experience API (spec §68, §75): works directly over guest Wi-Fi
// against the edge server — no WAN bandwidth, no Internet dependency.

import { randomUUID } from "node:crypto";
import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Put, Query } from "@nestjs/common";
import { notFound, type Core } from "@pcos/core";
import { players, tournamentRegistrations, tournaments } from "@pcos/db";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { RequestState } from "../http/context.js";
import { Auth, Ctx, Public } from "../http/decorators.js";
import { CORE } from "../tokens.js";

const RegisterBody = z.object({ clientOperationId: z.uuid().optional(), source: z.enum(["PLAYER_WEB", "PLAYER_QR", "TELEGRAM_MINI_APP"]).default("PLAYER_WEB") });

@Controller("api/v1/public")
export class PublicController {
  constructor(@Inject(CORE) private readonly core: Core) {}

  @Public()
  @Get("orgs/:slug/tournaments")
  tournaments(@Param("slug") slug: string, @Query("past") past?: string) {
    return this.core.tournaments.publicList(slug, { includePast: past === "1" });
  }

  @Public()
  @Get("orgs/:slug/leaderboards")
  leaderboards(@Param("slug") slug: string) {
    return this.core.leagues.publicLeaderboards(slug);
  }

  /** Live page: clock, blinds, stats, announcements, own seat when signed in (spec §68). */
  @Public()
  @Get("tournaments/:idOrSlug/live")
  live(@Param("idOrSlug") idOrSlug: string, @Query("org") org: string | undefined, @Ctx() ctx: RequestState) {
    return this.core.tournaments.publicLive(idOrSlug, { playerId: ctx.session?.player?.playerId ?? null, orgSlug: org });
  }

  @Auth("player")
  @HttpCode(200)
  @Post("tournaments/:id/register")
  async register(@Param("id") id: string, @Body() body: unknown, @Ctx() ctx: RequestState) {
    const input = RegisterBody.parse(body ?? {});
    const actor = ctx.player;
    const t = await this.core.tournaments.publicRow(id);
    if (actor.principal.kind !== "player" || t.organizationId !== actor.principal.organizationId) throw notFound("tournament");
    return this.core.executor.execute(
      t.id,
      {
        type: "REGISTER_PLAYER",
        payload: { playerId: actor.principal.playerId, source: input.source, reserveOnly: false },
        expectedVersion: t.version,
        clientOperationId: input.clientOperationId ?? randomUUID(),
      },
      actor,
    );
  }

  @Auth("player")
  @HttpCode(200)
  @Post("tournaments/:id/cancel")
  async cancel(@Param("id") id: string, @Body() body: { clientOperationId?: string }, @Ctx() ctx: RequestState) {
    const actor = ctx.player;
    if (actor.principal.kind !== "player") throw notFound("registration");
    const t = await this.core.tournaments.publicRow(id);
    const [reg] = await this.core.db
      .select()
      .from(tournamentRegistrations)
      .where(and(eq(tournamentRegistrations.tournamentId, t.id), eq(tournamentRegistrations.playerId, actor.principal.playerId), inArray(tournamentRegistrations.status, ["RESERVED", "REGISTERED", "WAITLISTED"])));
    if (!reg) throw notFound("registration");
    return this.core.executor.execute(
      t.id,
      { type: "CANCEL_REGISTRATION", payload: { registrationId: reg.id }, expectedVersion: t.version, clientOperationId: body?.clientOperationId ?? randomUUID() },
      actor,
    );
  }
}

@Controller("api/v1/me")
export class MeController {
  constructor(@Inject(CORE) private readonly core: Core) {}

  @Auth("player")
  @Get("registrations")
  async registrations(@Ctx() ctx: RequestState) {
    const p = ctx.player.principal as { playerId: string };
    return this.core.db
      .select({
        registrationId: tournamentRegistrations.id,
        status: tournamentRegistrations.status,
        checkInCode: tournamentRegistrations.checkInCode,
        waitlistPosition: tournamentRegistrations.waitlistPosition,
        tournamentId: tournaments.id,
        name: tournaments.name,
        slug: tournaments.slug,
        startAt: tournaments.startAt,
        tournamentStatus: tournaments.status,
      })
      .from(tournamentRegistrations)
      .innerJoin(tournaments, eq(tournaments.id, tournamentRegistrations.tournamentId))
      .where(and(eq(tournamentRegistrations.playerId, p.playerId), inArray(tournaments.status, ["SCHEDULED", "REGISTRATION_OPEN", "SEATING", "RUNNING", "BREAK", "PAUSED", "HAND_FOR_HAND"])))
      .orderBy(asc(tournaments.startAt));
  }

  @Auth("player")
  @Get("profile")
  async profile(@Ctx() ctx: RequestState) {
    const p = ctx.player.principal as { playerId: string };
    const [row] = await this.core.db.select().from(players).where(eq(players.id, p.playerId));
    if (!row) throw notFound("player");
    return { ...this.core.players.summary(row), language: row.language, history: await this.core.players.history(row.id) };
  }

  @Auth("player")
  @Patch("profile")
  updateProfile(@Ctx() ctx: RequestState, @Body() body: unknown) {
    return this.core.players.updateOwnProfile(ctx.player, body);
  }

  @Auth("player")
  @Post("one-time-code")
  oneTimeCode(@Ctx() ctx: RequestState) {
    const p = ctx.player.principal as { playerId: string };
    return this.core.players.issueOneTimeCode(ctx.player, p.playerId);
  }

  @Auth("player")
  @Get("notifications")
  inbox(@Ctx() ctx: RequestState) {
    return this.core.notifications.inbox(ctx.player);
  }

  @Auth("player")
  @HttpCode(200)
  @Post("notifications/read")
  read(@Ctx() ctx: RequestState, @Body() body: { ids?: string[] | "all" }) {
    return this.core.notifications.markRead(ctx.player, body?.ids ?? "all");
  }

  @Auth("player")
  @Get("notification-preferences")
  prefs(@Ctx() ctx: RequestState) {
    return this.core.notifications.preferences(ctx.player);
  }

  @Auth("player")
  @Put("notification-preferences")
  setPref(@Ctx() ctx: RequestState, @Body() body: unknown) {
    return this.core.notifications.setPreference(ctx.player, body);
  }
}
