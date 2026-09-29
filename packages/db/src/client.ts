import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

export type Schema = typeof schema;
export type Db = NodePgDatabase<Schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Anything that can run queries: the database or an open transaction. */
export type Executor = Db | Tx;

export interface DbHandle {
  db: Db;
  pool: pg.Pool;
  close(): Promise<void>;
}

// BIGINT (int8) values used here (chips, epoch ms) fit in JS numbers.
pg.types.setTypeParser(20, (v) => Number(v));
// NUMERIC appears only in report aggregates (averages, percentages); money is stored as integer cents.
pg.types.setTypeParser(1700, (v) => Number(v));

export function createDb(connectionString: string, opts: { max?: number; applicationName?: string } = {}): DbHandle {
  const pool = new pg.Pool({
    connectionString,
    max: opts.max ?? 10,
    application_name: opts.applicationName ?? "pcos",
    // Fail fast on a dead LAN database instead of hanging request handlers.
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  });
  pool.on("error", (err) => {
    // Idle client errors (e.g. database restart) must not crash the process.
    console.error("[db] idle client error:", err.message);
  });
  const db = drizzle({ client: pool, schema, casing: "snake_case" });
  return {
    db,
    pool,
    close: () => pool.end(),
  };
}

export { schema };
