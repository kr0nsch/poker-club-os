import { canAccessVenue, hasPermission, type Principal } from "@pcos/domain";
import type { Permission } from "@pcos/types";
import { forbidden, unauthenticated } from "./errors.js";

/** Principal extended with the internal "system" actor (workers, verified kiosk flows). */
export type CorePrincipal = Principal | { kind: "system"; organizationId: string | null; name: string };

export type Channel = "WEB" | "TELEGRAM" | "KIOSK" | "DISPLAY" | "SYSTEM" | "CLOUD";

export interface Actor {
  principal: CorePrincipal;
  /** users.id when a human is authenticated */
  userId: string | null;
  /** client device identifier (X-Device-Id), for audit context */
  deviceId: string | null;
  ip: string | null;
  channel: Channel;
  sessionId?: string | null;
}

export const systemActor = (organizationId: string | null, name = "system"): Actor => ({
  principal: { kind: "system", organizationId, name },
  userId: null,
  deviceId: null,
  ip: null,
  channel: "SYSTEM",
});

export function organizationOf(actor: Actor): string | null {
  const p = actor.principal;
  if (p.kind === "anonymous") return null;
  return p.organizationId;
}

export function requireOrganization(actor: Actor): string {
  const org = organizationOf(actor);
  if (!org) throw unauthenticated();
  return org;
}

export function can(actor: Actor, permission: Permission): boolean {
  const p = actor.principal;
  if (p.kind === "system") return true;
  return hasPermission(p, permission);
}

export function requirePermission(actor: Actor, permission: Permission): void {
  if (actor.principal.kind === "anonymous") throw unauthenticated();
  if (!can(actor, permission)) throw forbidden(`missing permission ${permission}`);
}

export function requireStaff(actor: Actor): Extract<CorePrincipal, { kind: "staff" }> | Extract<CorePrincipal, { kind: "system" }> {
  const p = actor.principal;
  if (p.kind === "anonymous") throw unauthenticated();
  if (p.kind !== "staff" && p.kind !== "system") throw forbidden("staff access required");
  return p;
}

/** Tenant + venue isolation check for a concrete resource (spec §36). */
export function assertResourceAccess(actor: Actor, organizationId: string, venueId: string | null): void {
  const p = actor.principal;
  if (p.kind === "system") {
    if (p.organizationId && p.organizationId !== organizationId) throw forbidden("cross-tenant access");
    return;
  }
  if (p.kind === "anonymous") throw unauthenticated();
  if (!canAccessVenue(p, organizationId, venueId)) {
    // Do not reveal existence of resources in other tenants.
    throw forbidden("resource belongs to another organization or venue");
  }
}
