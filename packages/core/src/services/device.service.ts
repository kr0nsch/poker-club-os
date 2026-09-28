// Staff device registry (spec §12-13). Device identity is supplementary audit
// context — it never replaces user authentication.

import { devices, sessions, users } from "@pcos/db";
import { DeviceUpdateInput, topic, type DeviceType } from "@pcos/types";
import { and, asc, eq, isNull } from "drizzle-orm";
import { requireOrganization, requirePermission, type Actor } from "../actor.js";
import { writeAudit } from "../audit.js";
import type { CoreDeps } from "../deps.js";
import { notFound } from "../errors.js";
import { publishEvents } from "../events.js";

export interface PresenceInfo {
  connectionId: string;
  deviceId: string | null;
  userId: string | null;
  principal: string;
  ip: string | null;
  connectedAt: string;
  subscriptions: number;
}

export interface PresenceProvider {
  list(): PresenceInfo[];
}

const TOUCH_INTERVAL_MS = 60_000;

export class DeviceService {
  private readonly cache = new Map<string, { at: number; revoked: boolean }>();

  constructor(private readonly deps: CoreDeps) {}

  /**
   * Register/refresh a device seen on an authenticated request. Writes at most
   * once per minute per device. Returns whether the device has been revoked.
   */
  async touch(
    organizationId: string,
    deviceId: string,
    info: { type?: DeviceType; appVersion?: string | null; userAgent?: string | null; ip?: string | null; userId?: string | null; venueId?: string | null },
  ): Promise<{ revoked: boolean }> {
    const key = `${organizationId}:${deviceId}`;
    const cached = this.cache.get(key);
    const nowMs = this.deps.now().getTime();
    if (cached && nowMs - cached.at < TOUCH_INTERVAL_MS) return { revoked: cached.revoked };
    const now = this.deps.now();
    const [row] = await this.deps.db
      .insert(devices)
      .values({
        organizationId,
        deviceId,
        venueId: info.venueId ?? null,
        name: `${info.type ?? "Device"} ${deviceId.slice(0, 4).toUpperCase()}`,
        type: info.type ?? "OTHER",
        lastSeenAt: now,
        lastIp: info.ip ?? null,
        appVersion: info.appVersion ?? null,
        userAgent: info.userAgent?.slice(0, 300) ?? null,
        currentUserId: info.userId ?? null,
      })
      .onConflictDoUpdate({
        target: [devices.organizationId, devices.deviceId],
        set: {
          lastSeenAt: now,
          lastIp: info.ip ?? null,
          appVersion: info.appVersion ?? null,
          userAgent: info.userAgent?.slice(0, 300) ?? null,
          currentUserId: info.userId ?? null,
          updatedAt: now,
        },
      })
      .returning({ revokedAt: devices.revokedAt });
    const revoked = !!row?.revokedAt;
    this.cache.set(key, { at: nowMs, revoked });
    return { revoked };
  }

  async list(actor: Actor, presence: PresenceProvider | null) {
    requirePermission(actor, "device.manage");
    const orgId = requireOrganization(actor);
    const rows = await this.deps.db
      .select({ d: devices, userName: users.displayName })
      .from(devices)
      .leftJoin(users, eq(users.id, devices.currentUserId))
      .where(eq(devices.organizationId, orgId))
      .orderBy(asc(devices.name));
    const live = presence?.list() ?? [];
    return rows.map(({ d, userName }) => {
      const conns = live.filter((c) => c.deviceId === d.deviceId);
      return {
        id: d.id,
        deviceId: d.deviceId,
        name: d.name,
        type: d.type,
        trusted: d.trusted,
        revoked: !!d.revokedAt,
        venueId: d.venueId,
        assignedTableId: d.assignedTableId,
        ip: conns[0]?.ip ?? d.lastIp,
        lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
        connected: conns.length > 0,
        connections: conns.length,
        currentUser: userName,
        appVersion: d.appVersion,
        createdAt: d.createdAt.toISOString(),
      };
    });
  }

  private async get(orgId: string, id: string) {
    const [d] = await this.deps.db.select().from(devices).where(and(eq(devices.id, id), eq(devices.organizationId, orgId)));
    if (!d) throw notFound("device");
    return d;
  }

  async update(actor: Actor, id: string, raw: unknown) {
    requirePermission(actor, "device.manage");
    const orgId = requireOrganization(actor);
    const input = DeviceUpdateInput.parse(raw);
    const before = await this.get(orgId, id);
    const [d] = await this.deps.db
      .update(devices)
      .set({ ...input, updatedAt: this.deps.now() })
      .where(eq(devices.id, id))
      .returning();
    await writeAudit(this.deps.db, actor, this.deps.edgeNodeId, {
      organizationId: orgId,
      entityType: "device",
      entityId: id,
      action: "DEVICE_UPDATED",
      before: { name: before.name, type: before.type, trusted: before.trusted, assignedTableId: before.assignedTableId },
      after: input,
    });
    await this.announce(orgId, before.deviceId, { updated: true });
    return d!;
  }

  /** Revoke a device: its sessions end and it cannot authenticate until restored. */
  async revoke(actor: Actor, id: string, restore = false) {
    requirePermission(actor, "device.manage");
    const orgId = requireOrganization(actor);
    const d = await this.get(orgId, id);
    const now = this.deps.now();
    await this.deps.db.transaction(async (tx) => {
      await tx.update(devices).set({ revokedAt: restore ? null : now, trusted: restore ? d.trusted : false, updatedAt: now }).where(eq(devices.id, id));
      if (!restore) {
        await tx.update(sessions).set({ revokedAt: now }).where(and(eq(sessions.deviceId, d.deviceId), isNull(sessions.revokedAt)));
      }
      await writeAudit(tx, actor, this.deps.edgeNodeId, { organizationId: orgId, entityType: "device", entityId: id, action: restore ? "DEVICE_RESTORED" : "DEVICE_REVOKED" });
    });
    this.cache.delete(`${orgId}:${d.deviceId}`);
    await this.announce(orgId, d.deviceId, { revoked: !restore, disconnect: !restore });
    return { ok: true };
  }

  /** End the device's current sessions (it can sign in again). */
  async disconnect(actor: Actor, id: string) {
    requirePermission(actor, "device.manage");
    const orgId = requireOrganization(actor);
    const d = await this.get(orgId, id);
    const now = this.deps.now();
    await this.deps.db.update(sessions).set({ revokedAt: now }).where(and(eq(sessions.deviceId, d.deviceId), isNull(sessions.revokedAt)));
    await writeAudit(this.deps.db, actor, this.deps.edgeNodeId, { organizationId: orgId, entityType: "device", entityId: id, action: "DEVICE_DISCONNECTED" });
    await this.announce(orgId, d.deviceId, { disconnect: true });
    return { ok: true };
  }

  private async announce(orgId: string, deviceId: string, data: Record<string, unknown>) {
    await publishEvents(
      this.deps.db,
      { organizationId: orgId, venueId: null, edgeNodeId: this.deps.edgeNodeId },
      [{ name: "device.updated", topics: [topic.organization(orgId)], audience: "staff", data: { deviceId, ...data }, aggregateType: "device", aggregateId: deviceId, syncable: false }],
      this.deps.now(),
    );
  }
}
