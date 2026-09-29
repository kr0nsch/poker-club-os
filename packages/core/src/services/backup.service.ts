// Local database backups (spec §18, §80). pg_dump in custom format into the
// backup volume; optional off-site copy via a configurable command (e.g.
// `restic backup` or `rclone copy` — restic encrypts client-side).

import { spawn } from "node:child_process";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { backupRuns } from "@pcos/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { organizationOf, requirePermission, type Actor } from "../actor.js";
import { writeAudit } from "../audit.js";
import type { CoreDeps } from "../deps.js";
import { AppError } from "../errors.js";

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs: number): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ["ignore", "ignore", "pipe"], shell: false });
    let stderr = "";
    child.stderr.on("data", (d: Buffer) => {
      stderr = (stderr + d.toString()).slice(-2000);
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: -1, stderr: e.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stderr });
    });
  });
}

export class BackupService {
  constructor(
    private readonly deps: CoreDeps,
    private readonly onFailure?: (error: string) => Promise<void>,
  ) {}

  async list(actor: Actor) {
    requirePermission(actor, "backup.manage");
    return this.deps.db.select().from(backupRuns).orderBy(desc(backupRuns.requestedAt)).limit(50);
  }

  async request(actor: Actor) {
    requirePermission(actor, "backup.manage");
    const [running] = await this.deps.db.select().from(backupRuns).where(inArray(backupRuns.status, ["REQUESTED", "RUNNING"])).limit(1);
    if (running) throw new AppError("INVALID_STATE", "a backup is already queued or running");
    const [row] = await this.deps.db.insert(backupRuns).values({ status: "REQUESTED", trigger: "MANUAL", requestedBy: actor.userId }).returning();
    await writeAudit(this.deps.db, actor, this.deps.edgeNodeId, { organizationId: organizationOf(actor), entityType: "backup", entityId: row!.id, action: "BACKUP_REQUESTED" });
    return row!;
  }

  /** Worker tick: run a requested backup, or a scheduled one when due. */
  async runDue(): Promise<string | null> {
    const [requested] = await this.deps.db.select().from(backupRuns).where(eq(backupRuns.status, "REQUESTED")).orderBy(backupRuns.requestedAt).limit(1);
    if (requested) return this.execute(requested.id);
    const hours = this.deps.config.BACKUP_SCHEDULE_HOURS;
    if (hours <= 0) return null;
    const [last] = await this.deps.db.select().from(backupRuns).where(inArray(backupRuns.status, ["SUCCEEDED", "FAILED", "RUNNING"])).orderBy(desc(backupRuns.requestedAt)).limit(1);
    if (last && this.deps.now().getTime() - last.requestedAt.getTime() < hours * 3600_000) return null;
    const [row] = await this.deps.db.insert(backupRuns).values({ status: "REQUESTED", trigger: "SCHEDULE" }).returning();
    return this.execute(row!.id);
  }

  private async execute(id: string): Promise<string> {
    const claimed = await this.deps.db
      .update(backupRuns)
      .set({ status: "RUNNING", startedAt: this.deps.now() })
      .where(and(eq(backupRuns.id, id), eq(backupRuns.status, "REQUESTED")))
      .returning();
    if (claimed.length === 0) return "skipped";
    const dir = path.resolve(this.deps.config.BACKUP_DIR);
    const stamp = this.deps.now().toISOString().replace(/[:.]/g, "-");
    const fileName = `pcos-${stamp}.dump`;
    const file = path.join(dir, fileName);
    try {
      await mkdir(dir, { recursive: true });
      const url = new URL(this.deps.config.DATABASE_URL);
      // Credentials go through the environment, never the process command line.
      const { code, stderr } = await run(
        this.deps.config.PG_DUMP_PATH,
        ["--format=custom", "--no-owner", "--no-privileges", `--file=${file}`, `--host=${url.hostname}`, `--port=${url.port || "5432"}`, `--username=${decodeURIComponent(url.username)}`, url.pathname.slice(1)],
        { PGPASSWORD: decodeURIComponent(url.password), PGCONNECT_TIMEOUT: "10" },
        30 * 60_000,
      );
      if (code !== 0) throw new Error(`pg_dump exited with ${code}: ${stderr.trim() || "no output"}`);
      const size = (await stat(file)).size;
      let offsiteStatus: string | null = null;
      const offsite = this.deps.config.OFFSITE_BACKUP_COMMAND;
      if (offsite) {
        const [cmd, ...args] = offsite.split(" ").filter(Boolean);
        const r = await run(cmd!, [...args.map((a) => a.replace("{file}", file))], {}, 30 * 60_000);
        offsiteStatus = r.code === 0 ? "COPIED" : `FAILED: ${r.stderr.slice(0, 200)}`;
      }
      await this.deps.db.update(backupRuns).set({ status: "SUCCEEDED", fileName, sizeBytes: size, offsiteStatus, finishedAt: this.deps.now() }).where(eq(backupRuns.id, id));
      await this.prune(dir);
      if (offsiteStatus?.startsWith("FAILED")) await this.onFailure?.(`off-site copy failed: ${offsiteStatus}`);
      return "succeeded";
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      await rm(file, { force: true }).catch(() => undefined);
      await this.deps.db.update(backupRuns).set({ status: "FAILED", error: error.slice(0, 500), finishedAt: this.deps.now() }).where(eq(backupRuns.id, id));
      await this.onFailure?.(error);
      return "failed";
    }
  }

  private async prune(dir: string) {
    const keep = this.deps.config.BACKUP_RETENTION;
    const files = (await readdir(dir)).filter((f) => /^pcos-.*\.dump$/.test(f)).sort();
    for (const f of files.slice(0, Math.max(0, files.length - keep))) await rm(path.join(dir, f), { force: true });
  }
}
