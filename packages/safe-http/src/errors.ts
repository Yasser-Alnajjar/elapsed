/**
 * Every failure the pinned client can produce, as a fixed code. Errors carry
 * only a code (and an HTTP status when there is one): never a URL, header,
 * body or resolved address, so nothing sensitive can reach a log, a Sentry
 * event or a customer-visible `lastSyncError` through them (plan 09, 8.4).
 */
export type SafeHttpErrorCode =
  | "invalid_request" // a URL, header, method or body the client refuses to send
  | "blocked_destination" // the name resolves to a non-public address, or is not an allowed host
  | "unreachable" // DNS failure, refused or reset connection
  | "timeout"
  | "tls_error"
  | "redirect" // any 3xx: redirects are never followed
  | "response_too_large"
  | "unsupported_encoding" // a content-encoding other than identity
  | "bad_response" // not JSON, too deeply nested, or unparseable
  | "budget_exhausted" // the run budget ran out before an attempt could start
  | "run_cap_reached" // the per-run request or byte cap
  | "stopped"; // the caller's stop check fired (for example the Beta flag turned off)

export class SafeHttpError extends Error {
  readonly code: SafeHttpErrorCode;
  readonly status: number | undefined;
  /** True when a retry loop was cut short by the run budget while a real failure was still pending. */
  readonly budgetCut: boolean;
  /** For `stopped`: the caller's reason, a short fixed code. */
  readonly reason: string | undefined;

  constructor(code: SafeHttpErrorCode, options: { status?: number; budgetCut?: boolean; reason?: string } = {}) {
    super(code);
    this.name = "SafeHttpError";
    this.code = code;
    this.status = options.status;
    this.budgetCut = options.budgetCut ?? false;
    this.reason = options.reason;
  }
}

/** The safe classifications a test/sample/preview endpoint may return to a browser (plan 09, 8.5). */
export type SafeClassification =
  | "ok"
  | "blocked_destination"
  | "unreachable"
  | "timeout"
  | "tls_error"
  | "auth_failed"
  | "forbidden"
  | "rate_limited"
  | "bad_response";

export function classifyStatus(status: number): SafeClassification {
  if (status >= 200 && status < 300) return "ok";
  if (status === 401) return "auth_failed";
  if (status === 403) return "forbidden";
  if (status === 429) return "rate_limited";
  return "bad_response";
}

export function classifyError(error: unknown): SafeClassification {
  if (!(error instanceof SafeHttpError)) return "unreachable";
  switch (error.code) {
    case "blocked_destination":
    case "invalid_request":
      return "blocked_destination";
    case "timeout":
    case "budget_exhausted":
      return "timeout";
    case "tls_error":
      return "tls_error";
    case "unreachable":
      return "unreachable";
    default:
      return "bad_response";
  }
}
