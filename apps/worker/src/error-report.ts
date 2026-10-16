import { createLogger, errorReportFields } from "@sla/logger";

/**
 * Unexpected worker errors, reported as one structured `error_reported` line
 * on stderr (redacted like every log line, `errorReportFields`).
 * the  errors stay visible in the container logs. Expected
 * conditions (reauth, a known permission denial) are still not reported.
 */
const logger = createLogger();

export function captureException(
  error: unknown,
  context?: Record<string, unknown>,
): void {
  logger.error("error_reported", errorReportFields(error, context));
}
