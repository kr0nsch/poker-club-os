import { createParamDecorator, SetMetadata, type ExecutionContext } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { RequestState } from "./context.js";

export const AUTH_MODE = "pcos:auth-mode";
export const SKIP_CSRF = "pcos:skip-csrf";

/**
 * public  — anyone (anonymous allowed; session resolved when present)
 * session — any signed-in user
 * staff   — staff roles required (default when no decorator is present)
 * player  — player profile required
 */
export type AuthMode = "public" | "session" | "staff" | "player";

export const Auth = (mode: AuthMode) => SetMetadata(AUTH_MODE, mode);
export const Public = () => Auth("public");
/** For endpoints authenticated by other means (webhook secret, device token in URL, pre-session login). */
export const SkipCsrf = () => SetMetadata(SKIP_CSRF, true);

export const Ctx = createParamDecorator((_data: unknown, ctx: ExecutionContext): RequestState => {
  const req = ctx.switchToHttp().getRequest<FastifyRequest>();
  return req.pcos!;
});
