import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { DbHandle } from "./client.js";

export const MIGRATIONS_FOLDER = fileURLToPath(new URL("../drizzle", import.meta.url));

/**
 * Apply pending migrations. Guarded by a session-level PostgreSQL advisory
 * lock held on a dedicated connection, so API and worker containers starting
 * simultaneously never race.
 */
export async function runMigrations(handle: Pick<DbHandle, "db" | "pool">): Promise<void> {
  const lockClient = await handle.pool.connect();
  try {
    // Player names come from every language: refuse to run on a non-UTF-8 database.
    const enc = await lockClient.query<{ server_encoding: string }>("show server_encoding");
    if (enc.rows[0]?.server_encoding !== "UTF8") {
      throw new Error(`database encoding is ${enc.rows[0]?.server_encoding}; Poker Club OS requires UTF8 (create the database with ENCODING 'UTF8')`);
    }
    await lockClient.query("select pg_advisory_lock(727001)");
    await migrate(handle.db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await lockClient.query("select pg_advisory_unlock(727001)").catch(() => undefined);
    lockClient.release();
  }
}
