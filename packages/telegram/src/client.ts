// Thin client for the official Telegram Bot API (spec §19). The bot token is
// only ever placed in the request URL path and is redacted from every error.

import type { SendMessageParams, TgBotCommand, TgMessage, TgUpdate, TgUser } from "./types.js";

export type TelegramErrorKind = "rate_limited" | "forbidden" | "bad_request" | "unauthorized" | "conflict" | "server" | "network" | "timeout";

export class TelegramApiError extends Error {
  constructor(
    readonly kind: TelegramErrorKind,
    message: string,
    readonly httpStatus: number | null = null,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = "TelegramApiError";
  }

  /** Errors that retrying will not fix (bot blocked, chat not found, bad token). */
  get permanent(): boolean {
    return this.kind === "forbidden" || this.kind === "bad_request" || this.kind === "unauthorized";
  }

  /** Transport-level failure: the WAN (or Telegram) is unreachable. */
  get networkDown(): boolean {
    return this.kind === "network" || this.kind === "timeout";
  }
}

export interface TelegramClientOptions {
  apiBase?: string;
  fetch?: typeof fetch;
  /** default request timeout (long polling adds its own timeout on top) */
  timeoutMs?: number;
}

export class TelegramBotClient {
  private readonly apiBase: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(
    private readonly token: string,
    opts: TelegramClientOptions = {},
  ) {
    if (!/^\d+:[A-Za-z0-9_-]+$/.test(token)) throw new Error("invalid bot token format");
    this.apiBase = (opts.apiBase ?? "https://api.telegram.org").replace(/\/+$/, "");
    this.fetchImpl = opts.fetch ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
  }

  private redact(text: string): string {
    return text.split(this.token).join("<bot-token>");
  }

  async call<T>(method: string, params: object = {}, opts: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error("timeout")), opts.timeoutMs ?? this.timeoutMs);
    const onAbort = () => controller.abort(opts.signal?.reason);
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.apiBase}/bot${this.token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(params),
        signal: controller.signal,
      });
    } catch (e) {
      const aborted = controller.signal.aborted;
      const message = this.redact(e instanceof Error ? e.message : String(e));
      throw new TelegramApiError(aborted && !opts.signal?.aborted ? "timeout" : "network", `${method}: ${message}`);
    } finally {
      clearTimeout(timeout);
      opts.signal?.removeEventListener("abort", onAbort);
    }

    let body: { ok: boolean; result?: T; description?: string; error_code?: number; parameters?: { retry_after?: number } };
    try {
      body = (await res.json()) as typeof body;
    } catch {
      throw new TelegramApiError(res.status >= 500 ? "server" : "bad_request", `${method}: HTTP ${res.status} with non-JSON body`, res.status);
    }
    if (body.ok) return body.result as T;
    const description = this.redact(body.description ?? `HTTP ${res.status}`);
    const code = body.error_code ?? res.status;
    const retryAfter = body.parameters?.retry_after ?? null;
    const kind: TelegramErrorKind =
      code === 429 ? "rate_limited" : code === 401 ? "unauthorized" : code === 403 ? "forbidden" : code === 409 ? "conflict" : code >= 500 ? "server" : "bad_request";
    throw new TelegramApiError(kind, `${method}: ${description}`, code, retryAfter);
  }

  getMe() {
    return this.call<TgUser>("getMe");
  }

  getUpdates(offset: number | undefined, timeoutSeconds: number, signal?: AbortSignal) {
    return this.call<TgUpdate[]>(
      "getUpdates",
      { offset, timeout: timeoutSeconds, allowed_updates: ["message", "callback_query"] },
      { timeoutMs: (timeoutSeconds + 10) * 1000, signal },
    );
  }

  sendMessage(params: SendMessageParams) {
    return this.call<TgMessage>("sendMessage", params);
  }

  answerCallbackQuery(callbackQueryId: string, text?: string) {
    return this.call<boolean>("answerCallbackQuery", { callback_query_id: callbackQueryId, text });
  }

  deleteWebhook() {
    return this.call<boolean>("deleteWebhook", { drop_pending_updates: false });
  }

  setWebhook(url: string, secretToken: string) {
    return this.call<boolean>("setWebhook", { url, secret_token: secretToken, allowed_updates: ["message", "callback_query"] });
  }

  setMyCommands(commands: TgBotCommand[]) {
    return this.call<boolean>("setMyCommands", { commands });
  }
}
