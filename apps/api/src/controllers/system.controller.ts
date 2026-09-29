import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Res } from "@nestjs/common";
import type { Core } from "@pcos/core";
import { requirePermission } from "@pcos/core";
import { ChangePasswordInput, LoginInput, SwitchOrganizationInput } from "@pcos/types";
import type { FastifyReply } from "fastify";
import QRCode from "qrcode";
import { clearSessionCookie, setSessionCookie } from "../http/cookies.js";
import type { RequestState } from "../http/context.js";
import { Auth, Ctx, Public, SkipCsrf } from "../http/decorators.js";
import type { RealtimeHub } from "../realtime/hub.js";
import { CORE, REALTIME } from "../tokens.js";

@Controller("health")
export class HealthController {
  constructor(
    @Inject(CORE) private readonly core: Core,
    @Inject(REALTIME) private readonly hub: RealtimeHub,
  ) {}

  @Public()
  @Get("live")
  live() {
    return { status: "ok" };
  }

  @Public()
  @Get("ready")
  async ready(@Res({ passthrough: true }) reply: FastifyReply) {
    const components = await this.core.edge.components({ websocketConnections: this.hub.connectionCount() });
    const db = components.find((c) => c.name === "postgres");
    if (db?.state !== "OK") reply.status(503);
    return { status: db?.state === "OK" ? "ready" : "not_ready" };
  }

  /** WAN unavailable → DEGRADED, never a local failure (spec §81). No secrets here. */
  @Public()
  @Get()
  async health(@Res({ passthrough: true }) reply: FastifyReply) {
    const components = await this.core.edge.components({ websocketConnections: this.hub.connectionCount() });
    const overall = this.core.edge.overall(components);
    if (overall === "DOWN") reply.status(503);
    return { status: overall, components: components.map((c) => ({ name: c.name, state: c.state })), time: new Date().toISOString() };
  }
}

@Controller("api/v1/auth")
export class AuthController {
  constructor(@Inject(CORE) private readonly core: Core) {}

  @Public()
  @Get("setup")
  async setupStatus() {
    return { needsSetup: await this.core.auth.needsSetup() };
  }

  @Public()
  @SkipCsrf()
  @Post("setup")
  async setup(@Body() body: unknown, @Ctx() ctx: RequestState, @Res({ passthrough: true }) reply: FastifyReply) {
    const r = await this.core.auth.initialize(body, ctx.anonymous);
    await this.core.edge.ensureNode();
    const { token } = await this.core.auth.createSession(r.user.id, r.org.id, { ip: ctx.ip, userAgent: ctx.userAgent, deviceId: ctx.deviceId }, "STAFF");
    setSessionCookie(reply, token, this.core.config);
    const resolved = await this.core.auth.resolve(token);
    return this.core.auth.me(resolved);
  }

  @Public()
  @SkipCsrf()
  @HttpCode(200)
  @Post("login")
  async login(@Body() body: unknown, @Ctx() ctx: RequestState, @Res({ passthrough: true }) reply: FastifyReply) {
    const input = LoginInput.parse(body);
    const { token } = await this.core.auth.login(input, { ip: ctx.ip, userAgent: ctx.userAgent, deviceId: ctx.deviceId });
    setSessionCookie(reply, token, this.core.config);
    return this.core.auth.me(await this.core.auth.resolve(token));
  }

  @Public()
  @SkipCsrf()
  @HttpCode(201)
  @Post("signup")
  async signup(@Body() body: unknown, @Ctx() ctx: RequestState, @Res({ passthrough: true }) reply: FastifyReply) {
    const { token } = await this.core.auth.signupPlayer(body, { ip: ctx.ip, userAgent: ctx.userAgent, deviceId: ctx.deviceId });
    setSessionCookie(reply, token, this.core.config);
    return this.core.auth.me(await this.core.auth.resolve(token));
  }

  @Auth("session")
  @HttpCode(200)
  @Post("logout")
  async logout(@Ctx() ctx: RequestState, @Res({ passthrough: true }) reply: FastifyReply) {
    await this.core.auth.logout(ctx.session!.session.id);
    clearSessionCookie(reply, this.core.config);
    return { ok: true };
  }

  @Public()
  @Get("me")
  me(@Ctx() ctx: RequestState) {
    return this.core.auth.me(ctx.session);
  }

  @Auth("session")
  @HttpCode(200)
  @Post("switch-organization")
  async switchOrg(@Body() body: unknown, @Ctx() ctx: RequestState) {
    const { organizationId } = SwitchOrganizationInput.parse(body);
    await this.core.auth.switchOrganization(ctx.session!, organizationId);
    return this.core.auth.me(await this.core.auth.resolveBySessionId(ctx.session!.session.id));
  }

  @Auth("session")
  @HttpCode(200)
  @Post("change-password")
  async changePassword(@Body() body: unknown, @Ctx() ctx: RequestState) {
    const input = ChangePasswordInput.parse(body);
    await this.core.auth.changePassword(ctx.session!, input.currentPassword, input.newPassword);
    return { ok: true };
  }

  /** Telegram Mini App sign-in with server-side initData validation (spec §26). */
  @Public()
  @SkipCsrf()
  @HttpCode(200)
  @Post("telegram-miniapp")
  async miniApp(@Body() body: { organizationSlug?: string; initData?: string }, @Ctx() ctx: RequestState, @Res({ passthrough: true }) reply: FastifyReply) {
    const org = await this.core.org.bySlug(String(body?.organizationSlug ?? ""));
    const { token } = await this.core.telegram.miniAppAuth(org.id, { initData: body?.initData }, { ip: ctx.ip, userAgent: ctx.userAgent });
    setSessionCookie(reply, token, this.core.config);
    return this.core.auth.me(await this.core.auth.resolve(token));
  }
}

@Controller("api/v1")
export class OrganizationController {
  constructor(@Inject(CORE) private readonly core: Core) {}

  @Get("organizations/current")
  org(@Ctx() ctx: RequestState) {
    return this.core.org.getOrganization(ctx.staff);
  }

  @Patch("organizations/current")
  updateOrg(@Ctx() ctx: RequestState, @Body() body: unknown) {
    return this.core.org.updateOrganization(ctx.staff, body);
  }

  @Get("venues")
  venues(@Ctx() ctx: RequestState) {
    return this.core.org.listVenues(ctx.staff);
  }

  @Post("venues")
  createVenue(@Ctx() ctx: RequestState, @Body() body: unknown) {
    return this.core.org.createVenue(ctx.staff, body);
  }

  @Patch("venues/:id")
  updateVenue(@Ctx() ctx: RequestState, @Param("id") id: string, @Body() body: unknown) {
    return this.core.org.updateVenue(ctx.staff, id, body);
  }

  @Get("staff")
  staff(@Ctx() ctx: RequestState) {
    return this.core.org.listStaff(ctx.staff);
  }

  @Post("staff")
  createStaff(@Ctx() ctx: RequestState, @Body() body: unknown) {
    return this.core.org.createStaff(ctx.staff, body);
  }

  @Patch("staff/:userId")
  updateStaff(@Ctx() ctx: RequestState, @Param("userId") userId: string, @Body() body: unknown) {
    return this.core.org.updateStaff(ctx.staff, userId, body);
  }

  @Get("roles")
  roles(@Ctx() ctx: RequestState) {
    return this.core.org.listRoles(ctx.staff);
  }
}

@Controller("api/v1/devices")
export class DevicesController {
  constructor(
    @Inject(CORE) private readonly core: Core,
    @Inject(REALTIME) private readonly hub: RealtimeHub,
  ) {}

  @Get()
  list(@Ctx() ctx: RequestState) {
    return this.core.devices.list(ctx.staff, this.hub);
  }

  @Patch(":id")
  update(@Ctx() ctx: RequestState, @Param("id") id: string, @Body() body: unknown) {
    return this.core.devices.update(ctx.staff, id, body);
  }

  @HttpCode(200)
  @Post(":id/revoke")
  revoke(@Ctx() ctx: RequestState, @Param("id") id: string) {
    return this.core.devices.revoke(ctx.staff, id);
  }

  @HttpCode(200)
  @Post(":id/restore")
  restore(@Ctx() ctx: RequestState, @Param("id") id: string) {
    return this.core.devices.revoke(ctx.staff, id, true);
  }

  @HttpCode(200)
  @Post(":id/disconnect")
  disconnect(@Ctx() ctx: RequestState, @Param("id") id: string) {
    return this.core.devices.disconnect(ctx.staff, id);
  }
}

@Controller("api/v1/edge")
export class EdgeController {
  constructor(
    @Inject(CORE) private readonly core: Core,
    @Inject(REALTIME) private readonly hub: RealtimeHub,
  ) {}

  /** Connectivity state for every client (LOCAL / WAN offline / sync pending). */
  @Public()
  @Get("status")
  status() {
    return this.core.edge.status();
  }

  @Get("health")
  async health(@Ctx() ctx: RequestState) {
    requirePermission(ctx.staff, "edge.read");
    const components = await this.core.edge.components({ websocketConnections: this.hub.connectionCount() });
    return { overall: this.core.edge.overall(components), components, edge: await this.core.edge.status(true) };
  }

  @Get("diagnostics")
  diagnostics(@Ctx() ctx: RequestState) {
    return this.core.edge.diagnostics(ctx.staff, { websocketConnections: this.hub.connectionCount(), clients: this.hub.list() });
  }

  /** Local network info + QR codes so staff never type IP addresses (spec §9, §101). */
  @Get("network")
  async network(@Ctx() ctx: RequestState) {
    const actor = ctx.staff;
    requirePermission(actor, "edge.read");
    const org = await this.core.org.getOrganization(actor);
    const venues = await this.core.org.listVenues(actor);
    const node = await this.core.edge.node();
    const venue = venues.find((v) => v.id === node?.venueId) ?? venues[0];
    const localUrl = (venue?.localUrl ?? this.core.config.LOCAL_APP_URL ?? (venue?.localHostname ? `https://${venue.localHostname}` : null))?.replace(/\/$/, "") ?? null;
    const ip = this.core.edge.localAddress();
    const urls = {
      staff: localUrl ? `${localUrl}/floor` : null,
      admin: localUrl ? `${localUrl}/admin` : null,
      player: localUrl ? `${localUrl}/p/${org.slug}` : null,
      ipFallback: ip ? `https://${ip}` : null,
    };
    const qr = async (u: string | null) => (u ? QRCode.toDataURL(u, { margin: 1, width: 320 }) : null);
    return {
      nodeId: this.core.deps.edgeNodeId,
      localHostname: venue?.localHostname ?? this.core.config.LOCAL_HOSTNAME ?? null,
      localUrl,
      publicUrl: this.core.config.APP_URL ?? null,
      ip,
      connectedClients: this.hub.connectionCount(),
      urls,
      qr: { staff: await qr(urls.staff), player: await qr(urls.player), admin: await qr(urls.admin) },
    };
  }

  @Get("sync")
  sync(@Ctx() ctx: RequestState) {
    return this.core.sync.status(ctx.staff);
  }

  @Get("sync/conflicts")
  conflicts(@Ctx() ctx: RequestState) {
    return this.core.sync.conflicts(ctx.staff);
  }

  @HttpCode(200)
  @Post("sync/conflicts/:id/resolve")
  resolve(@Ctx() ctx: RequestState, @Param("id") id: string, @Body() body: unknown) {
    return this.core.sync.resolveConflict(ctx.staff, id, body);
  }

  @Get("backups")
  backups(@Ctx() ctx: RequestState) {
    return this.core.backups.list(ctx.staff);
  }

  @Post("backups")
  requestBackup(@Ctx() ctx: RequestState) {
    return this.core.backups.request(ctx.staff);
  }
}
