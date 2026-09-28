import { auditLogs, type Executor } from "@pcos/db";
import type { Actor } from "./actor.js";

export interface AuditEntry {
  organizationId: string | null;
  venueId?: string | null;
  tournamentId?: string | null;
  entityType: string;
  entityId?: string | null;
  action: string;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
}

const actorKind = (actor: Actor) => {
  switch (actor.principal.kind) {
    case "staff":
    case "player":
      return "USER";
    case "system":
      return "SYSTEM";
    case "display":
    case "kiosk":
      return "DEVICE";
    default:
      return "ANONYMOUS";
  }
};

/** Append audit records (spec §73). Never updated or deleted (DB trigger). */
export async function writeAudit(tx: Executor, actor: Actor, edgeNodeId: string, entries: AuditEntry | readonly AuditEntry[], now = new Date()) {
  const list = Array.isArray(entries) ? entries : [entries as AuditEntry];
  if (list.length === 0) return;
  await tx.insert(auditLogs).values(
    list.map((e) => ({
      organizationId: e.organizationId,
      venueId: e.venueId ?? null,
      edgeNodeId,
      actorId: actor.userId,
      actorKind: actorKind(actor),
      deviceId: actor.deviceId,
      tournamentId: e.tournamentId ?? null,
      entityType: e.entityType,
      entityId: e.entityId ?? null,
      action: e.action,
      before: (e.before ?? null) as object | null,
      after: (e.after ?? null) as object | null,
      metadata: { channel: actor.channel, ...(e.metadata ?? {}) },
      ip: actor.ip,
      createdAt: now,
    })),
  );
}
