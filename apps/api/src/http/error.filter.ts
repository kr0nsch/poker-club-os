import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import { AppError } from "@pcos/core";
import type { ApiErrorBody, ErrorCode } from "@pcos/types";
import type { FastifyReply } from "fastify";

const BY_STATUS: Record<number, ErrorCode> = {
  400: "VALIDATION_ERROR",
  401: "UNAUTHENTICATED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "VERSION_CONFLICT",
  413: "VALIDATION_ERROR",
  415: "VALIDATION_ERROR",
  429: "RATE_LIMITED",
};

interface ZodLike {
  name: string;
  issues: { path: PropertyKey[]; message: string; code: string }[];
}
const isZod = (e: unknown): e is ZodLike => typeof e === "object" && e !== null && (e as { name?: string }).name === "ZodError" && Array.isArray((e as ZodLike).issues);

@Catch()
export class ErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    let status = 500;
    let body: ApiErrorBody;

    if (isZod(exception)) {
      status = 400;
      body = {
        error: {
          code: "VALIDATION_ERROR",
          message: exception.issues.map((i) => `${i.path.map(String).join(".") || "body"}: ${i.message}`).join("; "),
          details: exception.issues.map((i) => ({ path: i.path.map(String), message: i.message, code: i.code })),
        },
      };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      const message = typeof res === "string" ? res : ((res as { message?: string | string[] }).message ?? exception.message);
      body = { error: { code: BY_STATUS[status] ?? (status >= 500 ? "INTERNAL_ERROR" : "VALIDATION_ERROR"), message: Array.isArray(message) ? message.join("; ") : String(message) } };
    } else if ((exception as { statusCode?: number }).statusCode && (exception as { code?: string }).code?.startsWith("FST_")) {
      // Fastify-level errors (body too large, bad JSON, …)
      status = (exception as { statusCode: number }).statusCode;
      body = { error: { code: BY_STATUS[status] ?? "VALIDATION_ERROR", message: (exception as Error).message } };
    } else {
      const err = AppError.from(exception);
      status = err.status;
      body = { error: { code: err.code, message: err.message, ...(err.details !== undefined ? { details: err.details } : {}), ...(err.currentVersion !== undefined ? { currentVersion: err.currentVersion } : {}) } };
      if (err.code === "INTERNAL_ERROR") {
        let root: unknown = exception;
        while (root instanceof Error && root.cause !== undefined && root.cause !== root) root = root.cause;
        console.error("[api] unhandled error:", root instanceof Error ? (root.stack ?? root.message) : root);
      }
    }
    if (status === 429 && !reply.getHeader("retry-after")) reply.header("retry-after", "30");
    void reply.status(status).header("cache-control", "no-store").send(body);
  }
}
