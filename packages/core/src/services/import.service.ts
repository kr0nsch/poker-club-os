// CSV player import (spec §39):
// Upload → Parse → Map Columns → Validate → Duplicate Preview → Import Preview → Apply.

import { importJobs, players } from "@pcos/db";
import { ImportMappingInput, ImportUploadInput, PLAYER_IMPORT_FIELDS, PlayerCreateInput, type PlayerImportField } from "@pcos/types";
import { and, eq } from "drizzle-orm";
import Papa from "papaparse";
import { requireOrganization, requirePermission, type Actor } from "../actor.js";
import { writeAudit } from "../audit.js";
import type { CoreDeps } from "../deps.js";
import { AppError, notFound, validation } from "../errors.js";
import { buildSearchText, defaultDisplayName, type PlayerService } from "./player.service.js";

const HEADER_HINTS: Record<PlayerImportField, RegExp> = {
  firstName: /^(first[ _-]?name|given[ _-]?name|firstname|имя|vorname|prénom)$/i,
  lastName: /^(last[ _-]?name|surname|family[ _-]?name|lastname|фамилия|nachname|nom)$/i,
  displayName: /^(display[ _-]?name|screen[ _-]?name)$/i,
  nickname: /^(nick(name)?|alias|ник)$/i,
  email: /^(e-?mail|mail|почта)$/i,
  phone: /^(phone|mobile|tel(ephone)?|телефон)$/i,
  memberNumber: /^(member([ _-]?(no|number|id))?|card|club[ _-]?id|номер)$/i,
  country: /^(country|страна|land)$/i,
  language: /^(lang(uage)?|язык)$/i,
  dateOfBirth: /^(dob|birth[ _-]?date|date[ _-]?of[ _-]?birth|дата рождения)$/i,
  marketingConsent: /^(marketing|consent|newsletter|opt[ _-]?in)$/i,
  tags: /^(tags?|labels?|теги)$/i,
};

interface ParsedRow {
  row: number;
  data: Record<string, unknown>;
  errors: string[];
  duplicateOf: { playerId: string; field: string } | null;
  inFileDuplicateOf: number | null;
}

export class ImportService {
  constructor(
    private readonly deps: CoreDeps,
    private readonly playersSvc: PlayerService,
  ) {}

  private parse(content: string) {
    const res = Papa.parse<Record<string, string>>(content.replace(/^﻿/, ""), { header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim() });
    if (res.errors.length > 0 && res.data.length === 0) throw validation(`CSV could not be parsed: ${res.errors[0]!.message}`);
    return { headers: res.meta.fields ?? [], rows: res.data };
  }

  suggestMapping(headers: string[]): Record<string, PlayerImportField> {
    const out: Record<string, PlayerImportField> = {};
    for (const h of headers) {
      const field = PLAYER_IMPORT_FIELDS.find((f) => HEADER_HINTS[f].test(h.trim()));
      if (field && !Object.values(out).includes(field)) out[h] = field;
    }
    return out;
  }

  async upload(actor: Actor, raw: unknown) {
    requirePermission(actor, "player.import");
    const orgId = requireOrganization(actor);
    const input = ImportUploadInput.parse(raw);
    const { headers, rows } = this.parse(input.content);
    if (headers.length === 0) throw validation("CSV has no header row");
    const stored = await this.deps.storage.put(`imports/${orgId}`, Buffer.from(input.content, "utf8"), ".csv");
    const mapping = this.suggestMapping(headers);
    const [job] = await this.deps.db
      .insert(importJobs)
      .values({
        organizationId: orgId,
        kind: "PLAYERS_CSV",
        status: "UPLOADED",
        filename: input.filename,
        headers,
        mapping,
        preview: { sample: rows.slice(0, 5), rowCount: rows.length, storageKey: stored.key },
        createdBy: actor.userId,
      })
      .returning();
    return { id: job!.id, headers, rowCount: rows.length, sample: rows.slice(0, 5), suggestedMapping: mapping, fields: PLAYER_IMPORT_FIELDS };
  }

  private async job(orgId: string, id: string) {
    const [job] = await this.deps.db.select().from(importJobs).where(and(eq(importJobs.id, id), eq(importJobs.organizationId, orgId)));
    if (!job) throw notFound("import job");
    return job;
  }

  async get(actor: Actor, id: string) {
    requirePermission(actor, "player.import");
    return this.job(requireOrganization(actor), id);
  }

  async setMapping(actor: Actor, id: string, raw: unknown) {
    requirePermission(actor, "player.import");
    const orgId = requireOrganization(actor);
    const job = await this.job(orgId, id);
    if (job.status === "APPLIED") throw new AppError("INVALID_STATE", "import already applied");
    const input = ImportMappingInput.parse(raw);
    const fields = Object.values(input.mapping);
    for (const [header, field] of Object.entries(input.mapping)) {
      if (!job.headers.includes(header)) throw validation(`unknown column ${header}`);
      if (!(PLAYER_IMPORT_FIELDS as readonly string[]).includes(field)) throw validation(`unknown field ${field}`);
    }
    if (!fields.includes("firstName") || !fields.includes("lastName")) throw validation("map at least firstName and lastName");
    if (new Set(fields).size !== fields.length) throw validation("each field can be mapped only once");
    await this.deps.db.update(importJobs).set({ mapping: input.mapping, duplicateStrategy: input.duplicateStrategy, status: "MAPPED" }).where(eq(importJobs.id, id));
    return { ok: true };
  }

  private async rows(orgId: string, job: typeof importJobs.$inferSelect): Promise<ParsedRow[]> {
    const storageKey = (job.preview as { storageKey?: string } | null)?.storageKey;
    if (!storageKey) throw new AppError("INVALID_STATE", "import file missing");
    const content = (await this.deps.storage.get(storageKey)).toString("utf8");
    const { rows } = this.parse(content);
    const mapping = (job.mapping ?? {}) as Record<string, PlayerImportField>;

    const existing = await this.deps.db
      .select({ id: players.id, email: players.email, phone: players.phone, memberNumber: players.memberNumber })
      .from(players)
      .where(eq(players.organizationId, orgId));
    const byEmail = new Map(existing.filter((p) => p.email).map((p) => [p.email!.toLowerCase(), p.id]));
    const byPhone = new Map(existing.filter((p) => p.phone).map((p) => [p.phone!.replace(/\D/g, ""), p.id]));
    const byMember = new Map(existing.filter((p) => p.memberNumber).map((p) => [p.memberNumber!, p.id]));
    const seen = new Map<string, number>();

    return rows.map((r, i) => {
      const data: Record<string, unknown> = { source: "IMPORT" };
      for (const [header, field] of Object.entries(mapping)) {
        const v = (r[header] ?? "").trim();
        if (v === "") continue;
        if (field === "marketingConsent") data[field] = /^(1|y|yes|true|да|ja|oui)$/i.test(v);
        else if (field === "tags") data[field] = v.split(/[;,|]/).map((t) => t.trim()).filter(Boolean);
        else data[field] = v;
      }
      const parsed = PlayerCreateInput.safeParse(data);
      const errors = parsed.success ? [] : parsed.error.issues.map((iss) => `${iss.path.join(".") || "row"}: ${iss.message}`);
      let duplicateOf: ParsedRow["duplicateOf"] = null;
      const email = typeof data.email === "string" ? data.email.toLowerCase() : null;
      const phone = typeof data.phone === "string" ? data.phone.replace(/\D/g, "") : null;
      const member = typeof data.memberNumber === "string" ? data.memberNumber : null;
      if (member && byMember.has(member)) duplicateOf = { playerId: byMember.get(member)!, field: "memberNumber" };
      else if (email && byEmail.has(email)) duplicateOf = { playerId: byEmail.get(email)!, field: "email" };
      else if (phone && phone.length >= 6 && byPhone.has(phone)) duplicateOf = { playerId: byPhone.get(phone)!, field: "phone" };
      let inFileDuplicateOf: number | null = null;
      for (const key of [member && `m:${member}`, email && `e:${email}`].filter(Boolean) as string[]) {
        if (seen.has(key)) inFileDuplicateOf = seen.get(key)!;
        else seen.set(key, i + 2);
      }
      return { row: i + 2, data: parsed.success ? (parsed.data as unknown as Record<string, unknown>) : data, errors, duplicateOf, inFileDuplicateOf };
    });
  }

  async validate(actor: Actor, id: string) {
    requirePermission(actor, "player.import");
    const orgId = requireOrganization(actor);
    const job = await this.job(orgId, id);
    if (job.status === "UPLOADED") throw new AppError("INVALID_STATE", "set the column mapping first");
    const rows = await this.rows(orgId, job);
    const invalid = rows.filter((r) => r.errors.length > 0);
    const duplicates = rows.filter((r) => r.errors.length === 0 && (r.duplicateOf || r.inFileDuplicateOf));
    const creatable = rows.filter((r) => r.errors.length === 0 && !r.duplicateOf && !r.inFileDuplicateOf);
    const preview = {
      ...(job.preview as object),
      total: rows.length,
      valid: rows.length - invalid.length,
      invalid: invalid.slice(0, 200).map((r) => ({ row: r.row, errors: r.errors })),
      duplicates: duplicates.slice(0, 200).map((r) => ({ row: r.row, duplicateOf: r.duplicateOf, inFileDuplicateOf: r.inFileDuplicateOf, name: `${r.data.firstName ?? ""} ${r.data.lastName ?? ""}` })),
      willCreate: creatable.length,
      willUpdate: job.duplicateStrategy === "UPDATE" ? duplicates.filter((d) => d.duplicateOf && !d.inFileDuplicateOf).length : 0,
      willSkip: job.duplicateStrategy === "UPDATE" ? duplicates.filter((d) => d.inFileDuplicateOf).length : duplicates.length,
      sampleNew: creatable.slice(0, 10).map((r) => r.data),
    };
    await this.deps.db.update(importJobs).set({ status: "VALIDATED", preview }).where(eq(importJobs.id, id));
    return preview;
  }

  async apply(actor: Actor, id: string) {
    requirePermission(actor, "player.import");
    requirePermission(actor, "player.create");
    const orgId = requireOrganization(actor);
    const job = await this.job(orgId, id);
    if (job.status !== "VALIDATED") throw new AppError("INVALID_STATE", "validate the import before applying it");
    const rows = await this.rows(orgId, job);
    const report = { created: 0, updated: 0, skipped: 0, invalid: 0, duplicates: 0 };
    const now = this.deps.now();
    await this.deps.db.transaction(async (tx) => {
      for (const r of rows) {
        if (r.errors.length > 0) {
          report.invalid++;
          continue;
        }
        if (r.inFileDuplicateOf) {
          report.duplicates++;
          report.skipped++;
          continue;
        }
        if (r.duplicateOf) {
          report.duplicates++;
          if (job.duplicateStrategy !== "UPDATE") {
            report.skipped++;
            continue;
          }
          const [before] = await tx.select().from(players).where(eq(players.id, r.duplicateOf.playerId));
          const d = r.data as Record<string, string | null | undefined>;
          const patch = Object.fromEntries(
            (["firstName", "lastName", "nickname", "email", "phone", "memberNumber", "country", "language", "dateOfBirth"] as const)
              .filter((k) => d[k] != null && d[k] !== "")
              .map((k) => [k, d[k]]),
          );
          const merged = { ...before!, ...patch };
          await tx
            .update(players)
            .set({ ...patch, searchText: buildSearchText(merged), version: before!.version + 1, updatedAt: now })
            .where(eq(players.id, before!.id));
          report.updated++;
          continue;
        }
        const d = r.data as ReturnType<typeof PlayerCreateInput.parse>;
        await this.playersSvc.create(actor, { ...d, displayName: d.displayName ?? defaultDisplayName(d.firstName, d.lastName, d.nickname), source: "IMPORT" }, tx);
        report.created++;
      }
      await tx.update(importJobs).set({ status: "APPLIED", report, appliedAt: now }).where(eq(importJobs.id, id));
      await writeAudit(tx, actor, this.deps.edgeNodeId, { organizationId: orgId, entityType: "import_job", entityId: id, action: "IMPORT_APPLIED", after: report }, now);
    });
    return report;
  }
}
