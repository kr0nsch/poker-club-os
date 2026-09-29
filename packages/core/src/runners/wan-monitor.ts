// WAN connectivity probe (spec §17, §81). Reaching any probe URL — with any
// HTTP status — means the Internet is available. WAN loss only degrades
// external integrations; the result is broadcast as edge status.

import type { EdgeService } from "../services/edge.service.js";

export interface WanMonitorOptions {
  urls: string[];
  intervalMs: number;
  timeoutMs?: number;
  fetch?: typeof fetch;
  onChange?: (online: boolean) => void | Promise<void>;
}

export class WanMonitor {
  private online = true;
  private known = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly edge: EdgeService,
    private readonly opts: WanMonitorOptions,
  ) {}

  isOnline(): boolean {
    return this.online;
  }

  /** Force a probe soon (e.g. a transport just saw a network error). */
  async probeNow(): Promise<boolean> {
    const f = this.opts.fetch ?? fetch;
    const attempts = this.opts.urls.map(async (url) => {
      const res = await f(url, { method: "HEAD", signal: AbortSignal.timeout(this.opts.timeoutMs ?? 4_000), redirect: "manual" });
      await res.body?.cancel().catch(() => undefined);
      return true;
    });
    let reachable: boolean;
    try {
      reachable = await Promise.any(attempts);
    } catch {
      reachable = false;
    }
    const wasKnown = this.known;
    const flipped = wasKnown && reachable !== this.online;
    this.online = reachable;
    this.known = true;
    // The persisted state also catches outages that began or ended while the worker was down.
    let persistedChange = false;
    try {
      persistedChange = await this.edge.setWanState(reachable);
    } catch (e) {
      console.error("[wan] could not persist WAN state:", e instanceof Error ? e.message : e);
    }
    if (!wasKnown || flipped) console.log(`[wan] Internet ${reachable ? "available" : "UNAVAILABLE — local operations continue"}`);
    if (flipped || persistedChange) await this.opts.onChange?.(reachable);
    return reachable;
  }

  start() {
    if (this.timer) return;
    void this.probeNow();
    this.timer = setInterval(() => void this.probeNow(), this.opts.intervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
