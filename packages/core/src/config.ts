import { z } from "zod";

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v == null || v === "" ? def : ["1", "true", "yes", "on"].includes(v.toLowerCase())));

const optionalUrl = z
  .string()
  .optional()
  .transform((v) => (v ? v : undefined))
  .pipe(z.url().optional());

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().optional().transform((v) => v || undefined),

  APP_URL: optionalUrl,
  LOCAL_APP_URL: optionalUrl,
  LOCAL_HOSTNAME: z.string().optional().transform((v) => v || undefined),
  /** comma separated list of allowed browser origins for CSRF/Origin checks */
  ALLOWED_ORIGINS: z.string().optional().transform((v) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : [])),

  EDGE_NODE_ID: z.string().min(1).default("edge-dev"),
  VENUE_ID: z.string().optional().transform((v) => v || undefined),

  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  /** key for encrypting integration secrets at rest (defaults to a key derived from SESSION_SECRET) */
  SECRETS_ENCRYPTION_KEY: z.string().optional().transform((v) => v || undefined),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 90).default(24 * 14),
  COOKIE_SECURE: bool(true),
  /** one-time token required to run the first-run setup wizard; generated and logged when unset */
  SETUP_TOKEN: z.string().optional().transform((v) => v || undefined),

  TELEGRAM_ENABLED: bool(false),
  TELEGRAM_BOT_TOKEN: z.string().optional().transform((v) => v || undefined),
  TELEGRAM_BOT_USERNAME: z.string().optional().transform((v) => v || undefined),
  TELEGRAM_MODE: z
    .string()
    .optional()
    .transform((v) => (v === "webhook" || v === "CLOUD_WEBHOOK" ? "CLOUD_WEBHOOK" : "EDGE_LONG_POLLING")),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional().transform((v) => v || undefined),
  TELEGRAM_API_BASE: z.string().default("https://api.telegram.org"),

  CLOUD_SYNC_ENABLED: bool(false),
  CLOUD_API_URL: optionalUrl,
  CLOUD_SYNC_TOKEN: z.string().optional().transform((v) => v || undefined),

  WAN_PROBE_URLS: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : ["https://api.telegram.org", "https://1.1.1.1"])),
  WAN_PROBE_INTERVAL_MS: z.coerce.number().int().min(1000).default(15_000),

  STORAGE_DIR: z.string().default("./data/files"),
  BACKUP_DIR: z.string().default("./data/backups"),
  BACKUP_SCHEDULE_HOURS: z.coerce.number().min(0).default(6),
  BACKUP_RETENTION: z.coerce.number().int().min(1).default(28),
  PG_DUMP_PATH: z.string().default("pg_dump"),

  S3_ENDPOINT: z.string().optional().transform((v) => v || undefined),
  S3_BUCKET: z.string().optional().transform((v) => v || undefined),
  S3_ACCESS_KEY: z.string().optional().transform((v) => v || undefined),
  S3_SECRET_KEY: z.string().optional().transform((v) => v || undefined),

  SMTP_HOST: z.string().optional().transform((v) => v || undefined),
  SMTP_PORT: z.coerce.number().int().optional(),
  SMTP_USER: z.string().optional().transform((v) => v || undefined),
  SMTP_PASSWORD: z.string().optional().transform((v) => v || undefined),

  SENTRY_DSN: z.string().optional().transform((v) => v || undefined),
  SOFTWARE_VERSION: z.string().default("0.1.0"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

export type AppConfig = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  return parsed.data;
}

/** Diagnostic view of configuration with every secret removed (spec §82). */
export function redactedConfig(c: AppConfig): Record<string, unknown> {
  const secretKeys = /SECRET|TOKEN|PASSWORD|KEY|DATABASE_URL|REDIS_URL|DSN/;
  return Object.fromEntries(
    Object.entries(c).map(([k, v]) => [k, secretKeys.test(k) ? (v ? "<set>" : "<unset>") : v]),
  );
}
