import type { AppConfig } from "@pcos/core";
import type { FastifyReply } from "fastify";
import { SESSION_COOKIE } from "./context.js";

export function setSessionCookie(reply: FastifyReply, token: string, config: AppConfig) {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    // Lax: sent on top-level navigation (links from Telegram), never on cross-site POSTs.
    sameSite: "lax",
    path: "/",
    maxAge: config.SESSION_TTL_HOURS * 3600,
  });
}

export function clearSessionCookie(reply: FastifyReply, config: AppConfig) {
  reply.clearCookie(SESSION_COOKIE, { path: "/", secure: config.COOKIE_SECURE, sameSite: "lax", httpOnly: true });
}
