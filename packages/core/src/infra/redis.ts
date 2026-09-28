// Optional Redis. Used for cross-instance rate limiting and presence; never on
// the critical path: every consumer has an in-process fallback, so a Redis
// outage degrades features instead of stopping the venue (spec §104).

import { Redis } from "ioredis";

export interface RedisHandle {
  client: Redis;
  healthy(): boolean;
  close(): Promise<void>;
}

export function createRedis(url: string | undefined): RedisHandle | null {
  if (!url) return null;
  let ok = false;
  const client = new Redis(url, {
    lazyConnect: false,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 2_000,
    retryStrategy: (times) => Math.min(times * 500, 5_000),
  });
  client.on("ready", () => {
    ok = true;
  });
  client.on("end", () => {
    ok = false;
  });
  client.on("error", () => {
    ok = false;
  });
  return {
    client,
    healthy: () => ok,
    close: async () => {
      client.disconnect();
    },
  };
}
