import { DomainError } from "@pcos/domain";
import type { ErrorCode } from "@pcos/types";

const STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VERSION_CONFLICT: 409,
  INVALID_STATE: 409,
  RULE_VIOLATION: 422,
  DUPLICATE: 409,
  IDEMPOTENCY_MISMATCH: 409,
  RATE_LIMITED: 429,
  CSRF_REJECTED: 403,
  DEVICE_REVOKED: 403,
  FEATURE_DISABLED: 403,
  SETUP_REQUIRED: 409,
  SETUP_ALREADY_COMPLETED: 409,
  CAPACITY_REACHED: 409,
  INTERNAL_ERROR: 500,
};

/** Application error with a stable code and HTTP status. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;
  readonly currentVersion?: number;

  constructor(code: ErrorCode, message: string, opts: { details?: unknown; currentVersion?: number; cause?: unknown } = {}) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = "AppError";
    this.code = code;
    this.status = STATUS[code];
    this.details = opts.details;
    this.currentVersion = opts.currentVersion;
  }

  static from(e: unknown): AppError {
    if (e instanceof AppError) return e;
    if (e instanceof DomainError) return new AppError(e.code, e.message, { details: e.details });
    const pg = pgErrorInfo(e);
    if (pg.code === "23505") return new AppError("DUPLICATE", "a conflicting record already exists", { details: pg.constraint });
    if (pg.code === "40001" || pg.code === "40P01") return new AppError("VERSION_CONFLICT", "concurrent update, please retry");
    const cause = (e as { cause?: unknown } | null)?.cause;
    if (cause instanceof AppError || cause instanceof DomainError) return AppError.from(cause);
    // Keep the original error for server-side logs (never sent to clients).
    return new AppError("INTERNAL_ERROR", "internal error", { cause: e });
  }
}

/** PostgreSQL error code/constraint, whether raw or wrapped by drizzle (`cause`). */
export function pgErrorInfo(e: unknown): { code?: string; constraint?: string } {
  const direct = e as { code?: unknown; constraint?: string; cause?: unknown } | null;
  if (direct && typeof direct.code === "string" && /^[0-9A-Z]{5}$/.test(direct.code)) return { code: direct.code, constraint: direct.constraint };
  const cause = direct?.cause as { code?: unknown; constraint?: string } | undefined;
  if (cause && typeof cause.code === "string") return { code: cause.code, constraint: cause.constraint };
  return {};
}

export const notFound = (what: string) => new AppError("NOT_FOUND", `${what} not found`);
export const forbidden = (message = "not allowed") => new AppError("FORBIDDEN", message);
export const unauthenticated = (message = "authentication required") => new AppError("UNAUTHENTICATED", message);
export const conflict = (message: string, currentVersion?: number) => new AppError("VERSION_CONFLICT", message, { currentVersion });
export const validation = (message: string, details?: unknown) => new AppError("VALIDATION_ERROR", message, { details });
