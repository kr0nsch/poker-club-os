// Outbox consumer that maps domain events to notifications (spec §27, §30).
// Runs in the worker. Processing a batch and advancing the cursor happen in
// one transaction, so every event is fanned out exactly once.

import {
  leagues,
  organizations,
  outboxEvents,
  seasons,
  syncCursors,
  telegramSubscriptions,
  tournamentEntries,
  tournamentRegistrations,
  tournamentResults,
  tournaments,
  venues,
  type Executor,
} from "@pcos/db";
import { and, asc, eq, gt, inArray } from "drizzle-orm";
import type { CoreDeps } from "../deps.js";
import type { NotificationService } from "./notification.service.js";

const CONSUMER = "notification-fanout";

type EventRow = typeof outboxEvents.$inferSelect;
type Data = Record<string, unknown>;

export class NotificationFanout {
  constructor(
    private readonly deps: CoreDeps,
    private readonly notifications: NotificationService,
  ) {}

  /** Process one batch; returns the number of events consumed. */
  async runOnce(batchSize = 200): Promise<number> {
    return this.deps.db.transaction(async (tx) => {
      await tx.insert(syncCursors).values({ consumer: CONSUMER, position: 0 }).onConflictDoNothing();
      const [cursor] = await tx.select().from(syncCursors).where(eq(syncCursors.consumer, CONSUMER)).for("update");
      const events = await tx
        .select()
        .from(outboxEvents)
        .where(gt(outboxEvents.seq, cursor!.position))
        .orderBy(asc(outboxEvents.seq))
        .limit(batchSize);
      if (events.length === 0) return 0;
      for (const e of events) {
        try {
          await this.handle(tx, e);
        } catch (err) {
          // A mapping bug must not block the queue; the event itself stays in the outbox.
          console.error(`[fanout] event ${e.seq} (${e.eventType}) failed:`, err instanceof Error ? err.message : err);
        }
      }
      await tx
        .update(syncCursors)
        .set({ position: events[events.length - 1]!.seq, updatedAt: this.deps.now(), lastError: null })
        .where(eq(syncCursors.consumer, CONSUMER));
      return events.length;
    });
  }

  private async tournamentInfo(db: Executor, id: string) {
    const [row] = await db
      .select({ t: tournaments, timezone: venues.timezone, publicUrl: venues.publicUrl, orgSlug: organizations.slug })
      .from(tournaments)
      .innerJoin(venues, eq(venues.id, tournaments.venueId))
      .innerJoin(organizations, eq(organizations.id, tournaments.organizationId))
      .where(eq(tournaments.id, id));
    if (!row) return null;
    // Links leave the venue (Telegram, e-mail): only a public address makes sense here.
    const base = this.deps.config.APP_URL ?? row.publicUrl ?? null;
    return {
      row: row.t,
      payload: {
        tournamentId: row.t.id,
        tournamentName: row.t.name,
        startAt: row.t.startAt.toISOString(),
        timezone: row.timezone,
        url: base ? `${base.replace(/\/$/, "")}/p/${row.orgSlug}/t/${row.t.slug}` : undefined,
      },
    };
  }

  private async registeredPlayers(db: Executor, tournamentId: string) {
    const rows = await db
      .select({ playerId: tournamentRegistrations.playerId })
      .from(tournamentRegistrations)
      .where(and(eq(tournamentRegistrations.tournamentId, tournamentId), inArray(tournamentRegistrations.status, ["REGISTERED", "RESERVED", "CHECKED_IN", "PLAYING", "WAITLISTED"])));
    return rows.map((r) => r.playerId);
  }

  private async subscribers(db: Executor, organizationId: string, topicName: string) {
    return db
      .select({ chatId: telegramSubscriptions.telegramChatId, playerId: telegramSubscriptions.playerId })
      .from(telegramSubscriptions)
      .where(and(eq(telegramSubscriptions.organizationId, organizationId), eq(telegramSubscriptions.topic, topicName)));
  }

  private async handle(db: Executor, e: EventRow) {
    const orgId = e.organizationId;
    if (!orgId) return;
    const d = (e.payload ?? {}) as Data;
    const n = this.notifications;

    switch (e.eventType) {
      case "registration.created": {
        const tid = await this.tournamentOfRegistration(db, e.aggregateId);
        const info = tid ? await this.tournamentInfo(db, tid) : null;
        if (!info || d.status === "CANCELLED") return;
        await n.enqueue(db, {
          organizationId: orgId,
          type: "REGISTRATION_CONFIRMED",
          playerId: d.playerId as string,
          payload: { ...info.payload, status: d.status, waitlistPosition: d.waitlistPosition },
          dedupeKey: `reg-confirm:${d.registrationId}`,
        });
        return;
      }
      case "registration.updated": {
        const tid = await this.tournamentOfRegistration(db, e.aggregateId);
        const info = tid ? await this.tournamentInfo(db, tid) : null;
        if (!info) return;
        if (d.status === "CANCELLED") {
          await n.enqueue(db, { organizationId: orgId, type: "REGISTRATION_CANCELLED", playerId: d.playerId as string, payload: info.payload, dedupeKey: `reg-cancel:${e.aggregateId}` });
        } else if (d.status === "REGISTERED" && d.previousStatus === "WAITLISTED") {
          await n.enqueue(db, { organizationId: orgId, type: "REGISTRATION_CONFIRMED", playerId: d.playerId as string, payload: { ...info.payload, status: "REGISTERED" }, dedupeKey: `reg-promoted:${e.aggregateId}` });
        }
        return;
      }
      case "seat.assigned":
      case "seat.moved": {
        const tid = await this.tournamentOfEntry(db, e.aggregateId);
        const info = tid ? await this.tournamentInfo(db, tid) : null;
        if (!info) return;
        const reason = d.reason as string;
        const type = e.eventType === "seat.moved" && ["BALANCE", "TABLE_BREAK", "MANUAL"].includes(reason) ? "TABLE_MOVE" : e.eventType === "seat.assigned" ? "SEAT_ASSIGNED" : null;
        if (!type) return;
        await n.enqueue(db, {
          organizationId: orgId,
          type,
          playerId: d.playerId as string,
          payload: { ...info.payload, tableNumber: d.toTableNumber, seatNumber: d.toSeatNumber },
          dedupeKey: `seat:${d.movementId}`,
          channels: ["IN_APP", "TELEGRAM"],
        });
        return;
      }
      case "tournament.updated": {
        const changes = (d.changes ?? {}) as Data;
        if (!changes.status || e.aggregateType !== "tournament") return;
        const info = await this.tournamentInfo(db, e.aggregateId);
        if (!info) return;
        if (changes.status === "REGISTRATION_OPEN" && info.row.publicVisibility === "PUBLIC") {
          for (const s of await this.subscribers(db, orgId, "schedule")) {
            await n.enqueue(db, { organizationId: orgId, type: "REGISTRATION_OPENING", telegramChatId: s.chatId, channels: ["TELEGRAM"], payload: info.payload, dedupeKey: `reg-open:${info.row.id}`, eventAt: info.row.startAt });
          }
        }
        if (changes.status === "CANCELLED") {
          for (const playerId of await this.registeredPlayers(db, info.row.id)) {
            await n.enqueue(db, { organizationId: orgId, type: "TOURNAMENT_CANCELLED", playerId, payload: info.payload, dedupeKey: `cancel:${info.row.id}:${playerId}` });
          }
        }
        return;
      }
      case "tournament.configured": {
        const changes = (d.changes ?? {}) as Data;
        if (!changes.startAt) return;
        const info = await this.tournamentInfo(db, e.aggregateId);
        if (!info) return;
        for (const playerId of await this.registeredPlayers(db, info.row.id)) {
          await n.enqueue(db, { organizationId: orgId, type: "TOURNAMENT_CHANGED", playerId, payload: info.payload, dedupeKey: `changed:${info.row.id}:${e.seq}:${playerId}`, eventAt: info.row.startAt });
        }
        return;
      }
      case "result.updated": {
        if (d.status !== "FINALIZED" || d.corrected) return;
        const info = await this.tournamentInfo(db, e.aggregateId);
        if (!info) return;
        const results = await db.select().from(tournamentResults).where(eq(tournamentResults.tournamentId, info.row.id));
        for (const r of results) {
          await n.enqueue(db, {
            organizationId: orgId,
            type: "RESULTS_FINALIZED",
            playerId: r.playerId,
            payload: { ...info.payload, position: r.position, players: results.length, points: r.points },
            dedupeKey: `results:${info.row.id}:${r.playerId}`,
          });
        }
        return;
      }
      case "leaderboard.updated": {
        const changes = (d.changes ?? []) as { playerId: string; rank: number; previousRank: number | null; points: number }[];
        const [season] = await db.select().from(seasons).where(eq(seasons.id, d.seasonId as string));
        const [league] = season ? await db.select().from(leagues).where(eq(leagues.id, season.leagueId)) : [];
        for (const c of changes.filter((x) => x.rank <= 50 && (x.previousRank == null || x.rank < x.previousRank))) {
          await n.enqueue(db, {
            organizationId: orgId,
            type: "LEAGUE_POSITION_CHANGED",
            playerId: c.playerId,
            payload: { rank: c.rank, points: c.points, leagueName: league?.name ?? null },
            dedupeKey: `league:${e.seq}:${c.playerId}`,
            channels: ["IN_APP", "TELEGRAM"],
          });
        }
        return;
      }
      case "announcement.created": {
        const channels = (d.channels ?? []) as string[];
        if (!channels.includes("TELEGRAM")) return;
        const tid = d.tournamentId as string | null;
        const info = tid ? await this.tournamentInfo(db, tid) : null;
        const payload = { body: d.body, tournamentName: info?.payload.tournamentName ?? null, url: info?.payload.url };
        const chats = new Set<number>();
        for (const s of await this.subscribers(db, orgId, tid ? `tournament:${tid}` : "schedule")) chats.add(s.chatId);
        for (const chatId of chats) {
          await n.enqueue(db, { organizationId: orgId, type: "ANNOUNCEMENT", telegramChatId: chatId, channels: ["TELEGRAM"], payload, dedupeKey: `ann:${e.aggregateId}` });
        }
        if (tid) {
          for (const playerId of await this.registeredPlayers(db, tid)) {
            await n.enqueue(db, { organizationId: orgId, type: "ANNOUNCEMENT", playerId, channels: ["TELEGRAM", "IN_APP"], payload, dedupeKey: `ann:${e.aggregateId}:${playerId}` });
          }
        }
        return;
      }
      default:
        return;
    }
  }

  private async tournamentOfRegistration(db: Executor, registrationId: string) {
    const [r] = await db.select({ t: tournamentRegistrations.tournamentId }).from(tournamentRegistrations).where(eq(tournamentRegistrations.id, registrationId));
    return r?.t ?? null;
  }

  private async tournamentOfEntry(db: Executor, entryId: string) {
    const [r] = await db.select({ t: tournamentEntries.tournamentId }).from(tournamentEntries).where(eq(tournamentEntries.id, entryId));
    return r?.t ?? null;
  }
}
