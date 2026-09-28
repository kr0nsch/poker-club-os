import type { Db, DbHandle } from "@pcos/db";
import type { AppConfig } from "./config.js";
import type { SecretBox } from "./crypto.js";
import type { RateLimiter } from "./infra/rate-limiter.js";
import type { RedisHandle } from "./infra/redis.js";
import type { FileStorage } from "./infra/storage.js";

/** Shared infrastructure handed to every service (composition root: app.ts). */
export interface CoreDeps {
  db: Db;
  handle: DbHandle;
  config: AppConfig;
  edgeNodeId: string;
  secrets: SecretBox;
  rateLimiter: RateLimiter;
  storage: FileStorage;
  redis: RedisHandle | null;
  now(): Date;
}
