import type { ErrorCode } from "@pcos/types";

/** Error raised by pure domain logic. Mapped to HTTP status codes by the API layer. */
export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.details = details;
  }
}

export const invalidState = (message: string, details?: unknown) => new DomainError("INVALID_STATE", message, details);
export const ruleViolation = (message: string, details?: unknown) => new DomainError("RULE_VIOLATION", message, details);
