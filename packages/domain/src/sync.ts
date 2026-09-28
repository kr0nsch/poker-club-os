// Edge ↔ cloud synchronisation rules (spec §8). No naive last-write-wins:
// changes carry entity versions and the base version they were derived from.

export type InboundDecision =
  | { action: "APPLY" }
  | { action: "SKIP"; reason: string }
  | { action: "CONFLICT"; reason: string }
  | { action: "REJECT"; reason: string };

export interface InboundChange {
  entityType: string;
  entityId: string;
  /** version of the entity on the cloud after the change */
  remoteVersion: number;
  /** version on the edge the cloud based its change on (last synced) */
  baseVersion: number | null;
  originNodeId: string;
}

export interface LocalEntityState {
  exists: boolean;
  version: number;
  /** version last acknowledged by the cloud for this entity */
  lastSyncedVersion: number | null;
  /** entity is owned by live venue operations (e.g. tournament not in DRAFT/SCHEDULED) */
  lockedByLiveOperation: boolean;
}

/**
 * Decide what to do with a configuration change downloaded from the cloud.
 *  - Changes that originated from this node are echoes → SKIP.
 *  - Live tournament state is authoritative on the edge → REJECT.
 *  - Already-applied or older versions → SKIP.
 *  - If the edge changed the entity since the base version → CONFLICT (recorded, never silently dropped).
 */
export function decideInbound(change: InboundChange, local: LocalEntityState, thisNodeId: string): InboundDecision {
  if (change.originNodeId === thisNodeId) return { action: "SKIP", reason: "echo of a local change" };
  if (!local.exists) return { action: "APPLY" };
  if (local.lockedByLiveOperation) return { action: "REJECT", reason: "entity is controlled by live venue operations" };
  if (change.remoteVersion <= local.version && local.lastSyncedVersion != null && change.remoteVersion <= local.lastSyncedVersion) {
    return { action: "SKIP", reason: "already applied" };
  }
  const localModified = local.lastSyncedVersion == null ? local.version > 0 : local.version > local.lastSyncedVersion;
  if (localModified && change.baseVersion !== local.version) {
    return { action: "CONFLICT", reason: `edge version ${local.version} diverged from cloud base ${change.baseVersion ?? "none"}` };
  }
  return { action: "APPLY" };
}

export interface OutboxItem {
  seq: number;
  sizeBytes: number;
}

/** Take a contiguous batch in sequence order, bounded by count and payload size. */
export function takeBatch<T extends OutboxItem>(pending: readonly T[], maxCount: number, maxBytes: number): T[] {
  const sorted = [...pending].sort((a, b) => a.seq - b.seq);
  const out: T[] = [];
  let bytes = 0;
  for (const item of sorted) {
    if (out.length >= maxCount) break;
    if (out.length > 0 && bytes + item.sizeBytes > maxBytes) break;
    out.push(item);
    bytes += item.sizeBytes;
  }
  return out;
}

/**
 * Advance a cursor after the cloud acknowledged a batch. Only a contiguous
 * prefix of acknowledged sequence numbers may move the cursor, so nothing is
 * skipped if the cloud acknowledged out of order.
 */
export function advanceCursor(cursor: number, batchSeqs: readonly number[], acked: ReadonlySet<number>): number {
  let c = cursor;
  for (const s of [...batchSeqs].sort((a, b) => a - b)) {
    if (!acked.has(s)) break;
    c = s;
  }
  return c;
}
