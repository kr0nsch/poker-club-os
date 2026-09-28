// Test infrastructure: a real PostgreSQL (embedded binaries, no Docker) shared
// by all test files of a run. A template database holds the migrated schema;
// each test file clones it (CREATE DATABASE … TEMPLATE) in milliseconds.

import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import { createDb, runMigrations, seedSystemRoles } from "@pcos/db";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const TEMPLATE_DB = "pcos_template";
const USER = "postgres";
const PASSWORD = "postgres";

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as { port: number }).port;
      srv.close(() => resolve(port));
    });
  });
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Remove a stale postmaster.pid left behind by a crashed run. */
function clearStaleLock(dataDir: string) {
  const pidFile = path.join(dataDir, "postmaster.pid");
  if (!existsSync(pidFile)) return;
  const pid = Number(readFileSync(pidFile, "utf8").split(/\r?\n/)[0]);
  if (!Number.isFinite(pid) || !processAlive(pid)) rmSync(pidFile, { force: true });
}

export interface EmbeddedCluster {
  port: number;
  baseUrl: string;
  stop(): Promise<void>;
}

export async function startEmbeddedCluster(opts: { dataDir: string; port?: number; log?: boolean }): Promise<EmbeddedCluster> {
  const port = opts.port ?? (await freePort());
  mkdirSync(path.dirname(opts.dataDir), { recursive: true });
  const fresh = !existsSync(path.join(opts.dataDir, "PG_VERSION"));
  if (!fresh) clearStaleLock(opts.dataDir);
  const cluster = new EmbeddedPostgres({
    databaseDir: opts.dataDir,
    user: USER,
    password: PASSWORD,
    port,
    persistent: true,
    onLog: opts.log ? (m: unknown) => console.log("[pg]", m) : () => undefined,
    onError: (m: unknown) => {
      if (opts.log) console.error("[pg]", m);
    },
  });
  if (fresh) await cluster.initialise();
  await cluster.start();
  return {
    port,
    baseUrl: `postgres://${USER}:${PASSWORD}@127.0.0.1:${port}`,
    stop: () => cluster.stop(),
  };
}

async function adminQuery(baseUrl: string, sql: string) {
  const client = new pg.Client({ connectionString: `${baseUrl}/postgres` });
  await client.connect();
  try {
    return await client.query(sql);
  } finally {
    await client.end();
  }
}

/** Create (or refresh) the migrated template database. */
export async function prepareTemplate(baseUrl: string): Promise<void> {
  const leftovers = await adminQuery(baseUrl, "select datname from pg_database where datname like 'test_%'");
  for (const row of leftovers.rows as { datname: string }[]) {
    await adminQuery(baseUrl, `drop database if exists "${row.datname}" with (force)`);
  }
  await adminQuery(baseUrl, `drop database if exists ${TEMPLATE_DB} with (force)`);
  await adminQuery(baseUrl, `create database ${TEMPLATE_DB}`);
  const handle = createDb(`${baseUrl}/${TEMPLATE_DB}`, { max: 2, applicationName: "pcos-test-template" });
  try {
    await runMigrations(handle);
    await seedSystemRoles(handle.db);
  } finally {
    await handle.close();
  }
}

/** Clone the template into a fresh database and return its URL. */
export async function createTestDatabase(baseUrl: string): Promise<{ url: string; drop(): Promise<void> }> {
  const name = `test_${randomBytes(6).toString("hex")}`;
  await adminQuery(baseUrl, `create database ${name} template ${TEMPLATE_DB}`);
  return {
    url: `${baseUrl}/${name}`,
    drop: async () => {
      await adminQuery(baseUrl, `drop database if exists ${name} with (force)`);
    },
  };
}

/** Vitest globalSetup helper: start the shared cluster and provide its URL. */
export async function globalSetupPostgres(provide: (key: string, value: string) => void): Promise<() => Promise<void>> {
  const dataDir = path.join(REPO_ROOT, ".data", `test-pg-${process.pid % 7}`);
  const cluster = await startEmbeddedCluster({ dataDir });
  await prepareTemplate(cluster.baseUrl);
  provide("pgBaseUrl", cluster.baseUrl);
  return async () => {
    await cluster.stop();
  };
}
