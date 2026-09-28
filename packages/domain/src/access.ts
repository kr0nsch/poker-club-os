// Authorization rules that do not need I/O: permission checks, tenant and
// venue isolation, and realtime subscription authorization (spec §15, §36, §37).

import type { Audience, Permission, PublicVisibility, TopicKind, TournamentStatus } from "@pcos/types";

export type Principal =
  | {
      kind: "staff";
      userId: string;
      organizationId: string;
      roles: readonly string[];
      permissions: ReadonlySet<Permission>;
      /** null = all venues of the organization */
      venueIds: readonly string[] | null;
      isSuperAdmin?: boolean;
    }
  | { kind: "player"; userId: string; organizationId: string; playerId: string }
  | { kind: "display"; organizationId: string; venueId: string; tournamentId: string | null; displayId: string }
  | { kind: "kiosk"; organizationId: string; venueId: string; tournamentId: string | null; displayId: string }
  | { kind: "anonymous" };

export function hasPermission(p: Principal, permission: Permission): boolean {
  return p.kind === "staff" && (p.isSuperAdmin === true || p.permissions.has(permission));
}

export function canAccessVenue(p: Principal, organizationId: string, venueId: string | null): boolean {
  switch (p.kind) {
    case "staff":
      if (p.isSuperAdmin) return true;
      if (p.organizationId !== organizationId) return false;
      return venueId == null || p.venueIds == null || p.venueIds.includes(venueId);
    case "display":
    case "kiosk":
      return p.organizationId === organizationId && (venueId == null || p.venueId === venueId);
    case "player":
      return p.organizationId === organizationId;
    default:
      return false;
  }
}

export interface TopicTarget {
  kind: TopicKind;
  id: string;
  organizationId: string;
  venueId: string | null;
  /** for tournament and table topics */
  tournamentId?: string | null;
  tournamentStatus?: TournamentStatus;
  published?: boolean;
  publicVisibility?: PublicVisibility;
  /** for table topics: tables assigned to the requesting dealer device */
  dealerTableIds?: readonly string[];
}

export type SubscriptionDecision = { allowed: true; audience: Audience } | { allowed: false; reason: string };

const isPublicTournament = (t: TopicTarget) => t.published === true && t.publicVisibility !== "PRIVATE";

export function authorizeSubscription(p: Principal, t: TopicTarget): SubscriptionDecision {
  const deny = (reason: string): SubscriptionDecision => ({ allowed: false, reason });

  switch (t.kind) {
    case "organization":
      if (p.kind === "staff" && canAccessVenue(p, t.organizationId, null)) return { allowed: true, audience: "staff" };
      return deny("organization topic requires staff membership");

    case "venue":
      if (p.kind === "staff" && canAccessVenue(p, t.organizationId, t.venueId)) return { allowed: true, audience: "staff" };
      if ((p.kind === "display" || p.kind === "kiosk") && canAccessVenue(p, t.organizationId, t.venueId)) {
        return { allowed: true, audience: "public" };
      }
      return deny("venue topic requires venue access");

    case "tournament":
      if (p.kind === "staff") {
        if (!canAccessVenue(p, t.organizationId, t.venueId)) return deny("tournament belongs to another organization or venue");
        if (hasPermission(p, "tournament.read") || hasPermission(p, "dealer.table.operate")) return { allowed: true, audience: "staff" };
        return deny("missing permission tournament.read");
      }
      if (p.kind === "display" || p.kind === "kiosk") {
        if (!canAccessVenue(p, t.organizationId, t.venueId)) return deny("display token is bound to another venue");
        if (p.tournamentId != null && p.tournamentId !== t.id) return deny("display token is bound to another tournament");
        return { allowed: true, audience: "public" };
      }
      // Players and anonymous viewers on venue Wi-Fi: public projection of published tournaments only.
      if (isPublicTournament(t)) return { allowed: true, audience: "public" };
      return deny("tournament is not public");

    case "table":
      if (p.kind === "staff" && canAccessVenue(p, t.organizationId, t.venueId)) {
        if (hasPermission(p, "tournament.read")) return { allowed: true, audience: "staff" };
        if (hasPermission(p, "dealer.table.operate")) {
          if (!t.dealerTableIds || t.dealerTableIds.length === 0 || t.dealerTableIds.includes(t.id)) return { allowed: true, audience: "staff" };
          return deny("dealer device is assigned to another table");
        }
      }
      return deny("table topic requires staff access");

    case "display":
      if ((p.kind === "display" || p.kind === "kiosk") && p.displayId === t.id) return { allowed: true, audience: "public" };
      if (p.kind === "staff" && hasPermission(p, "display.manage") && canAccessVenue(p, t.organizationId, t.venueId)) {
        return { allowed: true, audience: "staff" };
      }
      return deny("display topic requires the display token");
  }
}

/** Whether an event with the given audience may be delivered to a subscription of `subscriptionAudience`. */
export function audienceAllows(subscriptionAudience: Audience, eventAudience: Audience): boolean {
  return subscriptionAudience === "staff" || eventAudience === "public";
}
