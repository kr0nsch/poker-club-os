import type { MeView } from "@pcos/types";

const FLOOR_ROLES = new Set(["FLOOR_MANAGER", "REGISTRATION_STAFF", "CASHIER", "DEALER"]);

/** The surface each person lands on after signing in. */
export function homeFor(me: MeView): string {
  if (me.permissions.length > 0) {
    if (me.roles.length > 0 && me.roles.every((r) => r === "DEALER")) return "/dealer";
    if (me.roles.length > 0 && me.roles.every((r) => FLOOR_ROLES.has(r))) return "/floor";
    return "/admin";
  }
  if (me.organization) return `/p/${me.organization.slug}`;
  return "/login";
}
