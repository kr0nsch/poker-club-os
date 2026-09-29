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
  private failures = 0;
  private wakeUp: (() => void) | null = null;

  constructor(private readonly opts: PollerOptions) {}

  /** Skip the current network back-off (e.g. the WAN monitor saw the Internet come back). */
  wake(): void {
    this.failures = 0;
    this.wakeUp?.();
  }

  /** Waits `ms`; `wakeable` back-offs end early on wake() — never a Telegram-requested retry_after. */
  private backoff(ms: number, wakeable: boolean): Promise<void> {
    if (this.opts.sleep) return this.opts.sleep(ms);
    return new Promise<void>((resolve) => {
      const timer = setTimeout(done, ms);
      function done() {
        clearTimeout(timer);
        resolve();
      }
      if (wakeable) this.wakeUp = done;
    }).finally(() => {
      this.wakeUp = null;
    });
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.controller = new AbortController();
    this.loopPromise = this.loop(this.controller.signal);
  }

  async stop(): Promise<void> {
    this.running = false;
    this.controller?.abort(new Error("stopped"));
    this.wakeUp?.();
    await this.loopPromise?.catch(() => undefined);
  }

  private async loop(signal: AbortSignal): Promise<void> {
    // Make sure no webhook is configured, otherwise getUpdates returns 409.
    await this.opts.client.deleteWebhook().catch(() => undefined);
    while (this.running && !signal.aborted) {
      try {
        const last = await this.opts.loadOffset();
        const updates = await this.opts.client.getUpdates(last != null ? last + 1 : undefined, this.opts.pollTimeoutSeconds ?? 25, signal);
        this.failures = 0;
        this.opts.onStatus?.("ONLINE");
        let confirmed = last;
        for (const u of updates.sort((a, b) => a.update_id - b.update_id)) {
          if (!this.running) break;
          try {
            await this.opts.handle(u);
          } catch (e) {
            // A failing handler must not block the queue forever; it records its own error.
            console.error(`[telegram] update ${u.update_id} failed:`, e instanceof Error ? e.message : e);
          }
          // Never move the offset backwards (a redelivered old update must not replay newer ones).
          if (confirmed == null || u.update_id > confirmed) {
            await this.opts.saveOffset(u.update_id);
            confirmed = u.update_id;
          }
        }
      } catch (e) {
        if (!this.running || signal.aborted) break;
        this.failures++;
        const err = e instanceof TelegramApiError ? e : null;
        if (err?.networkDown) this.opts.onStatus?.("WAITING_FOR_NETWORK", err.message);
        else this.opts.onStatus?.("ERROR", e instanceof Error ? e.message : String(e));
        // Respect retry_after, otherwise back off exponentially (never hammer Telegram during outages).
        const delay = err?.retryAfterSeconds ? err.retryAfterSeconds * 1000 : Math.min(60_000, 1000 * 2 ** Math.min(this.failures, 6));
        await this.backoff(delay, !err?.retryAfterSeconds);
      }
    }
  }
}
