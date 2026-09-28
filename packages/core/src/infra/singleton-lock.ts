// Cluster-wide singleton via a PostgreSQL session advisory lock held on a
// dedicated connection. Used so that exactly one worker polls a Telegram bot
// token, runs the clock ticker, or pushes to the cloud (spec §20).

import type pg from "pg";

export interface SingletonLock {
  readonly held: boolean;
  release(): Promise<void>;
}

/** 64-bit lock key from a string name. */
export function lockKey(name: string): bigint {
  let h = 1469598103934665603n;
  for (const ch of Buffer.from(name)) {
    h ^= BigInt(ch);
    h = (h * 1099511628211n) & 0xffffffffffffffffn;
  }
  return BigInt.asIntN(64, h);
}

export async function tryAcquireSingleton(pool: pg.Pool, name: string): Promise<SingletonLock> {
  const client = await pool.connect();
  const key = lockKey(name).toString();
  try {
    const res = await client.query<{ ok: boolean }>("select pg_try_advisory_lock($1::bigint) as ok", [key]);
    if (!res.rows[0]?.ok) {
      client.release();
      return { held: false, release: async () => undefined };
    }
  } catch (e) {
    client.release();
    throw e;
  }
  let released = false;
  return {
    get held() {
      return !released;
    },
    release: async () => {
      if (released) return;
      released = true;
      try {
        await client.query("select pg_advisory_unlock($1::bigint)", [key]);
      } finally {
        client.release();
      }
    },
  };
}
