// Local realtime hub (spec §14-15). One WebSocket per device, topic
// subscriptions authorised individually, events arriving from PostgreSQL
// LISTEN (committed changes only) and pushed to subscribers on the LAN.

import { randomUUID } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { RealtimeListener, safeEqual, type Core, type PresenceInfo, type PresenceProvider } from "@pcos/core";
import { devices, displayTokens, tournamentTables, tournaments, venues } from "@pcos/db";
import { audienceAllows, authorizeSubscription, type Principal, type TopicTarget } from "@pcos/domain";
import { ClientMessage, parseTopic, type Audience, type RealtimeEvent, type ServerMessage } from "@pcos/types";
import { and, eq } from "drizzle-orm";
import proxyaddr from "proxy-addr";
import { WebSocketServer, type WebSocket } from "ws";
import { SESSION_COOKIE } from "../http/context.js";

interface Conn {
  id: string;
  ws: WebSocket;
  principal: Principal;
  principalKind: "staff" | "player" | "display" | "kiosk" | "anonymous";
  token: string | null;
  userId: string | null;
  sessionId: string | null;
  deviceId: string | null;
  ip: string | null;
  connectedAt: Date;
  subs: Map<string, Audience>;
  alive: boolean;
}

const MAX_SUBSCRIPTIONS = 64;
const MAX_CONNECTIONS_PER_IP = 64;
const HEARTBEAT_MS = 25_000;
const REVALIDATE_MS = 60_000;

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k) out[k] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export class RealtimeHub implements PresenceProvider {
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 });
  private readonly conns = new Map<string, Conn>();
  private readonly perIp = new Map<string, number>();
  private readonly targetCache = new Map<string, { at: number; target: TopicTarget | null }>();
  private listener: RealtimeListener | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private revalidate: NodeJS.Timeout | null = null;
  private readonly trust: (addr: string, i: number) => boolean;

  constructor(private readonly core: Core) {
    this.trust = proxyaddr.compile(core.config.TRUST_PROXY.split(",").map((s) => s.trim()));
  }

  // --- lifecycle ----------------------------------------------------------------------------------

  attach(server: Server) {
    server.on("upgrade", (req, socket, head) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname !== "/ws" && url.pathname !== "/api/v1/ws") return; // not ours
      void this.handleUpgrade(req, socket, head, url);
    });
  }

  async start() {
    this.listener = new RealtimeListener(this.core.config.DATABASE_URL, this.core.db, (e) => this.dispatch(e), () => this.resyncAll());
    await this.listener.start();
    this.heartbeat = setInterval(() => this.beat(), HEARTBEAT_MS);
    this.revalidate = setInterval(() => void this.revalidateSessions(), REVALIDATE_MS);
  }

  async close() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.revalidate) clearInterval(this.revalidate);
    for (const c of this.conns.values()) c.ws.close(1001, "server shutting down");
    await this.listener?.stop();
    this.wss.close();
  }

  get listening() {
    return this.listener?.isConnected ?? false;
  }

  connectionCount() {
    return this.conns.size;
  }

  list(): PresenceInfo[] {
    return [...this.conns.values()].map((c) => ({
      connectionId: c.id,
      deviceId: c.deviceId,
      userId: c.userId,
      principal: c.principalKind,
      ip: c.ip,
      connectedAt: c.connectedAt.toISOString(),
      subscriptions: c.subs.size,
    }));
  }

  // --- connection setup ---------------------------------------------------------------------------------

  private reject(socket: Duplex, status: number, message: string) {
    socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    socket.destroy();
  }

  /** Same trust rules as Fastify: X-Forwarded-For is honoured only from the configured proxies. */
  private clientIp(req: IncomingMessage): string | null {
    try {
      return proxyaddr(req, this.trust);
    } catch {
      return req.socket.remoteAddress ?? null;
    }
  }

  private originAllowed(req: IncomingMessage): boolean {
    const origin = req.headers.origin;
    if (!origin) return true; // non-browser client
    let host: string;
    try {
      host = new URL(origin).host;
    } catch {
      return false;
    }
    const allowed = new Set(
      [req.headers.host, (req.headers["x-forwarded-host"] as string | undefined)?.split(",")[0]?.trim(), ...this.core.config.ALLOWED_ORIGINS.map((o) => (URL.canParse(o) ? new URL(o).host : o))].filter(
        Boolean,
      ),
    );
    return allowed.has(host);
  }

  private async handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, url: URL) {
    try {
      const ip = this.clientIp(req);
      const rl = await this.core.deps.rateLimiter.hit(`ws:${ip}`, 120, 60);
      if (!rl.allowed) return this.reject(socket, 429, "Too Many Requests");
      if ((this.perIp.get(ip ?? "?") ?? 0) >= MAX_CONNECTIONS_PER_IP) return this.reject(socket, 429, "Too Many Connections");

      const cookies = parseCookies(req.headers.cookie);
      const token = cookies[SESSION_COOKIE] ?? null;
      let principal: Principal = { kind: "anonymous" };
      let userId: string | null = null;
      let sessionId: string | null = null;
      let kind: Conn["principalKind"] = "anonymous";

      if (token) {
        // Cross-site WebSocket hijacking protection for cookie-authenticated sockets.
        if (!this.originAllowed(req)) return this.reject(socket, 403, "Forbidden");
        const resolved = await this.core.auth.resolve(token);
        if (resolved) {
          userId = resolved.user.id;
          sessionId = resolved.session.id;
          if (resolved.staff) {
            principal = resolved.staff;
            kind = "staff";
          } else if (resolved.player) {
            principal = resolved.player;
            kind = "player";
          }
        }
      }
      const deviceToken = url.searchParams.get("display") ?? url.searchParams.get("kiosk");
      if (kind === "anonymous" && deviceToken) {
        const d = await this.core.displays.resolve(deviceToken);
        if (!d) return this.reject(socket, 401, "Unauthorized");
        principal = d.principal;
        kind = d.principal.kind;
      }

      const edge = await this.core.edge.status();
      this.wss.handleUpgrade(req, socket, head, (ws) => {
        const conn: Conn = {
          id: randomUUID(),
          ws,
          principal,
          principalKind: kind,
          token,
          userId,
          sessionId,
          deviceId: null,
          ip,
          connectedAt: new Date(),
          subs: new Map(),
          alive: true,
        };
        this.register(conn);
        // First message on every socket: server time (for clock offset) and edge/WAN state.
        this.send(conn, { type: "welcome", connectionId: conn.id, serverTime: Date.now(), principal: conn.principalKind, edge });
      });
    } catch (e) {
      console.error("[ws] upgrade failed:", e instanceof Error ? e.message : e);
      this.reject(socket, 500, "Internal Server Error");
    }
  }

  private register(conn: Conn) {
    this.conns.set(conn.id, conn);
    const ipKey = conn.ip ?? "?";
    this.perIp.set(ipKey, (this.perIp.get(ipKey) ?? 0) + 1);
    conn.ws.on("pong", () => {
      conn.alive = true;
    });
    conn.ws.on("message", (data, isBinary) => {
      if (isBinary) return this.send(conn, { type: "error", code: "BAD_MESSAGE", message: "binary frames are not supported" });
      void this.onMessage(conn, data.toString());
    });
    conn.ws.on("close", () => {
      this.conns.delete(conn.id);
      const n = (this.perIp.get(ipKey) ?? 1) - 1;
      if (n <= 0) this.perIp.delete(ipKey);
      else this.perIp.set(ipKey, n);
    });
    conn.ws.on("error", () => conn.ws.terminate());
  }

  private send(conn: Conn, msg: ServerMessage) {
    if (conn.ws.readyState === conn.ws.OPEN) conn.ws.send(JSON.stringify(msg));
  }

  // --- client messages ---------------------------------------------------------------------------------

  private async onMessage(conn: Conn, raw: string) {
    let msg: ClientMessage;
    try {
      msg = ClientMessage.parse(JSON.parse(raw));
    } catch {
      return this.send(conn, { type: "error", code: "BAD_MESSAGE", message: "invalid message" });
    }
    switch (msg.type) {
      case "ping":
        return this.send(conn, { type: "pong", t: msg.t, serverTime: Date.now() });
      case "hello":
        conn.deviceId = msg.deviceId ?? null;
        if (conn.principal.kind === "staff" && conn.deviceId && conn.userId) {
          const { revoked } = await this.core.devices.touch(conn.principal.organizationId, conn.deviceId, {
            type: msg.deviceType,
            appVersion: msg.appVersion ?? null,
            ip: conn.ip,
            userId: conn.userId,
          });
          if (revoked) conn.ws.close(4403, "device revoked");
        }
        return;
      case "unsubscribe":
        conn.subs.delete(msg.topic);
        return this.send(conn, { type: "unsubscribed", topic: msg.topic });
      case "subscribe": {
        if (conn.subs.size >= MAX_SUBSCRIPTIONS) {
          return this.send(conn, { type: "error", code: "TOO_MANY_SUBSCRIPTIONS", message: "subscription limit reached", topic: msg.topic, requestId: msg.requestId });
        }
        const target = await this.resolveTarget(msg.topic, conn.deviceId, conn.principal);
        if (!target) return this.send(conn, { type: "error", code: "NOT_FOUND", message: "unknown topic", topic: msg.topic, requestId: msg.requestId });
        const decision = authorizeSubscription(conn.principal, target);
        if (!decision.allowed) return this.send(conn, { type: "error", code: "FORBIDDEN", message: decision.reason, topic: msg.topic, requestId: msg.requestId });
        conn.subs.set(msg.topic, decision.audience);
        return this.send(conn, { type: "subscribed", topic: msg.topic, requestId: msg.requestId });
      }
    }
  }

  private async resolveTarget(topicName: string, deviceId: string | null, principal: Principal): Promise<TopicTarget | null> {
    const parsed = parseTopic(topicName);
    if (!parsed) return null;
    const cacheKey = `${topicName}`;
    const cached = this.targetCache.get(cacheKey);
    let target: TopicTarget | null;
    if (cached && Date.now() - cached.at < 10_000) target = cached.target;
    else {
      target = await this.loadTarget(parsed.kind, parsed.id);
      this.targetCache.set(cacheKey, { at: Date.now(), target });
      if (this.targetCache.size > 5000) this.targetCache.clear();
    }
    if (target?.kind === "table" && principal.kind === "staff" && deviceId) {
      const [d] = await this.core.db
        .select({ assignedTableId: devices.assignedTableId })
        .from(devices)
        .where(and(eq(devices.organizationId, principal.organizationId), eq(devices.deviceId, deviceId)));
      return { ...target, dealerTableIds: d?.assignedTableId ? [d.assignedTableId] : [] };
    }
    return target;
  }

  private async loadTarget(kind: string, id: string): Promise<TopicTarget | null> {
    const db = this.core.db;
    switch (kind) {
      case "organization":
        return { kind: "organization", id, organizationId: id, venueId: null };
      case "venue": {
        const [v] = await db.select({ org: venues.organizationId }).from(venues).where(eq(venues.id, id));
        return v ? { kind: "venue", id, organizationId: v.org, venueId: id } : null;
      }
      case "tournament": {
        const [t] = await db.select().from(tournaments).where(eq(tournaments.id, id));
        return t
          ? {
              kind: "tournament",
              id,
              organizationId: t.organizationId,
              venueId: t.venueId,
              tournamentId: t.id,
              tournamentStatus: t.status as TopicTarget["tournamentStatus"],
              published: t.published,
              publicVisibility: t.publicVisibility as TopicTarget["publicVisibility"],
            }
          : null;
      }
      case "table": {
        const [row] = await db
          .select({ tournamentId: tournamentTables.tournamentId, org: tournaments.organizationId, venueId: tournaments.venueId })
          .from(tournamentTables)
          .innerJoin(tournaments, eq(tournaments.id, tournamentTables.tournamentId))
          .where(eq(tournamentTables.id, id));
        return row ? { kind: "table", id, organizationId: row.org, venueId: row.venueId, tournamentId: row.tournamentId } : null;
      }
      case "display": {
        const [d] = await db.select().from(displayTokens).where(eq(displayTokens.id, id));
        return d ? { kind: "display", id, organizationId: d.organizationId, venueId: d.venueId } : null;
      }
      default:
        return null;
    }
  }

  // --- event delivery ------------------------------------------------------------------------------------

  private dispatch(e: RealtimeEvent) {
    const data = (e.data ?? {}) as Record<string, unknown>;
    if (e.name === "session.revoked" && typeof data.userId === "string") {
      for (const c of this.conns.values()) if (c.userId === data.userId) c.ws.close(4401, "session revoked");
    }
    if (e.name === "device.updated" && data.disconnect && typeof data.deviceId === "string") {
      for (const c of this.conns.values()) if (c.deviceId === data.deviceId && c.principal.kind === "staff") c.ws.close(4403, "device disconnected by administrator");
    }
    if (e.name === "tournament.updated") {
      // Visibility / status may have changed: drop cached authorization targets.
      const tid = data.tournamentId;
      if (typeof tid === "string") this.targetCache.delete(`tournament:${tid}`);
    }
    const payload = JSON.stringify({ type: "event", event: e } satisfies ServerMessage);
    const broadcastAll = e.topics.includes("*");
    for (const c of this.conns.values()) {
      if (c.ws.readyState !== c.ws.OPEN) continue;
      if (broadcastAll) {
        c.ws.send(payload);
        continue;
      }
      for (const t of e.topics) {
        const audience = c.subs.get(t);
        if (audience && audienceAllows(audience, e.audience)) {
          c.ws.send(payload);
          break;
        }
      }
    }
  }

  /** After a LISTEN reconnect some events may be missing: ask clients to reload snapshots. */
  private resyncAll() {
    const e: RealtimeEvent = { name: "edge.status.updated", topics: ["*"], audience: "public", data: { resync: true }, occurredAt: new Date().toISOString() };
    this.dispatch(e);
  }

  private beat() {
    for (const c of this.conns.values()) {
      if (!c.alive) {
        c.ws.terminate();
        continue;
      }
      c.alive = false;
      c.ws.ping();
    }
  }

  /** Long-lived sockets must not outlive their session (logout, expiry, revocation). */
  private async revalidateSessions() {
    for (const c of this.conns.values()) {
      if (!c.token) continue;
      const resolved = await this.core.auth.resolve(c.token).catch(() => null);
      if (!resolved || !c.sessionId || !safeEqual(resolved.session.id, c.sessionId)) c.ws.close(4401, "session expired");
    }
  }
}
