// Local development database: real PostgreSQL 18 from the embedded-postgres
// package (no Docker, nothing installed system-wide). Data lives in .data/postgres.
//   node scripts/dev-db.mjs            → start and keep running (Ctrl+C to stop)
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, ".data", "postgres");
const port = Number(process.env.DEV_DB_PORT ?? 54320);
const dbName = process.env.DEV_DB_NAME ?? "pcos";

function clearStaleLock() {
  const pid = path.join(dataDir, "postmaster.pid");
  if (!existsSync(pid)) return;
  const n = Number(readFileSync(pid, "utf8").split(/\r?\n/)[0]);
  try {
    process.kill(n, 0);
  } catch {
    rmSync(pid, { force: true });
  }
}

export async function startDevDb({ log = true } = {}) {
  mkdirSync(path.dirname(dataDir), { recursive: true });
  const fresh = !existsSync(path.join(dataDir, "PG_VERSION"));
  if (!fresh) clearStaleLock();
  const pgInstance = new EmbeddedPostgres({ databaseDir: dataDir, user: "postgres", password: "postgres", port, persistent: true, onLog: () => {} });
  if (fresh) {
    if (log) console.log("[db] initialising a new PostgreSQL cluster in .data/postgres …");
    await pgInstance.initialise();
  }
  await pgInstance.start();
  const client = new pg.Client({ connectionString: `postgres://postgres:postgres@127.0.0.1:${port}/postgres` });
  await client.connect();
  const exists = await client.query("select 1 from pg_database where datname = $1", [dbName]);
  if (exists.rowCount === 0) await client.query(`create database ${dbName}`);
  await client.end();
  const url = `postgres://postgres:postgres@127.0.0.1:${port}/${dbName}`;
  if (log) console.log(`[db] PostgreSQL ready: ${url}`);
  return { url, stop: () => pgInstance.stop() };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const db = await startDevDb();
  const stop = async () => {
    await db.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
