// End-to-end harness: real API + worker processes (compiled dist) on a fresh
// PostgreSQL database, with the Internet replaced by switchable mocks.

import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import WebSocket from "ws";
import { createTestDatabase, freePort } from "@pcos/testkit";
import type { TournamentSnapshot } from "@pcos/types";
import { MockCloud, MockTelegram, WanProbe } from "./mocks.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const SETUP_TOKEN = "e2e-setup-token-0000000000";
export const BOT_TOKEN = "123456789:AAE2eTestTokenForMockTelegramApi0000";
export const ADMIN = { email: "td@e2e.example", password: "correct-horse-battery", displayName: "E2E Director" };

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function waitFor<T>(fn: () => T | Promise<T>, what: string, timeoutMs = 10_000, everyMs = 100): Promise<NonNullable<T>> {
  const start = Date.now();
  let last: unknown;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v as NonNullable<T>;
    } catch (e) {
      last = e;
    }
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}${last ? `: ${String(last)}` : ""}`);
    await sleep(everyMs);
  }
}

// --- HTTP client with cookie + CSRF, like a browser tab -------------------------------------------

export interface CommandOptions {
  expectedVersion?: number;
  clientOperationId?: string;
}

export type CommandResponse<T = unknown> = {
  actionId: string;
  tournamentVersion: number;
  duplicate?: boolean;
  result: T;
  error?: { code: string; message: string; currentVersion?: number };
};

export class ApiClient {
  cookie = "";
  csrf = "";
  constructor(readonly base: string) {}

  async call<T = unknown>(method: string, p: string, body?: unknown): Promise<{ status: number; body: T }> {
    const res = await fetch(this.base + p, {
      method,
      headers: {
        "content-type": "application/json",
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...(this.csrf && method !== "GET" ? { "x-csrf-token": this.csrf } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0]!;
    const text = await res.text();
    const parsed = text ? (JSON.parse(text) as T) : (undefined as T);
    const csrf = (parsed as { csrfToken?: string } | undefined)?.csrfToken;
    if (csrf) this.csrf = csrf;
    return { status: res.status, body: parsed };
  }

  async ok<T = unknown>(method: string, p: string, body?: unknown): Promise<T> {
    const r = await this.call<T>(method, p, body);
    if (r.status >= 400) throw new Error(`${method} ${p} → ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  }

  get<T = unknown>(p: string) {
    return this.ok<T>("GET", p);
  }
  post<T = unknown>(p: string, body: unknown = {}) {
    return this.ok<T>("POST", p, body);
  }

  async login(email: string, password: string) {
    return this.post("/api/v1/auth/login", { email, password });
  }

  /** Tournament command with the current version (like the floor app). */
  async command<T = unknown>(tid: string, type: string, payload: Record<string, unknown> = {}, opts: CommandOptions = {}) {
    const v = opts.expectedVersion ?? (await this.get<{ tournament: { version: number } }>(`/api/v1/tournaments/${tid}/snapshot`)).tournament.version;
    return this.call<CommandResponse<T>>("POST", `/api/v1/tournaments/${tid}/commands`, {
      type,
      payload,
      expectedVersion: v,
      clientOperationId: opts.clientOperationId ?? crypto.randomUUID(),
    });
  }

  async commandOk<T = unknown>(tid: string, type: string, payload: Record<string, unknown> = {}, opts: CommandOptions = {}) {
    const r = await this.command<T>(tid, type, payload, opts);
    if (r.status >= 400) throw new Error(`${type} → ${r.status} ${JSON.stringify(r.body)}`);
    return r.body as CommandResponse<T>;
  }
}

// --- WebSocket client, like a device on the venue network ------------------------------------------

export interface WsEvent {
  name: string;
  topics: string[];
  data: Record<string, unknown>;
  tournamentVersion?: number;
}

export class WsClient {
  readonly events: WsEvent[] = [];
  readonly messages: Record<string, unknown>[] = [];
  private ws!: WebSocket;

  private constructor() {}

  static async connect(wsUrl: string, opts: { cookie?: string; query?: string; origin?: string } = {}) {
    const c = new WsClient();
    c.ws = new WebSocket(wsUrl + (opts.query ? `?${opts.query}` : ""), { headers: { ...(opts.cookie ? { cookie: opts.cookie } : {}), ...(opts.origin ? { origin: opts.origin } : {}) } });
    c.ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
      c.messages.push(msg);
      if (msg.type === "event") c.events.push(msg.event as WsEvent);
    });
    await new Promise<void>((resolve, reject) => {
      c.ws.once("open", () => resolve());
      c.ws.once("error", reject);
      c.ws.once("unexpected-response", (_req, res) => reject(new Error(`ws upgrade rejected: ${res.statusCode}`)));
    });
    await waitFor(() => c.messages.find((m) => m.type === "welcome"), "welcome");
    return c;
  }

  get welcome() {
    return this.messages.find((m) => m.type === "welcome") as { principal: string; edge: { wanOnline: boolean } } | undefined;
  }

  async subscribe(topic: string) {
    const requestId = Math.random().toString(36).slice(2, 12);
    this.ws.send(JSON.stringify({ type: "subscribe", topic, requestId }));
    const reply = await waitFor(() => this.messages.find((m) => (m.type === "subscribed" || m.type === "error") && m.requestId === requestId), `subscription ${topic}`);
    if (reply.type === "error") throw new Error(`subscribe ${topic} rejected: ${String(reply.message)}`);
  }

  /** Wait for an event (received after `since` events) that matches. */
  waitForEvent(pred: (e: WsEvent) => boolean, what: string, since = 0, timeoutMs = 5_000) {
    return waitFor(() => this.events.slice(since).find(pred), what, timeoutMs, 25);
  }

  close() {
    this.ws.close();
  }
}

// --- the stack ------------------------------------------------------------------------------------------

export interface StackOptions {
  telegram?: boolean;
  cloud?: boolean;
}

export class EdgeStack {
  api: ChildProcess | null = null;
  worker: ChildProcess | null = null;
  apiPort = 0;
  dbUrl = "";
  dropDb: (() => Promise<void>) | null = null;
  readonly wan = new WanProbe();
  readonly telegram = new MockTelegram();
  readonly cloud = new MockCloud();
  readonly logs: string[] = [];
  private env: NodeJS.ProcessEnv = {};

  constructor(private readonly opts: StackOptions = {}) {}

  get url() {
    return `http://127.0.0.1:${this.apiPort}`;
  }
  get wsUrl() {
    return `ws://127.0.0.1:${this.apiPort}/ws`;
  }

  async start(pgBaseUrl: string) {
    const db = await createTestDatabase(pgBaseUrl);
    this.dbUrl = db.url;
    this.dropDb = db.drop;
    this.apiPort = await freePort();
    await this.wan.start();
    await this.telegram.start();
    await this.cloud.start();
    const tmp = mkdtempSync(path.join(os.tmpdir(), "pcos-e2e-"));
    this.env = {
      ...process.env,
      NODE_ENV: "test",
      DATABASE_URL: this.dbUrl,
      REDIS_URL: "",
      PORT: String(this.apiPort),
      SESSION_SECRET: randomBytes(32).toString("hex"),
      COOKIE_SECURE: "false",
      SETUP_TOKEN,
      EDGE_NODE_ID: `edge-e2e-${randomBytes(3).toString("hex")}`,
      ALLOWED_ORIGINS: "",
      TRUST_PROXY: "loopback",
      STORAGE_DIR: path.join(tmp, "files"),
      BACKUP_DIR: path.join(tmp, "backups"),
      BACKUP_SCHEDULE_HOURS: "0",
      WAN_PROBE_URLS: `${this.wan.url}/`,
      WAN_PROBE_INTERVAL_MS: "300",
      FANOUT_INTERVAL_MS: "150",
      DISPATCH_INTERVAL_MS: "250",
      SYNC_PUSH_INTERVAL_MS: "300",
      SYNC_PULL_INTERVAL_MS: "1000",
      TELEGRAM_POLL_TIMEOUT_S: "1",
      TELEGRAM_ENABLED: this.opts.telegram ? "true" : "false",
      TELEGRAM_BOT_TOKEN: this.opts.telegram ? BOT_TOKEN : "",
      TELEGRAM_BOT_USERNAME: this.opts.telegram ? this.telegram.username : "",
      TELEGRAM_API_BASE: this.telegram.url,
      CLOUD_SYNC_ENABLED: this.opts.cloud ? "true" : "false",
      CLOUD_API_URL: this.opts.cloud ? this.cloud.url : "",
      CLOUD_SYNC_TOKEN: this.opts.cloud ? "e2e-cloud-token" : "",
      APP_URL: "",
    };
    await this.startApi();
    await this.startWorker();
  }

  private spawn(name: "api" | "worker") {
    const child = spawn(process.execPath, ["dist/main.js"], { cwd: path.join(REPO, "apps", name), env: this.env, stdio: ["ignore", "pipe", "pipe"] });
    const log = (d: Buffer) => {
      for (const line of d.toString().split(/\r?\n/)) if (line.trim()) this.logs.push(`[${name}] ${line}`);
    };
    child.stdout!.on("data", log);
    child.stderr!.on("data", log);
    return child;
  }

  async startApi() {
    this.api = this.spawn("api");
    await waitFor(async () => (await fetch(`${this.url}/health/ready`).catch(() => null))?.ok, "API ready", 30_000, 200);
  }

  async startWorker() {
    this.worker = this.spawn("worker");
    await waitFor(() => this.logs.some((l) => l.includes("[worker]") && l.includes("started")), "worker started", 30_000, 100);
  }

  /** Hard crash (power loss / container kill): no graceful shutdown. */
  async crash() {
    for (const p of [this.api, this.worker]) {
      if (!p || p.exitCode !== null) continue;
      const exited = new Promise((r) => p.once("exit", r));
      p.kill("SIGKILL");
      await exited;
    }
    this.api = null;
    this.worker = null;
  }

  async stop() {
    await this.crash();
    await this.wan.stop();
    await this.telegram.stop();
    await this.cloud.stop();
    await this.dropDb?.();
  }

  /** "Unplug the Internet cable": Telegram, cloud and the WAN probe become unreachable. */
  async wanDown() {
    await Promise.all([this.wan.stop(), this.telegram.stop(), this.cloud.stop()]);
  }

  async wanUp() {
    await Promise.all([this.wan.start(), this.telegram.start(), this.cloud.start()]);
  }

  async query<T extends pg.QueryResultRow = Record<string, unknown>>(sql: string, params: unknown[] = []) {
    const client = new pg.Client({ connectionString: this.dbUrl });
    await client.connect();
    try {
      return (await client.query<T>(sql, params)).rows;
    } finally {
      await client.end();
    }
  }

  dumpLogs(n = 60) {
    return this.logs.slice(-n).join("\n");
  }
}

// --- scenario helpers -------------------------------------------------------------------------------------

export async function setupVenue(stack: EdgeStack) {
  const td = new ApiClient(stack.url);
  await td.post("/api/v1/auth/setup", {
    setupToken: SETUP_TOKEN,
    organization: { name: "Royal Poker Club", slug: "royal" },
    venue: { name: "Main Room", slug: "main", timezone: "Europe/Moscow", localHostname: "poker.royalclub.example" },
    edgeNode: { name: "E2E edge" },
    admin: ADMIN,
  });
  await td.login(ADMIN.email, ADMIN.password);
  const [venue] = await td.get<{ id: string }[]>("/api/v1/venues");
  const [structure] = await td.get<{ id: string }[]>("/api/v1/structures");
  return { td, venueId: venue!.id, structureId: structure!.id };
}

export async function createPlayers(td: ApiClient, n: number, prefix = "P") {
  const out: { id: string; displayName: string }[] = [];
  for (let i = 0; i < n; i++) {
    out.push(await td.post<{ id: string; displayName: string }>("/api/v1/players", { firstName: `${prefix}${i + 1}`, lastName: "Tester", nickname: `${prefix}${i + 1}` }));
  }
  return out;
}

/** Tournament with `n` checked-in players, seats drawn, ready to start. */
export async function tournamentReady(td: ApiClient, ids: { venueId: string; structureId: string }, n: number, overrides: Record<string, unknown> = {}) {
  const t = await td.post<{ id: string; version: number }>("/api/v1/tournaments", {
    name: "Sunday Main Event",
    venueId: ids.venueId,
    structureId: ids.structureId,
    format: "REENTRY",
    startAt: new Date(Date.now() + 60_000).toISOString(),
    startingStack: 30000,
    tableSize: 9,
    lateRegistrationPolicy: { enabled: true, closeMode: "LEVEL", untilLevel: 4 },
    ...overrides,
  });
  await td.commandOk(t.id, "PUBLISH");
  await td.commandOk(t.id, "OPEN_REGISTRATION");
  const players = await createPlayers(td, n);
  for (const p of players) {
    const r = await td.commandOk<{ registrationId: string }>(t.id, "REGISTER_PLAYER", { playerId: p.id });
    await td.commandOk(t.id, "CHECK_IN", { registrationId: r.result.registrationId, createEntry: true, seat: "NONE" });
  }
  await td.commandOk(t.id, "START_SEATING", { draw: true });
  return { tournamentId: t.id, players };
}

// --- Telegram helpers ----------------------------------------------------------------------------------

let nextUpdateId = 1000;
export const newUpdateId = () => nextUpdateId++;

export function tgMessage(userId: number, text: string, updateId = newUpdateId()) {
  return {
    update_id: updateId,
    message: { message_id: updateId, date: Math.floor(Date.now() / 1000), chat: { id: userId, type: "private" }, from: { id: userId, is_bot: false, first_name: `U${userId}` }, text },
  };
}

export function tgCallback(userId: number, data: string, updateId = newUpdateId()) {
  return {
    update_id: updateId,
    callback_query: {
      id: `cq-${updateId}`,
      from: { id: userId, is_bot: false, first_name: `U${userId}` },
      data,
      message: { message_id: 1, date: Math.floor(Date.now() / 1000), chat: { id: userId, type: "private" } },
    },
  };
}

/** Enable Telegram for the club (the bot token comes from the edge environment). */
export async function enableTelegram(stack: EdgeStack, td: ApiClient, extra: { staffAlertsChatId?: string } = {}) {
  await td.ok("PUT", "/api/v1/telegram/integration", { enabled: true, mode: "EDGE_LONG_POLLING", ...extra });
  await waitFor(() => stack.telegram.calls.includes("getUpdates"), "bot long polling", 15_000);
}

/** Player signs up on the web and links Telegram through the deep link (spec §22). */
export async function linkedPlayer(stack: EdgeStack, telegramUserId: number, name = "Tg") {
  const web = new ApiClient(stack.url);
  const me = await web.ok<{ player: { id: string } }>("POST", "/api/v1/auth/signup", {
    organizationSlug: "royal",
    email: `${name.toLowerCase()}${telegramUserId}@e2e.example`,
    password: ADMIN.password,
    firstName: name,
    lastName: "Player",
    acceptPrivacyPolicy: true,
  });
  const link = await web.post<{ url: string }>("/api/v1/telegram/link");
  const token = new URL(link.url).searchParams.get("start")!;
  const before = stack.telegram.messagesTo(telegramUserId).length;
  stack.telegram.push(tgMessage(telegramUserId, `/start ${token}`));
  const reply = await waitFor(() => stack.telegram.messagesTo(telegramUserId)[before], "link confirmation");
  if (!reply.text.includes("linked")) throw new Error(`linking failed: ${reply.text}`);
  return { web, playerId: me.player.id, startPayload: token };
}

export function snapshot(client: ApiClient, tournamentId: string) {
  return client.get<TournamentSnapshot>(`/api/v1/tournaments/${tournamentId}/snapshot`);
}

/** A seated active entry and a free seat at another table (for MOVE_PLAYER). */
export function pickMove(s: TournamentSnapshot) {
  const entry = s.entries.find((e) => e.status === "ACTIVE" && e.tableId && e.seatNumber)!;
  for (const t of s.tables) {
    if (t.id === entry.tableId || t.status !== "ACTIVE") continue;
    const free = t.seats.find((x) => !x.entryId && !x.locked);
    if (free) return { entry, toTableId: t.id, toSeatNumber: free.seatNumber };
  }
  throw new Error("no free seat at another table");
}
