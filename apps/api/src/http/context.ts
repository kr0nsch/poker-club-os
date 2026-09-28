// Per-request security context. The venue LAN is not trusted (spec §87):
// every request is authenticated and authorised the same way regardless of
// the network it comes from.

import type { Actor, ResolvedSession } from "@pcos/core";
import { forbidden, unauthenticated } from "@pcos/core";
import type { FastifyRequest } from "fastify";

export const SESSION_COOKIE = "pcos_session";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class RequestState {
  constructor(
    readonly ip: string | null,
    readonly userAgent: string | null,
    readonly deviceId: string | null,
    readonly session: ResolvedSession | null,
  ) {}

  private base(): Omit<Actor, "principal"> {
    return { userId: this.session?.user.id ?? null, deviceId: this.deviceId, ip: this.ip, channel: "WEB", sessionId: this.session?.session.id ?? null };
  }

  /** Staff actor; throws when the session has no staff roles. */
  get staff(): Actor {
    if (!this.session) throw unauthenticated();
    if (!this.session.staff) throw forbidden("staff access required");
    return { ...this.base(), principal: this.session.staff };
  }

  /** Player actor (the player profile of the signed-in user). */
  get player(): Actor {
    if (!this.session) throw unauthenticated();
    if (!this.session.player) throw forbidden("player profile required");
    return { ...this.base(), principal: this.session.player };
  }

  /** Staff if available, otherwise player, otherwise anonymous. */
  get any(): Actor {
    const p = this.session?.staff ?? this.session?.player ?? ({ kind: "anonymous" } as const);
    return { ...this.base(), principal: p };
  }

  /** Staff or player principal for account-level features (Telegram linking). */
  get account(): Actor {
    if (!this.session) throw unauthenticated();
    const p = this.session.player ?? this.session.staff;
    if (!p) throw forbidden("account required");
    return { ...this.base(), principal: p };
  }

  get anonymous(): Actor {
    return { ...this.base(), principal: { kind: "anonymous" } };
  }
}

export function readDeviceId(req: FastifyRequest): string | null {
  const raw = req.headers["x-device-id"];
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v && UUID_RE.test(v) ? v.toLowerCase() : null;
}

declare module "fastify" {
  interface FastifyRequest {
    pcos?: RequestState;
  }
}
