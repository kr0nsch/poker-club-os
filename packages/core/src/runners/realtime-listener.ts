// LISTEN on the realtime channel with automatic reconnection. Every API
// process runs one; events committed by any process (API or worker) arrive
// here and are pushed to the local WebSocket subscribers.

import pg from "pg";
import type { RealtimeEvent } from "@pcos/types";
import type { Executor } from "@pcos/db";
import { REALTIME_CHANNEL, loadRealtimeEvent } from "../events.js";

export class RealtimeListener {
  private client: pg.Client | null = null;
  private stopped = false;
  private retryMs = 500;
  private connected = false;

  constructor(
    private readonly connectionString: string,
    private readonly db: Executor,
    private readonly onEvent: (e: RealtimeEvent) => void,
    private readonly onReconnect?: () => void,
  ) {}

  get isConnected() {
    return this.connected;
  }

  async start(): Promise<void> {
    this.stopped = false;
    await this.connect();
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    const client = new pg.Client({ connectionString: this.connectionString, application_name: "pcos-realtime" });
    client.on("notification", (msg) => {
      if (msg.channel !== REALTIME_CHANNEL || !msg.payload) return;
      void this.dispatch(msg.payload);
    });
    client.on("error", () => this.scheduleReconnect(client));
    client.on("end", () => this.scheduleReconnect(client));
    try {
      await client.connect();
      await client.query(`LISTEN ${REALTIME_CHANNEL}`);
      const wasReconnect = this.client !== null;
      this.client = client;
      this.connected = true;
      this.retryMs = 500;
      // Events may have been missed while disconnected: clients re-sync their snapshots.
      if (wasReconnect) this.onReconnect?.();
    } catch (e) {
      console.error("[realtime] LISTEN failed:", e instanceof Error ? e.message : e);
      this.scheduleReconnect(client);
    }
  }

  private readonly retired = new WeakSet<pg.Client>();

  private scheduleReconnect(client: pg.Client) {
    // 'error' and 'end' can both fire for one client: reconnect once.
    if (this.retired.has(client)) return;
    this.retired.add(client);
    if (this.client && this.client !== client) return;
    this.connected = false;
    client.removeAllListeners("notification");
    client.end().catch(() => undefined);
    if (this.stopped) return;
    const delay = this.retryMs;
    this.retryMs = Math.min(this.retryMs * 2, 10_000);
    setTimeout(() => void this.connect(), delay);
  }

  private async dispatch(payload: string) {
    try {
      const parsed = JSON.parse(payload) as RealtimeEvent | { ref: number };
      const event = "ref" in parsed ? await loadRealtimeEvent(this.db, parsed.ref) : parsed;
      if (event) this.onEvent(event);
    } catch (e) {
      console.error("[realtime] bad notification:", e instanceof Error ? e.message : e);
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.connected = false;
    await this.client?.end().catch(() => undefined);
    this.client = null;
  }
}
