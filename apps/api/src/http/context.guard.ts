import { Inject, Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AppError, forbidden, safeEqual, unauthenticated, type Core } from "@pcos/core";
import type { DeviceType } from "@pcos/types";
import { DEVICE_TYPES } from "@pcos/types";
import type { FastifyRequest } from "fastify";
import { CORE } from "../tokens.js";
import { RequestState, SESSION_COOKIE, readDeviceId } from "./context.js";
import { AUTH_MODE, SKIP_CSRF, type AuthMode } from "./decorators.js";

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

@Injectable()
export class ContextGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(CORE) private readonly core: Core,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const targets = [context.getHandler(), context.getClass()];
    const mode = this.reflector.getAllAndOverride<AuthMode | undefined>(AUTH_MODE, targets) ?? "staff";
    const skipCsrf = this.reflector.getAllAndOverride<boolean | undefined>(SKIP_CSRF, targets) ?? false;

    // Coarse per-IP limit protecting the edge from a misbehaving or hostile LAN device.
    const limit = await this.core.deps.rateLimiter.hit(`api:${req.ip}`, 1500, 60);
    if (!limit.allowed) throw new AppError("RATE_LIMITED", "too many requests");

    const token = req.cookies?.[SESSION_COOKIE];
    const session = token ? await this.core.auth.resolve(token) : null;
    const state = new RequestState(req.ip ?? null, (req.headers["user-agent"] as string | undefined) ?? null, readDeviceId(req), session);
    req.pcos = state;

    if (UNSAFE.has(req.method)) {
      this.checkOrigin(req);
      if (session && !skipCsrf) {
        const header = req.headers["x-csrf-token"];
        const value = Array.isArray(header) ? header[0] : header;
        if (!value || !safeEqual(value, session.session.csrfToken)) throw new AppError("CSRF_REJECTED", "missing or invalid CSRF token");
      }
    }

    // Registered staff devices: a revoked device cannot act, whoever signs in on it.
    if (session?.staff && state.deviceId && session.session.organizationId) {
      const typeHeader = req.headers["x-device-type"] as string | undefined;
      const type = (DEVICE_TYPES as readonly string[]).includes(typeHeader ?? "") ? (typeHeader as DeviceType) : undefined;
      const { revoked } = await this.core.devices.touch(session.session.organizationId, state.deviceId, {
        type,
        appVersion: (req.headers["x-app-version"] as string | undefined) ?? null,
        userAgent: state.userAgent,
        ip: state.ip,
        userId: session.user.id,
      });
      if (revoked) throw new AppError("DEVICE_REVOKED", "this device has been revoked by an administrator");
    }

    switch (mode) {
      case "public":
        return true;
      case "session":
        if (!session) throw unauthenticated();
        return true;
      case "player":
        if (!session) throw unauthenticated();
        if (!session.player) throw forbidden("player profile required");
        return true;
      case "staff":
      default:
        if (!session) throw unauthenticated();
        if (!session.staff) throw forbidden("staff access required");
        return true;
    }
  }

  /** Reject cross-site state-changing requests (defence in depth next to SameSite + CSRF token). */
  private checkOrigin(req: FastifyRequest) {
    const origin = (req.headers.origin as string | undefined) ?? null;
    if (!origin) return; // non-browser clients (curl, kiosk scripts) send no Origin
    let host: string;
    try {
      host = new URL(origin).host;
    } catch {
      throw new AppError("CSRF_REJECTED", "invalid Origin header");
    }
    const forwardedHost = (req.headers["x-forwarded-host"] as string | undefined)?.split(",")[0]?.trim();
    const allowed = new Set([req.headers.host, forwardedHost, ...this.core.config.ALLOWED_ORIGINS.map((o) => safeHost(o))].filter(Boolean));
    if (!allowed.has(host)) throw new AppError("CSRF_REJECTED", `cross-origin request from ${host} rejected`);
  }
}

function safeHost(o: string) {
  try {
    return new URL(o).host;
  } catch {
    return o;
  }
}
