// Player CRM (spec §38, §44).

import {
  oneTimeCodes,
  playerConsents,
  playerNotes,
  playerTagLinks,
  playerTags,
  players,
  telegramAccountLinks,
  tournamentRegistrations,
  tournamentResults,
  tournaments,
  users,
  type Executor,
} from "@pcos/db";
import {
  KioskPinInput,
  PlayerConsentInput,
  PlayerCreateInput,
  PlayerNoteInput,
  PlayerSearchQuery,
  PlayerSelfUpdateInput,
  PlayerTagInput,
  PlayerUpdateInput,
} from "@pcos/types";
import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { can, requireOrganization, requirePermission, type Actor } from "../actor.js";
import { writeAudit } from "../audit.js";
import { hashPassword, randomCode, randomDigits, sha256 } from "../crypto.js";
import type { CoreDeps } from "../deps.js";
import { AppError, conflict, notFound, pgErrorInfo } from "../errors.js";
import { publishEvents } from "../events.js";

export type PlayerRow = typeof players.$inferSelect;

export function buildSearchText(p: Partial<Pick<PlayerRow, "firstName" | "lastName" | "displayName" | "nickname" | "email" | "phone" | "memberNumber">>): string {
  const phoneDigits = p.phone ? p.phone.replace(/\D/g, "") : null;
  return [p.firstName, p.lastName, p.displayName, p.nickname, p.email, p.phone, phoneDigits, p.memberNumber]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function defaultDisplayName(firstName: string, lastName: string, nickname?: string | null): string {
  return nickname?.trim() || `${firstName} ${lastName.charAt(0)}.`;
}

export class PlayerService {
  constructor(private readonly deps: CoreDeps) {}

  async search(actor: Actor, raw: unknown) {
    requirePermission(actor, "player.read");
    const orgId = requireOrganization(actor);
    const q = PlayerSearchQuery.parse(raw);
    const conds = [eq(players.organizationId, orgId)];
    if (q.status) conds.push(eq(players.status, q.status));
    else conds.push(sql`${players.status} <> 'MERGED'`);
    if (q.q) {
      const term = q.q.toLowerCase();
      const digits = term.replace(/\D/g, "");
      conds.push(
        or(
          ilike(players.searchText, `%${escapeLike(term)}%`),
          eq(players.memberNumber, q.q),
          eq(players.externalPublicId, q.q.toUpperCase()),
          ...(digits.length >= 4 ? [ilike(players.searchText, `%${digits}%`)] : []),
        )!,
      );
    }
    if (q.tag) {
      conds.push(
        inArray(
          players.id,
          this.deps.db
            .select({ id: playerTagLinks.playerId })
            .from(playerTagLinks)
            .innerJoin(playerTags, eq(playerTags.id, playerTagLinks.tagId))
            .where(and(eq(playerTags.organizationId, orgId), eq(playerTags.name, q.tag))),
        ),
      );
    }
    const rows = await this.deps.db
      .select()
      .from(players)
      .where(and(...conds))
      .orderBy(asc(players.lastName), asc(players.firstName))
      .limit(q.limit)
      .offset(q.offset);
    const [{ total } = { total: 0 }] = await this.deps.db
      .select({ total: sql<number>`count(*)::int` })
      .from(players)
      .where(and(...conds));
    const tags = await this.tagsFor(this.deps.db, rows.map((r) => r.id));
    return { total, items: rows.map((p) => ({ ...this.summary(p), tags: tags.get(p.id) ?? [] })) };
  }

  summary(p: PlayerRow) {
    return {
      id: p.id,
      externalPublicId: p.externalPublicId,
      memberNumber: p.memberNumber,
      firstName: p.firstName,
      lastName: p.lastName,
      displayName: p.displayName,
      nickname: p.nickname,
      email: p.email,
      phone: p.phone,
      status: p.status,
      source: p.source,
      marketingConsent: p.marketingConsent,
      publicProfileEnabled: p.publicProfileEnabled,
      hasAccount: !!p.userId,
      hasKioskPin: !!p.kioskPinHash,
      version: p.version,
      createdAt: p.createdAt.toISOString(),
    };
  }

  private async tagsFor(db: Executor, playerIds: string[]) {
    const out = new Map<string, { id: string; name: string; color: string | null }[]>();
    if (playerIds.length === 0) return out;
    const rows = await db
      .select({ playerId: playerTagLinks.playerId, id: playerTags.id, name: playerTags.name, color: playerTags.color })
      .from(playerTagLinks)
      .innerJoin(playerTags, eq(playerTags.id, playerTagLinks.tagId))
      .where(inArray(playerTagLinks.playerId, playerIds));
    for (const r of rows) {
      const l = out.get(r.playerId) ?? [];
      l.push({ id: r.id, name: r.name, color: r.color });
      out.set(r.playerId, l);
    }
    return out;
  }

  async getRow(orgId: string, id: string): Promise<PlayerRow> {
    const [p] = await this.deps.db.select().from(players).where(and(eq(players.id, id), eq(players.organizationId, orgId)));
    if (!p) throw notFound("player");
    return p;
  }

  async get(actor: Actor, id: string) {
    requirePermission(actor, "player.read");
    const orgId = requireOrganization(actor);
    const p = await this.getRow(orgId, id);
    const tags = (await this.tagsFor(this.deps.db, [p.id])).get(p.id) ?? [];
    const notes = can(actor, "player.notes.read")
      ? await this.deps.db
          .select({ n: playerNotes, author: users.displayName })
          .from(playerNotes)
          .leftJoin(users, eq(users.id, playerNotes.createdBy))
          .where(and(eq(playerNotes.playerId, p.id), can(actor, "staff.manage") ? undefined : eq(playerNotes.visibility, "STAFF")))
          .orderBy(desc(playerNotes.createdAt))
      : [];
    const consents = await this.deps.db.select().from(playerConsents).where(eq(playerConsents.playerId, p.id)).orderBy(desc(playerConsents.createdAt));
    const [telegram] = await this.deps.db
      .select({ username: telegramAccountLinks.telegramUsername, linkedAt: telegramAccountLinks.linkedAt })
      .from(telegramAccountLinks)
      .where(and(eq(telegramAccountLinks.playerId, p.id), eq(telegramAccountLinks.status, "ACTIVE")));
    const history = await this.history(p.id);
    return {
      ...this.summary(p),
      country: p.country,
      language: p.language,
      dateOfBirth: p.dateOfBirth,
      tags,
      notes: notes.map(({ n, author }) => ({ id: n.id, body: n.body, visibility: n.visibility, author, createdAt: n.createdAt.toISOString() })),
      consents: consents.map((c) => ({ type: c.type, granted: c.granted, source: c.source, createdAt: c.createdAt.toISOString() })),
      telegram: telegram ? { username: telegram.username, linkedAt: telegram.linkedAt.toISOString() } : null,
      history,
      stats: {
        tournaments: history.length,
        wins: history.filter((h) => h.position === 1).length,
        bestFinish: history.reduce<number | null>((b, h) => (h.position != null && (b == null || h.position < b) ? h.position : b), null),
        lastVisit: history[0]?.startAt ?? null,
        noShows: history.filter((h) => h.registrationStatus === "NO_SHOW").length,
      },
    };
  }

  async history(playerId: string) {
    const rows = await this.deps.db
      .select({
        tournamentId: tournaments.id,
        name: tournaments.name,
        startAt: tournaments.startAt,
        status: tournaments.status,
        registrationStatus: tournamentRegistrations.status,
        position: tournamentResults.position,
        points: tournamentResults.points,
        entries: tournamentResults.entries,
      })
      .from(tournamentRegistrations)
      .innerJoin(tournaments, eq(tournaments.id, tournamentRegistrations.tournamentId))
      .leftJoin(tournamentResults, and(eq(tournamentResults.tournamentId, tournaments.id), eq(tournamentResults.playerId, playerId)))
      .where(eq(tournamentRegistrations.playerId, playerId))
      .orderBy(desc(tournaments.startAt))
      .limit(200);
    return rows.map((r) => ({ ...r, startAt: r.startAt.toISOString(), points: typeof r.points === "number" ? r.points : null }));
  }

  async create(actor: Actor, raw: unknown, tx?: Executor) {
    requirePermission(actor, "player.create");
    const orgId = requireOrganization(actor);
    const input = PlayerCreateInput.parse(raw);
    const run = async (db: Executor) => {
      const now = this.deps.now();
      const displayName = input.displayName ?? defaultDisplayName(input.firstName, input.lastName, input.nickname);
      let player: PlayerRow | undefined;
      try {
        [player] = await db
          .insert(players)
          .values({
            organizationId: orgId,
            externalPublicId: `P-${randomCode(8)}`,
            memberNumber: input.memberNumber ?? null,
            firstName: input.firstName,
            lastName: input.lastName,
            displayName,
            nickname: input.nickname ?? null,
            email: input.email ?? null,
            phone: input.phone ?? null,
            language: input.language ?? null,
            country: input.country ?? null,
            dateOfBirth: input.dateOfBirth ?? null,
            source: input.source,
            marketingConsent: input.marketingConsent,
            publicProfileEnabled: input.publicProfileEnabled,
            searchText: buildSearchText({ ...input, displayName, email: input.email ?? null, phone: input.phone ?? null, memberNumber: input.memberNumber ?? null }),
            createdAt: now,
            updatedAt: now,
          })
          .returning();
      } catch (e) {
        const c = pgErrorInfo(e).constraint;
        if (c === "players_org_email_uq") throw new AppError("DUPLICATE", "a player with this email already exists");
        if (c === "players_org_member_uq") throw new AppError("DUPLICATE", "member number already in use");
        throw e;
      }
      if (input.tags?.length) await this.attachTags(db, orgId, player!.id, input.tags);
      await db.insert(playerConsents).values({ organizationId: orgId, playerId: player!.id, type: "MARKETING", granted: input.marketingConsent, source: input.source, recordedBy: actor.userId, createdAt: now });
      await writeAudit(db, actor, this.deps.edgeNodeId, { organizationId: orgId, entityType: "player", entityId: player!.id, action: "PLAYER_CREATED", after: { ...input } }, now);
      await publishEvents(
        db,
        { organizationId: orgId, venueId: null, edgeNodeId: this.deps.edgeNodeId },
        [{ name: "player.created", topics: [], audience: "staff", data: this.syncPayload(player!), aggregateType: "player", aggregateId: player!.id, entityVersion: 0, realtime: false }],
        now,
      );
      return player!;
    };
    const player = tx ? await run(tx) : await this.deps.db.transaction(run);
    return this.summary(player);
  }

  /** Personal data sent to the (optional) cloud control plane for cross-venue sync. */
  private syncPayload(p: PlayerRow) {
    return {
      id: p.id,
      externalPublicId: p.externalPublicId,
      memberNumber: p.memberNumber,
      firstName: p.firstName,
      lastName: p.lastName,
      displayName: p.displayName,
      nickname: p.nickname,
      email: p.email,
      phone: p.phone,
      status: p.status,
      marketingConsent: p.marketingConsent,
      version: p.version,
    };
  }

  async update(actor: Actor, id: string, raw: unknown) {
    requirePermission(actor, "player.edit");
    const orgId = requireOrganization(actor);
    const input = PlayerUpdateInput.parse(raw);
    const { expectedVersion, ...changes } = input;
    return this.deps.db.transaction(async (tx) => {
      const [before] = await tx.select().from(players).where(and(eq(players.id, id), eq(players.organizationId, orgId))).for("update");
      if (!before) throw notFound("player");
      if (before.version !== expectedVersion) throw conflict(`player was changed by someone else (version ${before.version})`, before.version);
      const merged = { ...before, ...Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined)) } as PlayerRow;
      // The public display name only changes when explicitly edited.
      merged.displayName = changes.displayName ?? before.displayName;
      const now = this.deps.now();
      let updated: PlayerRow | undefined;
      try {
        [updated] = await tx
          .update(players)
          .set({
            ...changes,
            displayName: merged.displayName,
            searchText: buildSearchText(merged),
            version: before.version + 1,
            updatedAt: now,
          })
          .where(eq(players.id, id))
          .returning();
      } catch (e) {
        const c = pgErrorInfo(e).constraint;
        if (c === "players_org_email_uq") throw new AppError("DUPLICATE", "a player with this email already exists");
        if (c === "players_org_member_uq") throw new AppError("DUPLICATE", "member number already in use");
        throw e;
      }
      if (changes.marketingConsent !== undefined && changes.marketingConsent !== before.marketingConsent) {
        await tx.insert(playerConsents).values({ organizationId: orgId, playerId: id, type: "MARKETING", granted: changes.marketingConsent, source: "STAFF", recordedBy: actor.userId, createdAt: now });
      }
      await writeAudit(tx, actor, this.deps.edgeNodeId, { organizationId: orgId, entityType: "player", entityId: id, action: "PLAYER_UPDATED", before: this.syncPayload(before), after: changes }, now);
      await publishEvents(
        tx,
        { organizationId: orgId, venueId: null, edgeNodeId: this.deps.edgeNodeId },
        [{ name: "player.updated", topics: [], audience: "staff", data: this.syncPayload(updated!), aggregateType: "player", aggregateId: id, entityVersion: updated!.version, realtime: false }],
        now,
      );
      return this.summary(updated!);
    });
  }

  /** GDPR-style erasure: personal data removed, competition history kept anonymously. */
  async anonymize(actor: Actor, id: string) {
    requirePermission(actor, "player.edit");
    requirePermission(actor, "settings.manage");
    const orgId = requireOrganization(actor);
    const p = await this.getRow(orgId, id);
    const now = this.deps.now();
    await this.deps.db.transaction(async (tx) => {
      await tx
        .update(players)
        .set({
          firstName: "Anonymized",
          lastName: "Player",
          displayName: `Player ${p.externalPublicId}`,
          nickname: null,
          email: null,
          phone: null,
          dateOfBirth: null,
          memberNumber: null,
          kioskPinHash: null,
          avatarFileId: null,
          marketingConsent: false,
          publicProfileEnabled: false,
          status: "INACTIVE",
          searchText: p.externalPublicId.toLowerCase(),
          version: p.version + 1,
          updatedAt: now,
        })
        .where(eq(players.id, id));
      await tx.delete(playerNotes).where(eq(playerNotes.playerId, id));
      await tx.update(telegramAccountLinks).set({ status: "REVOKED", revokedAt: now }).where(eq(telegramAccountLinks.playerId, id));
      await writeAudit(tx, actor, this.deps.edgeNodeId, { organizationId: orgId, entityType: "player", entityId: id, action: "PLAYER_ANONYMIZED" }, now);
      await publishEvents(
        tx,
        { organizationId: orgId, venueId: null, edgeNodeId: this.deps.edgeNodeId },
        [{ name: "player.anonymized", topics: [], audience: "staff", data: { id }, aggregateType: "player", aggregateId: id, entityVersion: p.version + 1, realtime: false }],
        now,
      );
    });
    return { ok: true };
  }

  /** A player editing their own profile (limited fields, consents recorded, audited). */
  async updateOwnProfile(actor: Actor, raw: unknown) {
    const p = actor.principal;
    if (p.kind !== "player") throw new AppError("FORBIDDEN", "player account required");
    const input = PlayerSelfUpdateInput.parse(raw);
    const now = this.deps.now();
    await this.deps.db.transaction(async (tx) => {
      const [row] = await tx.select().from(players).where(eq(players.id, p.playerId)).for("update");
      if (!row) throw notFound("player");
      const merged = { ...row, ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) } as PlayerRow;
      await tx
        .update(players)
        .set({ ...input, searchText: buildSearchText(merged), version: row.version + 1, updatedAt: now })
        .where(eq(players.id, row.id));
      for (const [type, value, previous] of [
        ["MARKETING", input.marketingConsent, row.marketingConsent],
        ["PUBLIC_PROFILE", input.publicProfileEnabled, row.publicProfileEnabled],
      ] as const) {
        if (value !== undefined && value !== previous) {
          await tx.insert(playerConsents).values({ organizationId: p.organizationId, playerId: row.id, type, granted: value, source: "PLAYER_WEB", createdAt: now });
        }
      }
      await writeAudit(tx, actor, this.deps.edgeNodeId, { organizationId: p.organizationId, entityType: "player", entityId: row.id, action: "PROFILE_UPDATED_BY_PLAYER", after: input }, now);
    });
    return { ok: true };
  }

  // --- notes, tags, consents --------------------------------------------------------------------

  async addNote(actor: Actor, playerId: string, raw: unknown) {
    requirePermission(actor, "player.notes.write");
    const orgId = requireOrganization(actor);
    await this.getRow(orgId, playerId);
    const input = PlayerNoteInput.parse(raw);
    if (input.visibility === "MANAGEMENT") requirePermission(actor, "staff.manage");
    const [note] = await this.deps.db.insert(playerNotes).values({ organizationId: orgId, playerId, body: input.body, visibility: input.visibility, createdBy: actor.userId }).returning();
    await writeAudit(this.deps.db, actor, this.deps.edgeNodeId, { organizationId: orgId, entityType: "player_note", entityId: note!.id, action: "NOTE_ADDED", metadata: { playerId, visibility: input.visibility } });
    return note!;
  }

  async listTags(actor: Actor) {
    requirePermission(actor, "player.read");
    const orgId = requireOrganization(actor);
    return this.deps.db.select().from(playerTags).where(eq(playerTags.organizationId, orgId)).orderBy(asc(playerTags.name));
  }

  private async attachTags(db: Executor, orgId: string, playerId: string, names: string[]) {
    for (const name of names) {
      const [tag] = await db
        .insert(playerTags)
        .values({ organizationId: orgId, name })
        .onConflictDoUpdate({ target: [playerTags.organizationId, playerTags.name], set: { name } })
        .returning();
      await db.insert(playerTagLinks).values({ playerId, tagId: tag!.id }).onConflictDoNothing();
    }
  }

  async addTag(actor: Actor, playerId: string, raw: unknown) {
    requirePermission(actor, "player.edit");
    const orgId = requireOrganization(actor);
    await this.getRow(orgId, playerId);
    const input = PlayerTagInput.parse(raw);
    await this.attachTags(this.deps.db, orgId, playerId, [input.name]);
    if (input.color) await this.deps.db.update(playerTags).set({ color: input.color }).where(and(eq(playerTags.organizationId, orgId), eq(playerTags.name, input.name)));
    return { ok: true };
  }

  async removeTag(actor: Actor, playerId: string, tagId: string) {
    requirePermission(actor, "player.edit");
    const orgId = requireOrganization(actor);
    await this.getRow(orgId, playerId);
    await this.deps.db.delete(playerTagLinks).where(and(eq(playerTagLinks.playerId, playerId), eq(playerTagLinks.tagId, tagId)));
    return { ok: true };
  }

  async recordConsent(actor: Actor, playerId: string, raw: unknown) {
    requirePermission(actor, "player.edit");
    const orgId = requireOrganization(actor);
    const p = await this.getRow(orgId, playerId);
    const input = PlayerConsentInput.parse(raw);
    const now = this.deps.now();
    await this.deps.db.transaction(async (tx) => {
      await tx.insert(playerConsents).values({ organizationId: orgId, playerId, type: input.type, granted: input.granted, source: input.source, recordedBy: actor.userId, createdAt: now });
      if (input.type === "MARKETING") await tx.update(players).set({ marketingConsent: input.granted, version: p.version + 1, updatedAt: now }).where(eq(players.id, playerId));
      if (input.type === "PUBLIC_PROFILE") await tx.update(players).set({ publicProfileEnabled: input.granted, version: p.version + 1, updatedAt: now }).where(eq(players.id, playerId));
      await writeAudit(tx, actor, this.deps.edgeNodeId, { organizationId: orgId, entityType: "player_consent", entityId: playerId, action: "CONSENT_RECORDED", after: input }, now);
    });
    return { ok: true };
  }

  // --- kiosk identity -------------------------------------------------------------------------------

  async setKioskPin(actor: Actor, playerId: string, raw: unknown) {
    requirePermission(actor, "player.edit");
    const orgId = requireOrganization(actor);
    const p = await this.getRow(orgId, playerId);
    if (!p.memberNumber) throw new AppError("RULE_VIOLATION", "assign a member number before setting a kiosk PIN");
    const { pin } = KioskPinInput.parse(raw);
    await this.deps.db.update(players).set({ kioskPinHash: await hashPassword(pin), updatedAt: this.deps.now() }).where(eq(players.id, playerId));
    await writeAudit(this.deps.db, actor, this.deps.edgeNodeId, { organizationId: orgId, entityType: "player", entityId: playerId, action: "KIOSK_PIN_SET" });
    return { ok: true };
  }

  /** 6-digit one-time code for kiosk check-in (valid 15 minutes, single use). */
  async issueOneTimeCode(actor: Actor, playerId: string) {
    const orgId = requireOrganization(actor);
    const p = actor.principal;
    if (!(p.kind === "player" && p.playerId === playerId)) requirePermission(actor, "registration.checkin");
    await this.getRow(orgId, playerId);
    const code = randomDigits(6);
    const now = this.deps.now();
    await this.deps.db.insert(oneTimeCodes).values({
      organizationId: orgId,
      playerId,
      purpose: "KIOSK_CHECKIN",
      codeHash: sha256(`${orgId}:${code}`),
      expiresAt: new Date(now.getTime() + 15 * 60_000),
      createdAt: now,
    });
    return { code, expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString() };
  }
}

function escapeLike(s: string) {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}
