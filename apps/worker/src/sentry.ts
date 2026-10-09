import * as Sentry from "@sentry/node";
import { redactSentryEvent, redactString, redactValue } from "@sla/logger";

/**
 * The worker is a bare Node process, not a framework with its own
 * init-once hook (`apps/web` has `instrumentation.ts` for that) — this
 * module is that hook. `initialized` gates every capture call so a
 * deployment without `SENTRY_DSN` set pays no cost and produces no noise,
 * matching this repo's "missing credentials mean skip, not a crash"
 * convention (e.g. SMTP, per-org Slack).
 */
let initialized = false;

export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    tracesSampleRate: 0,
    environment: process.env.NODE_ENV ?? "production",
    // Credentials, authorization headers and sensitive URLs never leave the process (N9.3).
    beforeSend: (event) => redactSentryEvent(event),
    beforeBreadcrumb: (breadcrumb) => redactValue(breadcrumb),
  });
  initialized = true;
}
export function captureException(
  error: unknown,
  context?: Record<string, unknown>,
): void {
  if (!initialized) return;
  Sentry.captureException(error, context ? { extra: redactValue(context) } : undefined);
}

export function captureMessage(
  message: string,
  context?: Record<string, unknown> & { level?: Sentry.SeverityLevel },
): void {
  if (!initialized) return;
  const { level, ...extra } = context ?? {};
  Sentry.captureMessage(redactString(message), { level, extra: redactValue(extra) });
}

/** Called during shutdown so a capture made just before exit actually reaches Sentry rather than being dropped mid-flight. */
export async function flushSentry(timeoutMs = 2000): Promise<void> {
  if (!initialized) return;
  await Sentry.flush(timeoutMs);
}
