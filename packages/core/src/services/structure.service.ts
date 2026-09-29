// Blind structures, tournament templates and house rules profiles (spec §40, §50, §57).

import {
  houseRulesProfiles,
  structureLevels,
  tournamentClockStates,
  tournamentStructures,
  tournamentTemplates,
  tournaments,
  type Executor,
} from "@pcos/db";
import { deriveClock, materialize, validateStructure } from "@pcos/domain";
import {
  HouseRulesProfileInput,
  StructureInput,
  StructureLevelsReplaceInput,
  TDA_2026_STYLE,
  TournamentTemplateInput,
  topic,
  type LevelInput,
} from "@pcos/types";
import { and, asc, eq, gte, isNull, sql } from "drizzle-orm";
import { requireOrganization, requirePermission, type Actor } from "../actor.js";
import { writeAudit } from "../audit.js";
import type { CoreDeps } from "../deps.js";
import { AppError, conflict, notFound, validation } from "../errors.js";
import { publishEvents } from "../events.js";
import { anchorFromRow, levelLikes, loadClockRow, loadLevels, rowFromAnchor, toLevelView } from "../tournaments/repo.js";

function assertValidLevels(levels: readonly LevelInput[]) {
  const issues = validateStructure(levels.map((l) => ({ type: l.type, durationSeconds: l.durationSeconds, smallBlind: l.smallBlind, bigBlind: l.bigBlind })));
  if (issues.length > 0) {
    throw new AppError("RULE_VIOLATION", issues.map((i) => `level ${i.index + 1}: ${i.message}`).join("; "), { details: issues });
  }
}

const levelRow = (structureId: string, l: LevelInput, position: number) => ({
  structureId,
  position,
  type: l.type,
  smallBlind: l.type === "PLAY" ? l.smallBlind : 0,
  bigBlind: l.type === "PLAY" ? l.bigBlind : 0,
  ante: l.type === "PLAY" ? l.ante : 0,
  anteType: l.type === "PLAY" ? l.anteType : "NONE",
  durationSeconds: l.durationSeconds,
  label: l.label ?? null,
  note: l.note ?? null,
});

const sameLevel = (a: ReturnType<typeof levelRow>, b: typeof structureLevels.$inferSelect) =>
  a.type === b.type && a.smallBlind === b.smallBlind && a.bigBlind === b.bigBlind && a.ante === b.ante && a.anteType === b.anteType && a.durationSeconds === b.durationSeconds;

export class StructureService {
  constructor(private readonly deps: CoreDeps) {}

  async list(actor: Actor) {
    requirePermission(actor, "tournament.read");
    const orgId = requireOrganization(actor);
    const rows = await this.deps.db
      .select({
        s: tournamentStructures,
        // Explicitly qualified: inside the subquery an unqualified "id" would bind to structure_levels.id.
        levels: sql<number>`(select count(*)::int from structure_levels l where l.structure_id = "tournament_structures"."id")`,
        totalSeconds: sql<number>`(select coalesce(sum(l.duration_seconds),0)::int from structure_levels l where l.structure_id = "tournament_structures"."id")`,
      })
      .from(tournamentStructures)
      .where(and(eq(tournamentStructures.organizationId, orgId), isNull(tournamentStructures.ownerTournamentId)))
      .orderBy(asc(tournamentStructures.name));
    return rows.map((r) => ({ ...r.s, levelCount: r.levels, totalSeconds: r.totalSeconds }));
  }

  async get(actor: Actor, id: string) {
    requirePermission(actor, "tournament.read");
    const orgId = requireOrganization(actor);
    const s = await this.row(orgId, id);
    const levels = await loadLevels(this.deps.db, id);
    return { ...s, levels: levels.map(toLevelView) };
  }

  private async row(orgId: string, id: string, db: Executor = this.deps.db) {
    const [s] = await db.select().from(tournamentStructures).where(and(eq(tournamentStructures.id, id), eq(tournamentStructures.organizationId, orgId)));
    if (!s) throw notFound("structure");
    return s;
  }

  async create(actor: Actor, raw: unknown) {
    requirePermission(actor, "structure.manage");
    const orgId = requireOrganization(actor);
    const input = StructureInput.parse(raw);
    assertValidLevels(input.levels);
    return this.deps.db.transaction(async (tx) => {
      const [s] = await tx.insert(tournamentStructures).values({ organizationId: orgId, name: input.name, description: input.description ?? null }).returning();
      await tx.insert(structureLevels).values(input.levels.map((l, i) => levelRow(s!.id, l, i)));
      await writeAudit(tx, actor, this.deps.edgeNodeId, { organizationId: orgId, entityType: "structure", entityId: s!.id, action: "STRUCTURE_CREATED", after: { name: input.name, levels: input.levels.length } });
      return s!;
    });
  }

  async rename(actor: Actor, id: string, raw: unknown) {
    requirePermission(actor, "structure.manage");
    const orgId = requireOrganization(actor);
    const input = StructureInput.pick({ name: true, description: true }).parse(raw);
    const s = await this.row(orgId, id);
    const [u] = await this.deps.db
      .update(tournamentStructures)
      .set({ name: input.name, description: input.description ?? null, version: s.version + 1, updatedAt: this.deps.now() })
      .where(eq(tournamentStructures.id, id))
      .returning();
    return u!;
  }

  async duplicate(actor: Actor, id: string, name?: string) {
    requirePermission(actor, "structure.manage");
    const orgId = requireOrganization(actor);
    const s = await this.row(orgId, id);
    const levels = await loadLevels(this.deps.db, id);
    return this.deps.db.transaction(async (tx) => {
      const [copy] = await tx.insert(tournamentStructures).values({ organizationId: orgId, name: name ?? `${s.name} (copy)`, description: s.description }).returning();
      if (levels.length > 0) await tx.insert(structureLevels).values(levels.map(({ id: _id, structureId: _s, ...l }) => ({ ...l, structureId: copy!.id })));
      return copy!;
    });
  }

  /** Private copy of a structure owned by a tournament (template edits never affect it). */
  async snapshotForTournament(tx: Executor, orgId: string, sourceStructureId: string, tournamentId: string) {
    const src = await this.row(orgId, sourceStructureId, tx);
    const levels = await loadLevels(tx, sourceStructureId);
    const [copy] = await tx
      .insert(tournamentStructures)
      .values({ organizationId: orgId, name: src.name, description: src.description, ownerTournamentId: tournamentId })
      .returning();
    if (levels.length > 0) await tx.insert(structureLevels).values(levels.map(({ id: _id, structureId: _s, ...l }) => ({ ...l, structureId: copy!.id })));
    return copy!;
  }

  /**
   * Replace levels (bulk edit, reorder, insert breaks). For a running
   * tournament only future levels may change: levels up to and including the
   * current one must stay identical, so the clock anchor stays valid.
   */
  async replaceLevels(actor: Actor, id: string, raw: unknown) {
    requirePermission(actor, "structure.manage");
    const orgId = requireOrganization(actor);
    const input = StructureLevelsReplaceInput.parse(raw);
    assertValidLevels(input.levels);
    return this.deps.db.transaction(async (tx) => {
      const [s] = await tx.select().from(tournamentStructures).where(and(eq(tournamentStructures.id, id), eq(tournamentStructures.organizationId, orgId))).for("update");
      if (!s) throw notFound("structure");
      if (s.version !== input.expectedVersion) throw conflict(`structure changed (version ${s.version})`, s.version);
      const existing = await loadLevels(tx, id);
      const next = input.levels.map((l, i) => levelRow(id, l, i));
      const now = this.deps.now();

      let tournament: typeof tournaments.$inferSelect | undefined;
      if (s.ownerTournamentId) {
        [tournament] = await tx.select().from(tournaments).where(eq(tournaments.id, s.ownerTournamentId)).for("update");
        if (tournament && ["FINISHED", "FINALIZED", "CANCELLED"].includes(tournament.status)) {
          throw new AppError("INVALID_STATE", "the tournament is over; its structure is frozen");
        }
        if (tournament) {
          const clockRow = await loadClockRow(tx, tournament.id);
          const anchor = materialize(anchorFromRow(clockRow), levelLikes(existing), now.getTime());
          if (anchor.status !== "NOT_STARTED") {
            const current = deriveClock(anchor, levelLikes(existing), now.getTime()).levelIndex;
            for (let i = 0; i <= current; i++) {
              if (!existing[i] || !next[i] || !sameLevel(next[i]!, existing[i]!)) {
                throw new AppError("RULE_VIOLATION", `levels up to the current level (${current + 1}) cannot be changed while the tournament runs`);
              }
            }
            // Persist the materialised anchor so it references a stable level.
            await tx.update(tournamentClockStates).set({ ...rowFromAnchor(anchor, existing) }).where(eq(tournamentClockStates.tournamentId, tournament.id));
          }
        }
      }

      // Update in place (keeps level ids referenced by the clock), then insert/delete the tail.
      for (let i = 0; i < next.length; i++) {
        const cur = existing[i];
        if (cur) await tx.update(structureLevels).set(next[i]!).where(eq(structureLevels.id, cur.id));
        else await tx.insert(structureLevels).values(next[i]!);
      }
      if (existing.length > next.length) {
        await tx.delete(structureLevels).where(and(eq(structureLevels.structureId, id), gte(structureLevels.position, next.length)));
      }
      const [updated] = await tx.update(tournamentStructures).set({ version: s.version + 1, updatedAt: now }).where(eq(tournamentStructures.id, id)).returning();
      await writeAudit(tx, actor, this.deps.edgeNodeId, {
        organizationId: orgId,
        tournamentId: s.ownerTournamentId,
        entityType: "structure",
        entityId: id,
        action: "STRUCTURE_LEVELS_REPLACED",
        before: { levels: existing.length },
        after: { levels: next.length },
      });
      if (tournament) {
        await tx.update(tournaments).set({ version: tournament.version + 1, updatedAt: now }).where(eq(tournaments.id, tournament.id));
        await publishEvents(
          tx,
          { organizationId: orgId, venueId: tournament.venueId, edgeNodeId: this.deps.edgeNodeId },
          [
            {
              name: "tournament.updated",
              topics: [topic.tournament(tournament.id), topic.venue(tournament.venueId)],
              audience: "public",
              data: { tournamentId: tournament.id, levelsChanged: true },
              tournamentVersion: tournament.version + 1,
              aggregateType: "tournament",
              aggregateId: tournament.id,
            },
          ],
          now,
        );
      }
      return { ...updated!, levels: (await loadLevels(tx, id)).map(toLevelView) };
    });
  }

  async remove(actor: Actor, id: string) {
    requirePermission(actor, "structure.manage");
    const orgId = requireOrganization(actor);
    const s = await this.row(orgId, id);
    if (s.ownerTournamentId) throw new AppError("RULE_VIOLATION", "a tournament's own structure cannot be deleted");
    const [usedT] = await this.deps.db.select({ id: tournaments.id }).from(tournaments).where(eq(tournaments.structureId, id)).limit(1);
    const [usedTpl] = await this.deps.db.select({ id: tournamentTemplates.id }).from(tournamentTemplates).where(eq(tournamentTemplates.structureId, id)).limit(1);
    if (usedT || usedTpl) throw new AppError("RULE_VIOLATION", "structure is in use by a template or tournament");
    await this.deps.db.delete(tournamentStructures).where(eq(tournamentStructures.id, id));
    await writeAudit(this.deps.db, actor, this.deps.edgeNodeId, { organizationId: orgId, entityType: "structure", entityId: id, action: "STRUCTURE_DELETED", before: { name: s.name } });
    return { ok: true };
  }

  // --- templates ------------------------------------------------------------------------------

  async listTemplates(actor: Actor) {
    requirePermission(actor, "tournament.read");
    const orgId = requireOrganization(actor);
    return this.deps.db.select().from(tournamentTemplates).where(eq(tournamentTemplates.organizationId, orgId)).orderBy(asc(tournamentTemplates.name));
  }

  async getTemplate(actor: Actor, id: string) {
    requirePermission(actor, "tournament.read");
    const orgId = requireOrganization(actor);
    const [t] = await this.deps.db.select().from(tournamentTemplates).where(and(eq(tournamentTemplates.id, id), eq(tournamentTemplates.organizationId, orgId)));
    if (!t) throw notFound("template");
    return t;
  }

  async saveTemplate(actor: Actor, raw: unknown, id?: string) {
    requirePermission(actor, "tournament.create");
    const orgId = requireOrganization(actor);
    const input = TournamentTemplateInput.parse(raw);
    const structure = await this.row(orgId, input.structureId);
    // A tournament's private copy changes with that tournament; templates must use a library structure.
    if (structure.ownerTournamentId) throw validation("choose a library structure, not a tournament's own copy");
    const { structureId, houseRulesProfileId, displayTemplateId, name, ...config } = input;
    const values = { organizationId: orgId, name, structureId, houseRulesProfileId: houseRulesProfileId ?? null, displayTemplateId: displayTemplateId ?? null, config };
    const [t] = id
      ? await this.deps.db
          .update(tournamentTemplates)
          .set({ ...values, updatedAt: this.deps.now() })
          .where(and(eq(tournamentTemplates.id, id), eq(tournamentTemplates.organizationId, orgId)))
          .returning()
      : await this.deps.db.insert(tournamentTemplates).values(values).returning();
    if (!t) throw notFound("template");
    await writeAudit(this.deps.db, actor, this.deps.edgeNodeId, { organizationId: orgId, entityType: "tournament_template", entityId: t.id, action: id ? "TEMPLATE_UPDATED" : "TEMPLATE_CREATED", after: input });
    return t;
  }

  async deleteTemplate(actor: Actor, id: string) {
    requirePermission(actor, "tournament.create");
    const orgId = requireOrganization(actor);
    await this.deps.db.update(tournaments).set({ templateId: null }).where(and(eq(tournaments.templateId, id), eq(tournaments.organizationId, orgId)));
    await this.deps.db.delete(tournamentTemplates).where(and(eq(tournamentTemplates.id, id), eq(tournamentTemplates.organizationId, orgId)));
    return { ok: true };
  }

  // --- house rules ------------------------------------------------------------------------------

  async listHouseRules(actor: Actor) {
    requirePermission(actor, "tournament.read");
    const orgId = requireOrganization(actor);
    return this.deps.db.select().from(houseRulesProfiles).where(eq(houseRulesProfiles.organizationId, orgId)).orderBy(asc(houseRulesProfiles.name));
  }

  async saveHouseRules(actor: Actor, raw: unknown, id?: string) {
    requirePermission(actor, "settings.manage");
    const orgId = requireOrganization(actor);
    const input = HouseRulesProfileInput.parse(raw);
    const config = input.preset === "TDA_2026_STYLE" ? { ...TDA_2026_STYLE, ...input.config } : input.config;
    const [row] = id
      ? await this.deps.db
          .update(houseRulesProfiles)
          .set({ name: input.name, preset: input.preset, config, updatedAt: this.deps.now() })
          .where(and(eq(houseRulesProfiles.id, id), eq(houseRulesProfiles.organizationId, orgId)))
          .returning()
      : await this.deps.db.insert(houseRulesProfiles).values({ organizationId: orgId, name: input.name, preset: input.preset, config }).returning();
    if (!row) throw notFound("house rules profile");
    await writeAudit(this.deps.db, actor, this.deps.edgeNodeId, { organizationId: orgId, entityType: "house_rules", entityId: row.id, action: id ? "HOUSE_RULES_UPDATED" : "HOUSE_RULES_CREATED", after: input });
    return row;
  }

  async defaultHouseRules(orgId: string, db: Executor = this.deps.db) {
    const [row] = await db
      .select()
      .from(houseRulesProfiles)
      .where(and(eq(houseRulesProfiles.organizationId, orgId), eq(houseRulesProfiles.isDefault, true)))
      .limit(1);
    return row ?? null;
  }
}
