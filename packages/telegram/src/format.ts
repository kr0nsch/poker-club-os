import type { InlineKeyboardButton, InlineKeyboardMarkup } from "./types.js";

/** Escape text for parse_mode=HTML. */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export const button = {
  callback: (text: string, data: string): InlineKeyboardButton => {
    // Telegram limits callback_data to 64 bytes.
    if (Buffer.byteLength(data) > 64) throw new Error(`callback_data too long: ${data}`);
    return { text, callback_data: data };
  },
  url: (text: string, url: string): InlineKeyboardButton => ({ text, url }),
  webApp: (text: string, url: string): InlineKeyboardButton => ({ text, web_app: { url } }),
};

export function keyboard(rows: (InlineKeyboardButton | null | undefined)[][]): InlineKeyboardMarkup {
  return { inline_keyboard: rows.map((r) => r.filter((b): b is InlineKeyboardButton => !!b)).filter((r) => r.length > 0) };
}

/** Telegram only accepts http(s) URLs for buttons; LAN-only IPs are dropped for players outside the venue. */
export function isButtonUrl(url: string | null | undefined): url is string {
  return !!url && /^https?:\/\//.test(url);
}
