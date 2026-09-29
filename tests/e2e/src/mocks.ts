// Stand-ins for the Internet: a Telegram Bot API, a cloud gateway and a
// WAN probe target. Each can be stopped (connection refused, like an
// unplugged WAN cable) and started again on the same port.

import http from "node:http";
import type { AddressInfo } from "node:net";

abstract class Switchable {
  private server: http.Server | null = null;
  private readonly sockets = new Set<import("node:net").Socket>();
  port = 0;

  protected abstract handle(req: http.IncomingMessage, body: string, res: http.ServerResponse): void | Promise<void>;

  async start(): Promise<void> {
    if (this.server) return;
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c: Buffer) => (body += c.toString()));
      req.on("end", () => void Promise.resolve(this.handle(req, body, res)).catch((e) => res.writeHead(500).end(String(e))));
    });
    server.on("connection", (s) => {
      this.sockets.add(s);
      s.on("close", () => this.sockets.delete(s));
    });
    await new Promise<void>((resolve) => server.listen(this.port, "127.0.0.1", resolve));
    this.port = (server.address() as AddressInfo).port;
    this.server = server;
  }

  /** Simulate the WAN going away: close the listener and every open connection. */
  async stop(): Promise<void> {
    const s = this.server;
    if (!s) return;
    this.server = null;
    for (const sock of this.sockets) sock.destroy();
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }

  get online() {
    return this.server !== null;
  }

  get url() {
    return `http://127.0.0.1:${this.port}`;
  }
}

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}

/** Answers anything with 204 — "the Internet is reachable". */
export class WanProbe extends Switchable {
  protected handle(_req: http.IncomingMessage, _body: string, res: http.ServerResponse) {
    res.writeHead(204).end();
  }
}

export interface SentMessage {
  chatId: number;
  text: string;
  replyMarkup?: unknown;
  at: number;
}

export interface TgUpdateLike {
  update_id: number;
  message?: unknown;
  callback_query?: unknown;
}

/** Minimal Telegram Bot API: getMe, getUpdates (long polling), sendMessage, … */
export class MockTelegram extends Switchable {
  readonly sent: SentMessage[] = [];
  private queue: { update: TgUpdateLike; force: boolean }[] = [];
  private waiters: (() => void)[] = [];
  private messageId = 1;
  calls: string[] = [];

  constructor(readonly username = "pcos_e2e_bot") {
    super();
  }

  /** Deliver an update. `force` ignores the offset (simulates a redelivery after a crash). */
  push(update: TgUpdateLike, force = false) {
    this.queue.push({ update, force });
    this.waiters.splice(0).forEach((w) => w());
  }

  messagesTo(chatId: number) {
    return this.sent.filter((m) => m.chatId === chatId);
  }

  protected async handle(req: http.IncomingMessage, body: string, res: http.ServerResponse) {
    const method = (req.url ?? "").split("/").pop() ?? "";
    this.calls.push(method);
    const params = (body ? JSON.parse(body) : {}) as Record<string, unknown>;
    switch (method) {
      case "getMe":
        return json(res, 200, { ok: true, result: { id: 1, is_bot: true, first_name: "E2E", username: this.username } });
      case "deleteWebhook":
      case "setMyCommands":
      case "answerCallbackQuery":
        return json(res, 200, { ok: true, result: true });
      case "sendMessage": {
        this.sent.push({ chatId: Number(params.chat_id), text: String(params.text), replyMarkup: params.reply_markup, at: Date.now() });
        return json(res, 200, { ok: true, result: { message_id: this.messageId++, date: Math.floor(Date.now() / 1000), chat: { id: Number(params.chat_id), type: "private" }, text: params.text } });
      }
      case "getUpdates": {
        const offset = Number(params.offset ?? 0);
        const take = () => {
          const out = this.queue.filter((q) => q.force || q.update.update_id >= offset);
          this.queue = this.queue.filter((q) => !out.includes(q));
          return out.map((q) => q.update);
        };
        let updates = take();
        if (updates.length === 0) {
          // Long poll, capped at 1 s for fast tests.
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, Math.min(Number(params.timeout ?? 1), 1) * 1000);
            this.waiters.push(() => {
              clearTimeout(timer);
              resolve();
            });
          });
          updates = take();
        }
        if (!this.online) return; // stopped while waiting: connection already destroyed
        return json(res, 200, { ok: true, result: updates });
      }
      default:
        return json(res, 404, { ok: false, error_code: 404, description: `Not Found: method ${method}` });
    }
  }
}

/** Cloud control plane: idempotent event ingestion keyed by eventId. */
export class MockCloud extends Switchable {
  readonly events = new Map<string, { eventType: string; aggregateId: string; deliveries: number }>();
  requests = 0;

  protected handle(req: http.IncomingMessage, body: string, res: http.ServerResponse) {
    if (req.headers.authorization !== "Bearer e2e-cloud-token") return json(res, 401, { error: "unauthorized" });
    if (req.method === "POST" && req.url === "/v1/edge/events") {
      this.requests++;
      const { events } = JSON.parse(body) as { events: { eventId: string; eventType: string; aggregateId: string }[] };
      for (const e of events) {
        const prev = this.events.get(e.eventId);
        this.events.set(e.eventId, { eventType: e.eventType, aggregateId: e.aggregateId, deliveries: (prev?.deliveries ?? 0) + 1 });
      }
      return json(res, 200, { acked: events.map((e) => e.eventId) });
    }
    if (req.method === "GET" && req.url?.startsWith("/v1/edge/changes")) return json(res, 200, { changes: [], nextCursor: "c0" });
    return json(res, 404, { error: "not found" });
  }
}
