// Composition root: builds every service from configuration. Used by the API
// (NestJS providers wrap these instances), the worker and the tests.

import { createHash } from "node:crypto";
import { createDb, type DbHandle } from "@pcos/db";
import { createCryptoRng, type Rng } from "@pcos/domain";
import type { AppConfig } from "./config.js";
import { SecretBox } from "./crypto.js";
import type { CoreDeps } from "./deps.js";
import { MemoryRateLimiter, RedisRateLimiter } from "./infra/rate-limiter.js";
import { createRedis } from "./infra/redis.js";
import { LocalFileStorage } from "./infra/storage.js";
import { NotificationDispatcher } from "./notifications/dispatcher.js";
import { NotificationFanout } from "./notifications/fanout.js";
import { NotificationService } from "./notifications/notification.service.js";
import { EmailTransport, TelegramTransport, UnconfiguredTransport, type NotificationTransport } from "./notifications/transports.js";
import { ClockTicker } from "./runners/clock-ticker.js";
import { Scheduler } from "./runners/scheduler.js";
import { TelegramPollingManager } from "./runners/telegram-poller.js";
import { WanMonitor } from "./runners/wan-monitor.js";
import { AnnouncementService } from "./services/announcement.service.js";
import { AuthService } from "./services/auth.service.js";
import { BackupService } from "./services/backup.service.js";
import { DeviceService } from "./services/device.service.js";
import { DisplayService } from "./services/display.service.js";
import { EdgeService } from "./services/edge.service.js";
import { ImportService } from "./services/import.service.js";
import { LeagueService } from "./services/league.service.js";
import { OrgService } from "./services/org.service.js";
import { PlayerService } from "./services/player.service.js";
import { ReportsService } from "./services/reports.service.js";
import { StructureService } from "./services/structure.service.js";
import { SyncService } from "./services/sync.service.js";
import { TournamentService } from "./services/tournament.service.js";
import { TelegramBot } from "./telegram/bot.js";
import { TelegramBotProvider } from "./telegram/bot-provider.js";
import { TelegramService } from "./telegram/telegram.service.js";
import { HANDLERS } from "./tournaments/handlers/index.js";
import { TournamentCommandExecutor } from "./tournaments/executor.js";

export interface CoreOptions {
  /** injectable clock (tests) */
  now?: () => Date;
  rng?: () => Rng;
  /** injectable fetch for Telegram / cloud / WAN probes (tests) */
  fetch?: typeof fetch;
  /** reuse an existing database handle */
  handle?: DbHandle;
  poolSize?: number;
  applicationName?: string;
}

export type Core = ReturnType<typeof createCore>;

export function createCore(config: AppConfig, opts: CoreOptions = {}) {
  const handle = opts.handle ?? createDb(config.DATABASE_URL, { max: opts.poolSize ?? 20, applicationName: opts.applicationName ?? "pcos" });
  const redis = createRedis(config.REDIS_URL);
  const secretMaterial = config.SECRETS_ENCRYPTION_KEY ?? createHash("sha256").update(`pcos-secrets:${config.SESSION_SECRET}`).digest("hex");
  const deps: CoreDeps = {
    db: handle.db,
    handle,
    config,
    edgeNodeId: config.EDGE_NODE_ID,
    secrets: new SecretBox(secretMaterial),
    rateLimiter: redis ? new RedisRateLimiter(redis) : new MemoryRateLimiter(),
    storage: new LocalFileStorage(config.STORAGE_DIR),
    redis,
    now: opts.now ?? (() => new Date()),
  };

  const executor = new TournamentCommandExecutor({ db: handle.db, edgeNodeId: deps.edgeNodeId, now: deps.now, rng: opts.rng ?? (() => createCryptoRng()) }, HANDLERS);
  const auth = new AuthService(deps);
  const org = new OrgService(deps);
  const devices = new DeviceService(deps);
  const edge = new EdgeService(deps);
  const players = new PlayerService(deps);
  const imports = new ImportService(deps, players);
  const structures = new StructureService(deps);
  const tournaments = new TournamentService(deps, structures);
  const leagues = new LeagueService(deps);
  const announcements = new AnnouncementService(deps, org);
  const displays = new DisplayService(deps, executor);
  const notifications = new NotificationService(deps);
  const reports = new ReportsService(deps);
  const sync = new SyncService(deps, edge, opts.fetch ?? fetch);
  const bots = new TelegramBotProvider(deps, opts.fetch);
  const telegram = new TelegramService(deps, bots, auth);
  const bot = new TelegramBot(deps, bots, telegram, executor, edge);

  const backups = new BackupService(deps, async (error) => {
    const node = await edge.node();
    if (node) await notifications.staffAlert(node.organizationId, "CRITICAL", "Backup failed", error.slice(0, 300), `backup-failed:${new Date().toISOString().slice(0, 13)}`);
  });

  /** Background machinery (started by the worker process only). */
  function createRunners() {
    const telegramPolling = new TelegramPollingManager(deps, bots, bot, edge);
    const wan = new WanMonitor(edge, {
      urls: config.WAN_PROBE_URLS,
      intervalMs: config.WAN_PROBE_INTERVAL_MS,
      fetch: opts.fetch,
      onChange: async (online) => {
        const node = await edge.node();
        if (!node) return;
        if (online) {
          // WAN restored: deliver what is still valid, resume cloud sync (spec §92).
          telegramPolling.wake();
          void dispatcher.runOnce().catch(() => undefined);
          void sync.pushOnce().catch(() => undefined);
          await notifications.staffAlert(node.organizationId, "INFO", "Internet restored", "Edge server WAN connectivity restored. Queued notifications are being delivered.", `wan-restored:${Date.now()}`);
        }
      },
    });
    const transports = new Map<string, NotificationTransport>([
      ["TELEGRAM", new TelegramTransport(bots)],
      ["SMS", new UnconfiguredTransport("SMS")],
      ["PUSH", new UnconfiguredTransport("PUSH")],
    ]);
    if (config.SMTP_HOST) {
      transports.set("EMAIL", new EmailTransport({ host: config.SMTP_HOST, port: config.SMTP_PORT ?? 587, user: config.SMTP_USER, password: config.SMTP_PASSWORD, from: config.SMTP_FROM }));
    }
    const dispatcher = new NotificationDispatcher(deps, transports, () => wan.isOnline(), () => void wan.probeNow());
    return {
      wan,
      dispatcher,
      fanout: new NotificationFanout(deps, notifications),
      clock: new ClockTicker(deps, executor),
      telegramPolling,
      scheduler: new Scheduler(deps, notifications),
    };
  }

  return {
    config,
    deps,
    db: handle.db,
    handle,
    executor,
    auth,
    org,
    devices,
    edge,
    players,
    imports,
    structures,
    tournaments,
    leagues,
    announcements,
    displays,
    notifications,
    reports,
    sync,
    backups,
    bots,
    telegram,
    bot,
    createRunners,
    async close() {
      await redis?.close();
      if (!opts.handle) await handle.close();
    },
  };
}
