// Local WebSocket client (spec §14-17): one connection per page to the edge
// server, reference-counted topic subscriptions, automatic reconnection and
// server clock offset estimation (TV clocks must not depend on the device's
// own clock).

import { estimateOffset } from "@pcos/domain";
import type { ConnectivityState, EdgeStatusPayload, RealtimeEvent, ServerMessage } from "@pcos/types";
import { APP_VERSION, deviceId, deviceType } from "./device";

type EventListener = (e: RealtimeEvent) => void;
type StateListener = () => void;

export interface RealtimeSnapshot {
  socket: "connecting" | "open" | "closed";
  connectivity: ConnectivityState;
  edge: EdgeStatusPayload | null;
  offsetMs: number;
  /** increments every time the socket (re)opens — used to re-sync data */
  epoch: number;
  principal: string | null;
}

function wsUrl(params: Record<string, string>): string {
  const explicit = process.env.NEXT_PUBLIC_WS_URL;
  const base = explicit || `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
  const qs = new URLSearchParams(params).toString();
  return qs ? `${base}?${qs}` : base;
}

export class RealtimeClient {
  private ws: WebSocket | null = null;
  private readonly topics = new Map<string, number>();
  private readonly listeners = new Set<EventListener>();
  private readonly stateListeners = new Set<StateListener>();
  private retry = 500;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private samples: { offsetMs: number; rttMs: number }[] = [];
  private failures = 0;
  private started = false;
  private state: RealtimeSnapshot = { socket: "closed", connectivity: "SERVER_UNREACHABLE", edge: null, offsetMs: 0, epoch: 0, principal: null };

  constructor(private readonly params: Record<string, string> = {}) {}

  start() {
    if (this.started || typeof window === "undefined") return;
    this.started = true;
    window.addEventListener("online", this.onNetworkChange);
    window.addEventListener("offline", this.onNetworkChange);
    document.addEventListener("visibilitychange", this.onVisible);
    this.connect();
  }

  stop() {
    this.started = false;
    window.removeEventListener("online", this.onNetworkChange);
    window.removeEventListener("offline", this.onNetworkChange);
    document.removeEventListener("visibilitychange", this.onVisible);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.ws?.close();
    this.ws = null;
  }

  getSnapshot = (): RealtimeSnapshot => this.state;

  subscribeState = (fn: StateListener) => {
    this.stateListeners.add(fn);
    return () => this.stateListeners.delete(fn);
  };

  onEvent(fn: EventListener) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /** Reference-counted topic subscription; returns the unsubscribe function. */
  subscribe(topic: string) {
    const n = this.topics.get(topic) ?? 0;
    this.topics.set(topic, n + 1);
    if (n === 0) this.sendRaw({ type: "subscribe", topic, requestId: topic });
    return () => {
      const c = (this.topics.get(topic) ?? 1) - 1;
      if (c <= 0) {
        this.topics.delete(topic);
        this.sendRaw({ type: "unsubscribe", topic });
      } else this.topics.set(topic, c);
    };
  }

  /** Server "now" in ms (client clock corrected by the measured offset). */
  now() {
    return Date.now() + this.state.offsetMs;
  }

  private setState(patch: Partial<RealtimeSnapshot>) {
    const next = { ...this.state, ...patch };
    next.connectivity = this.computeConnectivity(next);
    this.state = next;
    this.stateListeners.forEach((l) => l());
  }

  private computeConnectivity(s: RealtimeSnapshot): ConnectivityState {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return "LAN_DISCONNECTED";
    if (s.socket !== "open") return "SERVER_UNREACHABLE";
    if (s.edge && !s.edge.wanOnline) return "WAN_OFFLINE";
    if (s.edge?.cloudSync.enabled && s.edge.cloudSync.pending > 0) return "SYNC_PENDING";
    return "LOCAL_CONNECTED";
  }

  private onNetworkChange = () => {
    this.setState({});
    if (navigator.onLine && this.state.socket === "closed") this.reconnectNow();
  };

  private onVisible = () => {
    if (document.visibilityState === "visible" && this.state.socket === "closed") this.reconnectNow();
  };

  private reconnectNow() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.retry = 500;
    this.connect();
  }

  private sendRaw(msg: object) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private connect() {
    if (!this.started) return;
    this.setState({ socket: "connecting" });
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl(this.params));
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 500;
      this.failures = 0;
      this.samples = [];
      this.sendRaw({ type: "hello", deviceId: deviceId() ?? undefined, deviceType: deviceType() ?? undefined, appVersion: APP_VERSION });
      for (const topic of this.topics.keys()) this.sendRaw({ type: "subscribe", topic, requestId: topic });
      this.setState({ socket: "open", epoch: this.state.epoch + 1 });
      this.ping();
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => this.ping(), 10_000);
    };
    ws.onmessage = (m) => this.onMessage(m.data as string);
    ws.onclose = () => {
      if (this.ws !== ws) return;
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.setState({ socket: "closed" });
      this.scheduleReconnect();
    };
    ws.onerror = () => ws.close();
  }

  private scheduleReconnect() {
    if (!this.started) return;
    this.failures++;
    const delay = Math.min(this.retry, 8_000) * (0.75 + Math.random() * 0.5);
    this.retry = Math.min(this.retry * 2, 8_000);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private ping() {
    this.sendRaw({ type: "ping", t: Date.now() });
  }

  private onMessage(raw: string) {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(raw) as ServerMessage;
    } catch {
      return;
    }
    switch (msg.type) {
      case "welcome": {
        this.setState({ edge: msg.edge, principal: msg.principal, offsetMs: this.samples.length ? this.state.offsetMs : msg.serverTime - Date.now() });
        return;
      }
      case "pong": {
        const sample = estimateOffset(msg.t, msg.serverTime, Date.now());
        this.samples = [...this.samples.slice(-7), sample];
        // The sample with the lowest round trip is the most accurate.
        const best = this.samples.reduce((a, b) => (b.rttMs < a.rttMs ? b : a));
        this.setState({ offsetMs: Math.round(best.offsetMs) });
        return;
      }
      case "event": {
        if (msg.event.name === "edge.status.updated") {
          const data = msg.event.data as Partial<EdgeStatusPayload> & { resync?: boolean };
          if (data.resync) this.setState({ epoch: this.state.epoch + 1 });
          else this.setState({ edge: data as EdgeStatusPayload });
        }
        this.listeners.forEach((l) => l(msg.event));
        return;
      }
      default:
        return;
    }
  }
}
