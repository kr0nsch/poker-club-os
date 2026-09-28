// Transport adapters (spec §69). Each converts a rendered message into a
// delivery attempt and classifies the outcome for the retry policy.

import type { notifications } from "@pcos/db";
import type { DeliveryOutcome } from "@pcos/domain";
import { TelegramApiError, button, isButtonUrl, keyboard } from "@pcos/telegram";
import type { NotificationChannel } from "@pcos/types";
import type { RenderedMessage } from "./templates.js";
import type { TelegramBotProvider } from "../telegram/bot-provider.js";

export type NotificationRow = typeof notifications.$inferSelect;
export type TransportResult = DeliveryOutcome & { externalId?: number | null; httpStatus?: number | null };

export interface NotificationTransport {
  readonly channel: NotificationChannel;
  send(n: NotificationRow, message: RenderedMessage): Promise<TransportResult>;
}

export class TelegramTransport implements NotificationTransport {
  readonly channel = "TELEGRAM" as const;

  constructor(private readonly bots: TelegramBotProvider) {}

  async send(n: NotificationRow, m: RenderedMessage): Promise<TransportResult> {
    const client = await this.bots.clientFor(n.organizationId);
    if (!client) return { kind: "permanent_failure", error: "Telegram integration is not configured" };
    const chatId = Number(n.recipient);
    if (!Number.isFinite(chatId)) return { kind: "permanent_failure", error: "invalid chat id" };
    try {
      const msg = await client.sendMessage({
        chat_id: chatId,
        text: m.html,
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        reply_markup: isButtonUrl(m.url) ? keyboard([[button.url("Open", m.url)]]) : undefined,
      });
      return { kind: "sent", externalId: msg.message_id, httpStatus: 200 };
    } catch (e) {
      if (e instanceof TelegramApiError) {
        if (e.networkDown) return { kind: "network_down", error: e.message, httpStatus: null };
        if (e.kind === "rate_limited") return { kind: "retry", retryAfterSeconds: e.retryAfterSeconds, error: e.message, httpStatus: e.httpStatus };
        if (e.permanent) return { kind: "permanent_failure", error: e.message, httpStatus: e.httpStatus };
        return { kind: "retry", error: e.message, httpStatus: e.httpStatus };
      }
      return { kind: "retry", error: e instanceof Error ? e.message : String(e) };
    }
  }
}

export interface SmtpConfig {
  host: string;
  port: number;
  user?: string;
  password?: string;
  from: string;
}

/** SMTP e-mail via nodemailer (loaded lazily so the edge runs without it configured). */
export class EmailTransport implements NotificationTransport {
  readonly channel = "EMAIL" as const;
  private transporter: { sendMail(o: object): Promise<{ messageId?: string }> } | null = null;

  constructor(private readonly cfg: SmtpConfig) {}

  private async get() {
    if (this.transporter) return this.transporter;
    const nodemailer = await import("nodemailer");
    this.transporter = nodemailer.createTransport({
      host: this.cfg.host,
      port: this.cfg.port,
      secure: this.cfg.port === 465,
      auth: this.cfg.user ? { user: this.cfg.user, pass: this.cfg.password } : undefined,
      connectionTimeout: 8_000,
    });
    return this.transporter;
  }

  async send(n: NotificationRow, m: RenderedMessage): Promise<TransportResult> {
    if (!n.recipient) return { kind: "permanent_failure", error: "no e-mail address" };
    try {
      const t = await this.get();
      await t.sendMail({ from: this.cfg.from, to: n.recipient, subject: m.title, text: m.url ? `${m.text}\n\n${m.url}` : m.text });
      return { kind: "sent" };
    } catch (e) {
      const code = (e as { code?: string }).code ?? "";
      if (["ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "ENETUNREACH", "ESOCKET", "ECONNECTION"].includes(code)) {
        return { kind: "network_down", error: code };
      }
      const responseCode = (e as { responseCode?: number }).responseCode ?? 0;
      if (responseCode >= 500 && responseCode < 600) return { kind: "permanent_failure", error: String((e as Error).message) };
      return { kind: "retry", error: e instanceof Error ? e.message : String(e) };
    }
  }
}

/** SMS / push abstractions (spec §69): adapters plug in here; not configured by default. */
export class UnconfiguredTransport implements NotificationTransport {
  constructor(readonly channel: NotificationChannel) {}
  async send(): Promise<TransportResult> {
    return { kind: "permanent_failure", error: `${this.channel} transport is not configured` };
  }
}
