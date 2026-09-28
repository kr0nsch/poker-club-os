import { createHmac, timingSafeEqual } from "node:crypto";
import type { TgUser } from "./types.js";

function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ab.length === bb.length && ab.length > 0 && timingSafeEqual(ab, bb);
}

export interface VerifiedInitData {
  user: TgUser;
  authDate: Date;
  queryId: string | null;
  startParam: string | null;
}

/**
 * Validate Telegram Mini App `initData` server-side (spec §26):
 * secret_key = HMAC_SHA256(key="WebAppData", msg=bot_token)
 * hash       = HMAC_SHA256(key=secret_key, msg=data_check_string)
 * Never trust client-provided fields without this check.
 */
export function verifyWebAppInitData(initData: string, botToken: string, maxAgeSeconds = 3600, now = Date.now()): VerifiedInitData {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) throw new Error("initData has no hash");
  params.delete("hash");
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secret).update(dataCheckString).digest("hex");
  if (!safeEqualHex(expected, hash)) throw new Error("initData signature mismatch");
  const authDate = Number(params.get("auth_date"));
  if (!Number.isFinite(authDate)) throw new Error("initData has no auth_date");
  if (now / 1000 - authDate > maxAgeSeconds) throw new Error("initData is too old");
  const userRaw = params.get("user");
  if (!userRaw) throw new Error("initData has no user");
  const user = JSON.parse(userRaw) as TgUser;
  if (typeof user.id !== "number") throw new Error("initData user is invalid");
  return { user, authDate: new Date(authDate * 1000), queryId: params.get("query_id"), startParam: params.get("start_param") };
}

/** Build signed initData (used by tests and local development tools). */
export function signWebAppInitData(fields: Record<string, string>, botToken: string): string {
  const params = new URLSearchParams(fields);
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  params.set("hash", createHmac("sha256", secret).update(dataCheckString).digest("hex"));
  return params.toString();
}

/** Constant-time check of the X-Telegram-Bot-Api-Secret-Token webhook header (spec §20 Mode B). */
export function verifyWebhookSecret(header: string | undefined | null, expected: string): boolean {
  if (!header || !expected) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
