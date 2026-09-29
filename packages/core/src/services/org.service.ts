import {
  organizationMembers,
  organizationSettings,
  organizations,
  rolePermissions,
  roles,
  sessions,
  users,
  venues,
} from "@pcos/db";
import {
  DEFAULT_FEATURE_FLAGS,
  OrganizationUpdateInput,
  PERMISSIONS,
  STAFF_ROLES,
  StaffCreateInput,
  StaffUpdateInput,
  VenueInput,
  patchShape,
  topic,
  type FeatureFlags,
} from "@pcos/types";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { assertResourceAccess, requireOrganization, requirePermission, venueScope, type Actor } from "../actor.js";
import { writeAudit } from "../audit.js";
import { hashPassword } from "../crypto.js";
import type { CoreDeps } from "../deps.js";
import { AppError, forbidden, notFound, validation } from "../errors.js";
import { publishEvents } from "../events.js";

export class OrgService {
  constructor(private readonly deps: CoreDeps) {}

  async getOrganization(actor: Actor) {
    const orgId = requireOrganization(actor);
    const [org] = await this.deps.db.select().from(organizations).where(eq(organizations.id, orgId));
    if (!org) throw notFound("organization");
    const settings = await this.settings(orgId);
    return { ...org, settings };
  }

  /** Public lookup by slug (player-facing flows). */
  async bySlug(slug: string) {
    const [o] = await this.deps.db.select().from(organizations).where(eq(organizations.slug, slug));
    if (!o) throw notFound("organization");
    return o;
  }

  async settings(organizationId: string) {
    const [s] = await this.deps.db.select().from(organizationSettings).where(eq(organizationSettings.organizationId, organizationId));
    return {
      locale: s?.locale ?? "en",
      timezone: s?.timezone ?? "Europe/Berlin",
      currency: s?.currency ?? "EUR",
      featureFlags: { ...DEFAULT_FEATURE_FLAGS, ...((s?.featureFlags ?? {}) as Partial<FeatureFlags>) } as FeatureFlags,
      notificationTypes: (s?.notificationTypes ?? {}) as Record<string, boolean>,
      version: s?.version ?? 0,
    };
  }

  async featureFlags(organizationId: string): Promise<FeatureFlags> {
    return (await this.settings(organizationId)).featureFlags;
  }

  async updateOrganization(actor: Actor, raw: unknown) {
    requirePermission(actor, "settings.manage");
    const orgId = requireOrganization(actor);
    const input = OrganizationUpdateInput.parse(raw);
    const before = await this.settings(orgId);
    const now = this.deps.now();
    await this.deps.db.transaction(async (tx) => {
      if (input.name) {
        requirePermission(actor, "organization.manage");
        await tx.update(organizations).set({ name: input.name, updatedAt: now }).where(eq(organizations.id, orgId));
      }
      const featureFlags = { ...before.featureFlags, ...(input.featureFlags ?? {}) };
      const notificationTypes = { ...before.notificationTypes, ...(input.notificationTypes ?? {}) };
      await tx
        .insert(organizationSettings)
        .values({ organizationId: orgId, featureFlags, notificationTypes, locale: input.locale ?? before.locale, timezone: input.timezone ?? before.timezone, currency: input.currency ?? before.currency })
        .onConflictDoUpdate({
          target: organizationSettings.organizationId,
          set: {
            featureFlags,
            notificationTypes,
            locale: input.locale ?? before.locale,
            timezone: input.timezone ?? before.timezone,
            currency: input.currency ?? before.currency,
            version: sql`${organizationSettings.version} + 1`,
            updatedAt: now,
          },
        });
      await writeAudit(tx, actor, this.deps.edgeNodeId, {
        organizationId: orgId,
        entityType: "organization_settings",
        entityId: orgId,
        action: "SETTINGS_UPDATED",
        before: { featureFlags: before.featureFlags, notificationTypes: before.notificationTypes },
        after: input,
      });
      await publishEvents(
        tx,
        { organizationId: orgId, venueId: null, edgeNodeId: this.deps.edgeNodeId },
        [{ name: "organization.updated", topics: [topic.organization(orgId)], audience: "staff", data: { settingsChanged: true }, aggregateType: "organization", aggregateId: orgId }],
        now,
      );
    });
    return this.getOrganization(actor);
  }

  // --- venues ---------------------------------------------------------------------------

  async listVenues(actor: Actor) {
    const orgId = requireOrganization(actor);
    const scope = venueScope(actor);
    if (scope?.length === 0) return [];
    return this.deps.db
      .select()
      .from(venues)
      .where(and(eq(venues.organizationId, orgId), scope ? inArray(venues.id, [...scope]) : undefined))
      .orderBy(asc(venues.name));
  }

  async getVenue(organizationId: string, venueId: string) {
    const [v] = await this.deps.db.select().from(venues).where(and(eq(venues.id, venueId), eq(venues.organizationId, organizationId)));
    if (!v) throw notFound("venue");
    return v;
  }

  async createVenue(actor: Actor, raw: unknown) {
    requirePermission(actor, "venue.manage");
    const orgId = requireOrganization(actor);
    const input = VenueInput.parse(raw);
    const [v] = await this.deps.db
      .insert(venues)
      .values({ organizationId: orgId, ...input, address: input.address ?? null, localHostname: input.localHostname ?? null, localUrl: input.localUrl ?? null, publicUrl: input.publicUrl ?? null })
      .returning();
    await writeAudit(this.deps.db, actor, this.deps.edgeNodeId, { organizationId: orgId, venueId: v!.id, entityType: "venue", entityId: v!.id, action: "VENUE_CREATED", after: input });
    return v!;
  }

  async updateVenue(actor: Actor, venueId: string, raw: unknown) {
    requirePermission(actor, "venue.manage");
    const orgId = requireOrganization(actor);
    const before = await this.getVenue(orgId, venueId);
    assertResourceAccess(actor, orgId, venueId);
    const input = z.object(patchShape(VenueInput.shape)).parse(raw);
    const [v] = await this.deps.db
      .update(venues)
      .set({ ...input, version: before.version + 1, updatedAt: this.deps.now() })
      .where(eq(venues.id, venueId))
      .returning();
    await writeAudit(this.deps.db, actor, this.deps.edgeNodeId, { organizationId: orgId, venueId, entityType: "venue", entityId: venueId, action: "VENUE_UPDATED", before, after: input });
    return v!;
  }

  // --- staff & roles ------------------------------------------------------------------------

  async listRoles(actor: Actor) {
    const orgId = requireOrganization(actor);
    const rows = await this.deps.db
      .select({ id: roles.id, key: roles.key, name: roles.name, isSystem: roles.isSystem, permission: rolePermissions.permission })
      .from(roles)
      .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .where(or(isNull(roles.organizationId), eq(roles.organizationId, orgId)));
    const byKey = new Map<string, { key: string; name: string; isSystem: boolean; permissions: string[] }>();
    for (const r of rows) {
      const e = byKey.get(r.key) ?? { key: r.key, name: r.name, isSystem: r.isSystem, permissions: [] };
      if (r.permission) e.permissions.push(r.permission);
      byKey.set(r.key, e);
    }
    return { roles: [...byKey.values()], permissions: PERMISSIONS };
  }

  async listStaff(actor: Actor) {
    requirePermission(actor, "staff.manage");
    const orgId = requireOrganization(actor);
    const rows = await this.deps.db
      .select({ m: organizationMembers, u: { id: users.id, email: users.email, displayName: users.displayName, status: users.status, lastLoginAt: users.lastLoginAt } })
      .from(organizationMembers)
      .innerJoin(users, eq(users.id, organizationMembers.userId))
      .where(eq(organizationMembers.organizationId, orgId))
      .orderBy(asc(users.displayName));
    return rows
      .filter((r) => r.m.roles.some((x) => x !== "PLAYER"))
      .map((r) => ({ ...r.u, memberId: r.m.id, roles: r.m.roles, venueIds: r.m.venueIds, memberStatus: r.m.status }));
  }

  private assertAssignable(actor: Actor, roleKeys: readonly string[], customKeys: readonly string[]) {
    const p = actor.principal;
    const isOwner = p.kind === "system" || (p.kind === "staff" && (p.isSuperAdmin || p.roles.includes("ORGANIZATION_OWNER")));
    for (const r of roleKeys) {
      if (r === "SUPER_ADMIN" || r === "PLAYER") throw forbidden(`role ${r} cannot be assigned here`);
      if (r === "ORGANIZATION_OWNER" && !isOwner) throw forbidden("only an owner can grant the owner role");
      if (!(STAFF_ROLES as readonly string[]).includes(r) && !customKeys.includes(r)) throw validation(`unknown role ${r}`);
    }
  }

  private async customRoleKeys(orgId: string) {
    const rows = await this.deps.db.select({ key: roles.key }).from(roles).where(eq(roles.organizationId, orgId));
    return rows.map((r) => r.key);
  }

  async createStaff(actor: Actor, raw: unknown) {
    requirePermission(actor, "staff.manage");
    const orgId = requireOrganization(actor);
    const input = StaffCreateInput.parse(raw);
    this.assertAssignable(actor, input.roles, await this.customRoleKeys(orgId));
    const passwordHash = await hashPassword(input.password);
    return this.deps.db.transaction(async (tx) => {
      let [user] = await tx.select().from(users).where(eq(users.email, input.email));
      if (!user) {
        [user] = await tx.insert(users).values({ email: input.email, displayName: input.displayName, passwordHash }).returning();
      }
      const [existing] = await tx
        .select()
        .from(organizationMembers)
        .where(and(eq(organizationMembers.organizationId, orgId), eq(organizationMembers.userId, user!.id)));
      if (existing && existing.roles.some((r) => r !== "PLAYER")) throw new AppError("DUPLICATE", "this user is already a staff member");
      const roles = [...new Set([...(existing?.roles ?? []), ...input.roles])];
      if (existing) {
        await tx.update(organizationMembers).set({ roles, venueIds: input.venueIds, status: "ACTIVE", updatedAt: this.deps.now() }).where(eq(organizationMembers.id, existing.id));
      } else {
        await tx.insert(organizationMembers).values({ organizationId: orgId, userId: user!.id, roles, venueIds: input.venueIds });
      }
      await writeAudit(tx, actor, this.deps.edgeNodeId, {
        organizationId: orgId,
        entityType: "staff",
        entityId: user!.id,
        action: "STAFF_CREATED",
        after: { email: input.email, roles: input.roles, venueIds: input.venueIds },
      });
      return { id: user!.id, email: user!.email, displayName: user!.displayName, roles };
    });
  }

  async updateStaff(actor: Actor, userId: string, raw: unknown) {
    requirePermission(actor, "staff.manage");
    const orgId = requireOrganization(actor);
    const input = StaffUpdateInput.parse(raw);
    const [m] = await this.deps.db
      .select()
      .from(organizationMembers)
      .where(and(eq(organizationMembers.organizationId, orgId), eq(organizationMembers.userId, userId)));
    if (!m) throw notFound("staff member");
    if (input.roles) this.assertAssignable(actor, input.roles, await this.customRoleKeys(orgId));
    // Never leave an organization without an active owner.
    const losingOwner =
      m.roles.includes("ORGANIZATION_OWNER") && ((input.roles && !input.roles.includes("ORGANIZATION_OWNER")) || input.status === "DISABLED");
    if (losingOwner) {
      const owners = await this.deps.db
        .select({ id: organizationMembers.id })
        .from(organizationMembers)
        .where(and(eq(organizationMembers.organizationId, orgId), eq(organizationMembers.status, "ACTIVE"), sql`'ORGANIZATION_OWNER' = any(${organizationMembers.roles})`));
      if (owners.length <= 1) throw forbidden("cannot remove the last organization owner");
    }
    if (m.roles.includes("ORGANIZATION_OWNER") && !this.isOwner(actor)) throw forbidden("only an owner can modify another owner");
    const now = this.deps.now();
    await this.deps.db.transaction(async (tx) => {
      await tx
        .update(organizationMembers)
        .set({
          roles: input.roles ? [...new Set([...input.roles, ...(m.roles.includes("PLAYER") ? ["PLAYER"] : [])])] : m.roles,
          venueIds: input.venueIds === undefined ? m.venueIds : input.venueIds,
          status: input.status ?? m.status,
          updatedAt: now,
        })
        .where(eq(organizationMembers.id, m.id));
      if (input.displayName || input.password) {
        await tx
          .update(users)
          .set({ ...(input.displayName ? { displayName: input.displayName } : {}), ...(input.password ? { passwordHash: await hashPassword(input.password) } : {}), updatedAt: now })
          .where(eq(users.id, userId));
      }
      if (input.status === "DISABLED" || input.password || input.roles) {
        // Permissions changed: force re-authentication everywhere.
        await tx.update(sessions).set({ revokedAt: now }).where(and(eq(sessions.userId, userId), eq(sessions.organizationId, orgId), isNull(sessions.revokedAt)));
      }
      await writeAudit(tx, actor, this.deps.edgeNodeId, {
        organizationId: orgId,
        entityType: "staff",
        entityId: userId,
        action: "STAFF_UPDATED",
        before: { roles: m.roles, venueIds: m.venueIds, status: m.status },
        after: { ...input, password: input.password ? "<changed>" : undefined },
      });
      await publishEvents(
        tx,
        { organizationId: orgId, venueId: null, edgeNodeId: this.deps.edgeNodeId },
        [{ name: "session.revoked", topics: [topic.organization(orgId)], audience: "staff", data: { userId }, aggregateType: "user", aggregateId: userId, syncable: false }],
        now,
      );
    });
    return { ok: true };
  }

  private isOwner(actor: Actor) {
    const p = actor.principal;
    return p.kind === "system" || (p.kind === "staff" && (p.isSuperAdmin === true || p.roles.includes("ORGANIZATION_OWNER")));
  }
}
