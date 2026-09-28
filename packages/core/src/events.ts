// Durable outbox + local realtime signalling (spec §8, §14, §86).
//
// Every domain event is inserted into outbox_events inside the same
// transaction as the state change. The same transaction issues
// pg_notify('pcos_realtime', ...), which PostgreSQL delivers to listeners
// only after COMMIT. API processes LISTEN on that channel and push the event
// to authorised WebSocket subscribers. So:
//   * a rolled-back command never broadcasts;
//   * worker-originated changes (clock auto-advance) reach clients the same way;
//   * no external system is ever inside the critical path.

import { outboxEvents, type Executor } from "@pcos/db";
import type { Audience, RealtimeEvent, RealtimeEventName } from "@pcos/types";
import { sql } from "drizzle-orm";

export const REALTIME_CHANNEL = "pcos_realtime";
/** pg_notify payload limit is 8000 bytes; larger events are sent by reference. */
const MAX_INLINE_NOTIFY_BYTES = 7_500;

export interface PendingEvent {
  name: RealtimeEventName;
  topics: string[];
  audience: Audience;
  data: unknown;
  tournamentVersion?: number;
  /** outbox / sync metadata */
  aggregateType: string;
  aggregateId: string;
  entityVersion?: number | null;
  /** replicate to the cloud control plane (default true) */
  syncable?: boolean;
  /** broadcast over the local WebSocket (default true) */
  realtime?: boolean;
}

export interface EventScope {
  organizationId: string | null;
  venueId: string | null;
  edgeNodeId: string;
}

/** Insert events into the outbox and signal local listeners (delivered on commit). */
export async function publishEvents(tx: Executor, scope: EventScope, events: readonly PendingEvent[], now: Date): Promise<void> {
  if (events.length === 0) return;
  const rows = await tx
    .insert(outboxEvents)
    .values(
      events.map((e) => ({
        organizationId: scope.organizationId,
        venueId: scope.venueId,
        edgeNodeId: scope.edgeNodeId,
        aggregateType: e.aggregateType,
        aggregateId: e.aggregateId,
        eventType: e.name,
        entityVersion: e.entityVersion ?? e.tournamentVersion ?? null,
        payload: e.data as object,
        realtime: e.realtime === false ? null : { topics: e.topics, audience: e.audience, tournamentVersion: e.tournamentVersion ?? null },
        syncable: e.syncable ?? true,
        syncStatus: e.syncable === false ? ("SKIPPED" as const) : ("PENDING" as const),
        occurredAt: now,
      })),
    )
    .returning({ seq: outboxEvents.seq });

  const occurredAt = now.toISOString();
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    if (e.realtime === false) continue;
    const message: RealtimeEvent = {
      name: e.name,
      topics: e.topics,
      audience: e.audience,
      data: e.data,
      tournamentVersion: e.tournamentVersion,
      occurredAt,
      seq: rows[i]!.seq,
    };
    let payload = JSON.stringify(message);
    if (Buffer.byteLength(payload) > MAX_INLINE_NOTIFY_BYTES) payload = JSON.stringify({ ref: rows[i]!.seq });
    await tx.execute(sql`select pg_notify(${REALTIME_CHANNEL}, ${payload})`);
  }
}

/** Resolve a by-reference notification into a full event. */
export async function loadRealtimeEvent(db: Executor, seq: number): Promise<RealtimeEvent | null> {
  const rows = await db.execute<{
    event_type: RealtimeEventName;
    payload: unknown;
    realtime: { topics: string[]; audience: Audience; tournamentVersion: number | null } | null;
    occurred_at: Date;
  }>(sql`select event_type, payload, realtime, occurred_at from outbox_events where seq = ${seq}`);
  const r = rows.rows[0];
  if (!r || !r.realtime) return null;
  return {
    name: r.event_type,
    topics: r.realtime.topics,
    audience: r.realtime.audience,
    data: r.payload,
    tournamentVersion: r.realtime.tournamentVersion ?? undefined,
    occurredAt: new Date(r.occurred_at).toISOString(),
    seq,
  };
}
