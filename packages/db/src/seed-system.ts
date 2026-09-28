import { DEFAULT_ROLE_PERMISSIONS, ROLES } from "@pcos/types";
import { and, eq, isNull } from "drizzle-orm";
import type { Executor } from "./client.js";
import { rolePermissions, roles } from "./schema.js";

const ROLE_NAMES: Record<string, string> = {
  SUPER_ADMIN: "Super administrator",
  ORGANIZATION_OWNER: "Organization owner",
  MANAGER: "Manager",
  TOURNAMENT_DIRECTOR: "Tournament director",
  FLOOR_MANAGER: "Floor manager",
  REGISTRATION_STAFF: "Registration staff",
  CASHIER: "Cashier",
  DEALER: "Dealer",
  MARKETING_MANAGER: "Marketing manager",
  READ_ONLY_ANALYST: "Read-only analyst",
  PLAYER: "Player",
};

/** Idempotently upsert system roles and their permission sets. */
export async function seedSystemRoles(db: Executor): Promise<void> {
  for (const key of ROLES) {
    const existing = await db
      .select({ id: roles.id })
      .from(roles)
      .where(and(isNull(roles.organizationId), eq(roles.key, key)));
    let roleId = existing[0]?.id;
    if (!roleId) {
      const [row] = await db.insert(roles).values({ key, name: ROLE_NAMES[key] ?? key, isSystem: true }).returning({ id: roles.id });
      roleId = row!.id;
    }
    await db.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
    const perms = DEFAULT_ROLE_PERMISSIONS[key];
    if (perms.length > 0) {
      await db.insert(rolePermissions).values(perms.map((permission) => ({ roleId: roleId!, permission })));
    }
  }
}
