// Resolves the bot token for an organization (spec §31, §88): an encrypted
// per-organization token stored in the database, or — for the organization
// that owns this edge node — the TELEGRAM_BOT_TOKEN environment variable.
// Tokens never leave the server and are never logged.

import { telegramIntegrations, venueEdgeNodes } from "@pcos/db";
import { TelegramBotClient } from "@pcos/telegram";
import { eq } from "drizzle-orm";
import type { CoreDeps } from "../deps.js";

export interface BotConfig {
  token: string | null;
  username: string | null;
  enabled: boolean;
  mode: "EDGE_LONG_POLLING" | "CLOUD_WEBHOOK";
  source: "DB" | "ENV" | null;
}

export class TelegramBotProvider {
  private readonly clients = new Map<string, { token: string; client: TelegramBotClient }>();

  constructor(
    private readonly deps: CoreDeps,
    private readonly fetchImpl?: typeof fetch,
  ) {}

  private async edgeOrganization(): Promise<string | null> {
    const [n] = await this.deps.db.select({ org: venueEdgeNodes.organizationId }).from(venueEdgeNodes).where(eq(venueEdgeNodes.nodeId, this.deps.edgeNodeId));
    return n?.org ?? null;
  }

  async config(organizationId: string): Promise<BotConfig> {
    const [row] = await this.deps.db.select().from(telegramIntegrations).where(eq(telegramIntegrations.organizationId, organizationId));
    const mode = (row?.mode ?? this.deps.config.TELEGRAM_MODE) as BotConfig["mode"];
    if (row?.encryptedBotToken) {
      try {
        return { token: this.deps.secrets.open(row.encryptedBotToken), username: row.botUsername, enabled: row.enabled, mode, source: "DB" };
      } catch {
        return { token: null, username: row.botUsername, enabled: false, mode, source: "DB" };
      }
    }
    const env = this.deps.config.TELEGRAM_BOT_TOKEN;
    if (env && (await this.edgeOrganization()) === organizationId) {
      return { token: env, username: this.deps.config.TELEGRAM_BOT_USERNAME ?? row?.botUsername ?? null, enabled: row ? row.enabled : this.deps.config.TELEGRAM_ENABLED, mode, source: "ENV" };
    }
    return { token: null, username: row?.botUsername ?? null, enabled: false, mode, source: null };
  }

  async clientFor(organizationId: string): Promise<TelegramBotClient | null> {
    const cfg = await this.config(organizationId);
    if (!cfg.token || !cfg.enabled) return null;
    const cached = this.clients.get(organizationId);
    if (cached && cached.token === cfg.token) return cached.client;
    const client = new TelegramBotClient(cfg.token, { apiBase: this.deps.config.TELEGRAM_API_BASE, fetch: this.fetchImpl });
    this.clients.set(organizationId, { token: cfg.token, client });
    return client;
  }

  /** Organizations with an enabled integration (for the polling manager). */
  async enabledOrganizations(): Promise<string[]> {
    const rows = await this.deps.db.select({ org: telegramIntegrations.organizationId }).from(telegramIntegrations).where(eq(telegramIntegrations.enabled, true));
    const out = new Set(rows.map((r) => r.org));
    if (this.deps.config.TELEGRAM_ENABLED && this.deps.config.TELEGRAM_BOT_TOKEN) {
      const org = await this.edgeOrganization();
      if (org) out.add(org);
    }
    return [...out];
  }

  invalidate(organizationId: string) {
    this.clients.delete(organizationId);
  }
}
