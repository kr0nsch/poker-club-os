// Runs one long-polling loop per enabled bot (spec §20 Mode A), guarded by a
// cluster-wide advisory lock so a token is never polled twice.

import { telegramIntegrations } from "@pcos/db";
import { LongPoller } from "@pcos/telegram";
import { eq } from "drizzle-orm";
import type { CoreDeps } from "../deps.js";
import { tryAcquireSingleton, type SingletonLock } from "../infra/singleton-lock.js";
import type { EdgeService } from "../services/edge.service.js";
import type { TelegramBot } from "../telegram/bot.js";
import type { TelegramBotProvider } from "../telegram/bot-provider.js";

interface Active {
  token: string;
  poller: LongPoller;
  lock: SingletonLock;
}

export class TelegramPollingManager {
  private readonly active = new Map<string, Active>();
  private timer: NodeJS.Timeout | null = null;
  private reconciling = false;

  constructor(
    private readonly deps: CoreDeps,
    private readonly bots: TelegramBotProvider,
    private readonly bot: TelegramBot,
    private readonly edge: EdgeService,
  ) {}

  private async setStatus(orgId: string, status: string, error?: string) {
    const [row] = await this.deps.db.select({ status: telegramIntegrations.status }).from(telegramIntegrations).where(eq(telegramIntegrations.organizationId, orgId));
    await this.deps.db
      .insert(telegramIntegrations)
      .values({ organizationId: orgId, status, lastError: error ?? null, enabled: true })
      .onConflictDoUpdate({ target: telegramIntegrations.organizationId, set: { status, lastError: error ?? null, updatedAt: this.deps.now() } });
    if (row?.status !== status) await this.edge.broadcastStatus().catch(() => undefined);
  }

  async reconcile(): Promise<void> {
    if (this.reconciling) return;
    this.reconciling = true;
    try {
      const orgs = new Set(await this.bots.enabledOrganizations());
      for (const [orgId, a] of this.active) {
        const cfg = await this.bots.config(orgId);
        if (!orgs.has(orgId) || cfg.token !== a.token || cfg.mode !== "EDGE_LONG_POLLING") {
          await a.poller.stop();
          await a.lock.release();
          this.active.delete(orgId);
          if (!orgs.has(orgId)) await this.setStatus(orgId, "DISABLED");
        }
      }
      for (const orgId of orgs) {
        if (this.active.has(orgId)) continue;
        const cfg = await this.bots.config(orgId);
        const client = await this.bots.clientFor(orgId);
        if (!cfg.token || !client || cfg.mode !== "EDGE_LONG_POLLING") continue;
        // The numeric bot id (public part of the token) identifies the bot across instances.
        const lock = await tryAcquireSingleton(this.deps.handle.pool, `telegram-poll:${cfg.token.split(":")[0]}`);
        if (!lock.held) continue; // another worker instance polls this bot
        const poller = new LongPoller({
          client,
          pollTimeoutSeconds: this.deps.config.TELEGRAM_POLL_TIMEOUT_S,
          loadOffset: async () => {
            const [row] = await this.deps.db.select({ id: telegramIntegrations.lastUpdateId }).from(telegramIntegrations).where(eq(telegramIntegrations.organizationId, orgId));
            return row?.id ?? null;
          },
          saveOffset: async (updateId) => {
            await this.deps.db
              .insert(telegramIntegrations)
              .values({ organizationId: orgId, lastUpdateId: updateId, lastUpdateAt: this.deps.now(), enabled: true })
              .onConflictDoUpdate({ target: telegramIntegrations.organizationId, set: { lastUpdateId: updateId, lastUpdateAt: this.deps.now() } });
          },
          handle: async (u) => {
            await this.bot.handleUpdate(orgId, u);
          },
          onStatus: (s, detail) => void this.setStatus(orgId, s, detail).catch(() => undefined),
        });
        poller.start();
        this.active.set(orgId, { token: cfg.token, poller, lock });
        console.log(`[telegram] long polling started for organization ${orgId}`);
      }
    } finally {
      this.reconciling = false;
    }
  }

  start(intervalMs = Math.min(15_000, this.deps.config.DISPATCH_INTERVAL_MS * 5)) {
    if (this.timer) return;
    void this.reconcile().catch((e) => console.error("[telegram] reconcile failed:", e instanceof Error ? e.message : e));
    this.timer = setInterval(() => void this.reconcile().catch((e) => console.error("[telegram] reconcile failed:", e instanceof Error ? e.message : e)), intervalMs);
  }

  /** The Internet is back: retry immediately instead of finishing the back-off. */
  wake() {
    for (const a of this.active.values()) a.poller.wake();
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const [orgId, a] of this.active) {
      await a.poller.stop();
      await a.lock.release();
      this.active.delete(orgId);
    }
  }
}
