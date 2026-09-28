// Long polling loop (EDGE_LONG_POLLING mode, spec §20). The venue edge server
// initiates outbound HTTPS to Telegram — no public inbound endpoint, no port
// forwarding. The caller must guarantee a single active poller per bot token
// (distributed lock) and persist the offset.

import { TelegramApiError, type TelegramBotClient } from "./client.js";
import type { TgUpdate } from "./types.js";

export interface PollerOptions {
  client: TelegramBotClient;
  /** last confirmed update_id (next offset = +1) */
  loadOffset(): Promise<number | null>;
  saveOffset(updateId: number): Promise<void>;
  /** must be idempotent: updates can be redelivered after a crash */
  handle(update: TgUpdate): Promise<void>;
  onStatus?(status: "ONLINE" | "WAITING_FOR_NETWORK" | "ERROR", detail?: string): void;
  pollTimeoutSeconds?: number;
  sleep?: (ms: number) => Promise<void>;
}

export class LongPoller {
  private controller: AbortController | null = null;
  private running = false;
  private loopPromise: Promise<void> | null = null;

  constructor(private readonly opts: PollerOptions) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.controller = new AbortController();
    this.loopPromise = this.loop(this.controller.signal);
  }

  async stop(): Promise<void> {
    this.running = false;
    this.controller?.abort(new Error("stopped"));
    await this.loopPromise?.catch(() => undefined);
  }

  private async loop(signal: AbortSignal): Promise<void> {
    const sleep = this.opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    let failures = 0;
    // Make sure no webhook is configured, otherwise getUpdates returns 409.
    await this.opts.client.deleteWebhook().catch(() => undefined);
    while (this.running && !signal.aborted) {
      try {
        const last = await this.opts.loadOffset();
        const updates = await this.opts.client.getUpdates(last != null ? last + 1 : undefined, this.opts.pollTimeoutSeconds ?? 25, signal);
        failures = 0;
        this.opts.onStatus?.("ONLINE");
        for (const u of updates.sort((a, b) => a.update_id - b.update_id)) {
          if (!this.running) break;
          try {
            await this.opts.handle(u);
          } catch (e) {
            // A failing handler must not block the queue forever; it records its own error.
            console.error(`[telegram] update ${u.update_id} failed:`, e instanceof Error ? e.message : e);
          }
          await this.opts.saveOffset(u.update_id);
        }
      } catch (e) {
        if (!this.running || signal.aborted) break;
        failures++;
        const err = e instanceof TelegramApiError ? e : null;
        if (err?.networkDown) this.opts.onStatus?.("WAITING_FOR_NETWORK", err.message);
        else this.opts.onStatus?.("ERROR", e instanceof Error ? e.message : String(e));
        // Respect retry_after, otherwise back off exponentially (never hammer Telegram during outages).
        const delay = err?.retryAfterSeconds ? err.retryAfterSeconds * 1000 : Math.min(60_000, 1000 * 2 ** Math.min(failures, 6));
        await sleep(delay);
      }
    }
  }
}
