// TV displays and kiosks (spec §46, §52). Access is by an unguessable token in
// the URL (/display/{token}); only its hash is stored. Tokens grant read-only
// public data (displays) or the restricted self check-in flow (kiosks).

import { displayTemplates, displayTokens, oneTimeCodes, organizations, players, tournamentRegistrations, tournaments, venues } from "@pcos/db";
import type { Principal } from "@pcos/domain";
import { DisplayTemplateInput, DisplayTokenInput, KioskCheckInInput, type PublicLiveSnapshot } from "@pcos/types";
import { and, asc, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { requireOrganization, requirePermission, systemActor, type Actor } from "../actor.js";
import { writeAudit } from "../audit.js";
import { randomToken, sha256, verifyPassword } from "../crypto.js";
import type { CoreDeps } from "../deps.js";
import { AppError, forbidden, notFound, unauthenticated } from "../errors.js";
import type { TournamentCommandExecutor } from "../tournaments/executor.js";
import { buildPublicSnapshot, orgFlags } from "../tournaments/snapshot.js";

type TokenRow = typeof displayTokens.$inferSelect;
export type DevicePrincipal = Extract<Principal, { kind: "display" } | { kind: "kiosk" }>;

const LIVE = ["RUNNING", "BREAK", "PAUSED", "HAND_FOR_HAND"];
const UPCOMING = ["SEATING", "REGISTRATION_OPEN", "SCHEDULED"];

export class DisplayService {
  private readonly seen = new Map<string, number>();

  constructor(
    private readonly deps: CoreDeps,
    private readonly executor: TournamentCommandExecutor,
  ) {}

  // --- administration -------------------------------------------------------------------------

  async listTemplates(actor: Actor) {
    requirePermission(actor, "tournament.read");
    return this.deps.db.select().from(displayTemplates).where(eq(displayTemplates.organizationId, requireOrganization(actor))).orderBy(asc(displayTemplates.name));
  }

  async saveTemplate(actor: Actor, raw: unknown, id?: string) {
    requirePermission(actor, "display.manage");
    const orgId = requireOrganization(actor);
    const input = DisplayTemplateInput.parse(raw);
    const [row] = id
      ? await this.deps.db
          .update(displayTemplates)
          .set({ ...input, updatedAt: this.deps.now() })
          .where(and(eq(displayTemplates.id, id), eq(displayTemplates.organizationId, orgId)))
          .returning()
      : await this.deps.db.insert(displayTemplates).values({ organizationId: orgId, ...input }).returning();
    if (!row) throw notFound("display template");
    return row;
  }

  async listTokens(actor: Actor) {
    requirePermission(actor, "display.manage");
    const orgId = requireOrganization(actor);
    const rows = await this.deps.db.select().from(displayTokens).where(eq(displayTokens.organizationId, orgId)).orderBy(desc(displayTokens.createdAt));
    return rows.map(({ tokenHash: _h, ...r }) => ({ ...r, revoked: !!r.revokedAt }));
  }

  /** Create a display/kiosk token. The plaintext token is returned exactly once. */
  async createToken(actor: Actor, raw: unknown) {
    requirePermission(actor, "display.manage");
    const orgId = requireOrganization(actor);
    const input = DisplayTokenInput.parse(raw);
    const [venue] = await this.deps.db.select().from(venues).where(and(eq(venues.id, input.venueId), eq(venues.organizationId, orgId)));
    if (!venue) throw notFound("venue");
    if (input.tournamentId) {
      const [t] = await this.deps.db.select({ id: tournaments.id }).from(tournaments).where(and(eq(tournaments.id, input.tournamentId), eq(tournaments.venueId, venue.id)));
      if (!t) throw notFound("tournament");
    }
    const token = randomToken(24);
    const [row] = await this.deps.db
      .insert(displayTokens)
      .values({
        organizationId: orgId,
        venueId: venue.id,
        tournamentId: input.tournamentId ?? null,
        displayTemplateId: input.displayTemplateId ?? null,
        kind: input.kind,
        name: input.name,
        tokenHash: sha256(token),
        tokenPrefix: token.slice(0, 6),
        createdBy: actor.userId,
      })
      .returning();
    await writeAudit(this.deps.db, actor, this.deps.edgeNodeId, { organizationId: orgId, venueId: venue.id, entityType: "display_token", entityId: row!.id, action: "DISPLAY_TOKEN_CREATED", after: { name: input.name, kind: input.kind } });
    const path = input.kind === "KIOSK" ? `/kiosk/${token}` : `/display/${token}`;
    return { id: row!.id, token, path, localUrl: venue.localUrl ? `${venue.localUrl.replace(/\/$/, "")}${path}` : null };
  }

  async revokeToken(actor: Actor, id: string) {
    requirePermission(actor, "display.manage");
    const orgId = requireOrganization(actor);
    const [row] = await this.deps.db
      .update(displayTokens)
      .set({ revokedAt: this.deps.now() })
      .where(and(eq(displayTokens.id, id), eq(displayTokens.organizationId, orgId)))
      .returning();
    if (!row) throw notFound("display token");
    await writeAudit(this.deps.db, actor, this.deps.edgeNodeId, { organizationId: orgId, entityType: "display_token", entityId: id, action: "DISPLAY_TOKEN_REVOKED" });
    return { ok: true };
  }

  // --- token resolution ---------------------------------------------------------------------------

  async resolve(token: string | undefined | null): Promise<{ row: TokenRow; principal: DevicePrincipal } | null> {
    if (!token || token.length < 20 || token.length > 100) return null;
    const [row] = await this.deps.db.select().from(displayTokens).where(and(eq(displayTokens.tokenHash, sha256(token)), isNull(displayTokens.revokedAt)));
    if (!row) return null;
    const now = this.deps.now().getTime();
    if (now - (this.seen.get(row.id) ?? 0) > 60_000) {
      this.seen.set(row.id, now);
      await this.deps.db.update(displayTokens).set({ lastSeenAt: new Date(now) }).where(eq(displayTokens.id, row.id));
    }
    const principal = {
      kind: row.kind === "KIOSK" ? "kiosk" : "display",
      organizationId: row.organizationId,
      venueId: row.venueId,
      tournamentId: row.tournamentId,
      displayId: row.id,
    } as DevicePrincipal;
    return { row, principal };
  }

  /** Tournament shown by a token: the bound one, else the venue's live or next tournament. */
  async currentTournament(row: TokenRow) {
    if (row.tournamentId) {
      const [t] = await this.deps.db.select().from(tournaments).where(eq(tournaments.id, row.tournamentId));
      return t ?? null;
    }
    const [live] = await this.deps.db
      .select()
      .from(tournaments)
      .where(and(eq(tournaments.venueId, row.venueId), inArray(tournaments.status, LIVE)))
      .orderBy(desc(tournaments.startedAt))
      .limit(1);
    if (live) return live;
    const [next] = await this.deps.db
      .select()
      .from(tournaments)
      .where(and(eq(tournaments.venueId, row.venueId), inArray(tournaments.status, UPCOMING), gt(tournaments.startAt, new Date(this.deps.now().getTime() - 6 * 3600_000))))
      .orderBy(asc(tournaments.startAt))
      .limit(1);
    if (next) return next;
    const [recent] = await this.deps.db
      .select()
      .from(tournaments)
      .where(and(eq(tournaments.venueId, row.venueId), inArray(tournaments.status, ["FINISHED", "FINALIZED"])))
      .orderBy(desc(tournaments.finishedAt))
      .limit(1);
    return recent ?? null;
  }

  async state(token: string) {
    const r = await this.resolve(token);
    if (!r) throw unauthenticated("unknown or revoked display token");
    const [template] = r.row.displayTemplateId
      ? await this.deps.db.select().from(displayTemplates).where(eq(displayTemplates.id, r.row.displayTemplateId))
      : await this.deps.db.select().from(displayTemplates).where(eq(displayTemplates.organizationId, r.row.organizationId)).orderBy(asc(displayTemplates.createdAt)).limit(1);
    const [venue] = await this.deps.db.select().from(venues).where(eq(venues.id, r.row.venueId));
    const [org] = await this.deps.db.select().from(organizations).where(eq(organizations.id, r.row.organizationId));
    const t = await this.currentTournament(r.row);
    const snapshot: PublicLiveSnapshot | null = t ? await buildPublicSnapshot(this.deps.db, t, this.deps.now(), { playerId: null, forceSeating: r.row.kind === "DISPLAY" }) : null;
    return {
      display: { id: r.row.id, name: r.row.name, kind: r.row.kind, venueId: r.row.venueId, boundTournamentId: r.row.tournamentId },
      template: template ? { widgets: template.widgets, theme: template.theme } : { widgets: ["CLOCK", "BLINDS", "NEXT_LEVEL", "ENTRIES", "REMAINING", "AVERAGE_STACK", "ANNOUNCEMENTS"], theme: {} },
      venue: venue ? { id: venue.id, name: venue.name } : null,
      organization: org ? { name: org.name, slug: org.slug } : null,
      tournamentId: t?.id ?? null,
      snapshot,
      serverTime: this.deps.now().toISOString(),
    };
  }

  private flags(orgId: string) {
    return orgFlags(this.deps.db, orgId);
  }

  // --- kiosk self check-in ---------------------------------------------------------------------------

  async kioskCheckIn(token: string, raw: unknown, ip: string | null) {
    const r = await this.resolve(token);
    if (!r || r.row.kind !== "KIOSK") throw unauthenticated("unknown or revoked kiosk token");
    const input = KioskCheckInInput.parse(raw);
    const rl = await this.deps.rateLimiter.hit(`kiosk:${r.row.id}`, 60, 60);
    if (!rl.allowed) throw new AppError("RATE_LIMITED", "too many attempts, please ask the registration desk");
    const t = await this.currentTournament(r.row);
    if (!t) throw notFound("tournament");
    const orgId = r.row.organizationId;

    let registration: typeof tournamentRegistrations.$inferSelect | undefined;
    if (input.method === "QR") {
      [registration] = await this.deps.db
        .select()
        .from(tournamentRegistrations)
        .where(and(eq(tournamentRegistrations.checkInCode, input.code.toUpperCase()), eq(tournamentRegistrations.tournamentId, t.id)));
    } else {
      let playerId: string | null = null;
      if (input.method === "MEMBER_PIN") {
        const guard = await this.deps.rateLimiter.hit(`kiosk-pin:${orgId}:${input.memberNumber}`, 5, 900);
        if (!guard.allowed) throw new AppError("RATE_LIMITED", "too many wrong PIN attempts for this member number");
        const [p] = await this.deps.db.select().from(players).where(and(eq(players.organizationId, orgId), eq(players.memberNumber, input.memberNumber)));
        if (!p || !(await verifyPassword(p.kioskPinHash, input.pin))) throw forbidden("member number or PIN is incorrect");
        playerId = p.id;
      } else {
        const now = this.deps.now();
        const [code] = await this.deps.db
          .select()
          .from(oneTimeCodes)
          .where(and(eq(oneTimeCodes.organizationId, orgId), eq(oneTimeCodes.codeHash, sha256(`${orgId}:${input.code}`)), isNull(oneTimeCodes.usedAt), gt(oneTimeCodes.expiresAt, now)));
        if (!code) throw forbidden("code is invalid or expired");
        await this.deps.db.update(oneTimeCodes).set({ usedAt: now }).where(eq(oneTimeCodes.id, code.id));
        playerId = code.playerId;
      }
      [registration] = await this.deps.db
        .select()
        .from(tournamentRegistrations)
        .where(and(eq(tournamentRegistrations.tournamentId, t.id), eq(tournamentRegistrations.playerId, playerId), inArray(tournamentRegistrations.status, ["REGISTERED", "RESERVED", "CHECKED_IN", "PLAYING"])));
    }
    if (!registration) throw notFound("registration for this tournament");
    const [player] = await this.deps.db.select({ displayName: players.displayName }).from(players).where(eq(players.id, registration.playerId));
    if (registration.status === "CHECKED_IN" || registration.status === "PLAYING") {
      return { playerName: player?.displayName ?? "", alreadyCheckedIn: true, seat: null, tournamentName: t.name };
    }
    // A kiosk never takes money: the buy-in (entry) is created automatically only for
    // free tournaments or when registration was prepaid; otherwise the cashier creates it.
    const flags = await this.flags(orgId);
    const free = !t.buyIn || t.buyIn.amount + t.buyIn.fee === 0;
    const createEntry = free || flags.paidRegistration;
    const actor: Actor = { ...systemActor(orgId, `kiosk:${r.row.name}`), channel: "KIOSK", deviceId: null, ip };
    const res = await this.executor.execute(
      t.id,
      { type: "CHECK_IN", payload: { registrationId: registration.id, createEntry, seat: "AUTO" }, expectedVersion: t.version, clientOperationId: randomUUID() },
      actor,
    );
    const result = res.result as { seat: { tableNumber: number; seatNumber: number } | null };
    return { playerName: player?.displayName ?? "", alreadyCheckedIn: false, seat: result.seat, tournamentName: t.name, proceedToCashier: !createEntry };
  }
}
