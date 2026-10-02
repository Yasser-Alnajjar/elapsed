const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_MAX_TOTAL_WAIT_MS = 60_000;
const DEFAULT_BACKOFF_MS = 5_000;
export const DEFAULT_ATTEMPT_TIMEOUT_MS = 30_000;

export interface RetryPolicy {
  /** Including the first attempt. */
  maxAttempts?: number;
  /** Total time spent sleeping between attempts, across the whole call. */
  maxTotalWaitMs?: number;
  /** Base for exponential backoff when a retryable response carries no usable `Retry-After`. */
  baseBackoffMs?: number;
  /** Layers a provider's own rate-limit signal (Zendesk/Jira/Linear/Intercom's 429, GitHub's 403-with-`Retry-After`) on top of the 5xx retry every provider gets for free. */
  isRetryableStatus?: (response: Response) => boolean;
  /** Hard ceiling for one HTTP attempt; retries retain their usual budget. */
  attemptTimeoutMs?: number;
}

function isServerError(response: Response): boolean {
  return response.status >= 500 && response.status <= 599;
}

/** `Retry-After` is seconds per RFC 9110; a missing or non-numeric header (I-3: this used to become an immediate-retry `NaN`) falls back to exponential backoff instead. */
function retryAfterMs(response: Response): number | null {
  const header = response.headers.get("Retry-After");
  if (header === null) return null;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
}

function backoffMs(attempt: number, base: number): number {
  return base * 2 ** (attempt - 1);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * One retry policy shared by every provider HTTP client (roadmap step 0.9,
 * I-3): parses `Retry-After` when a retryable response carries one,
 * otherwise backs off exponentially — and always caps both the number of
 * attempts and the total time spent waiting, so a persistently failing
 * provider can never hang a cycle indefinitely (the Zendesk client's old
 * 429 handler retried recursively with no cap at all). A network error
 * (DNS, TCP reset, timeout — `perform` rejecting) gets the same capped
 * exponential backoff as a 5xx, since neither carries a `Retry-After` to
 * honor.
 *
 * On success, or once the budget is exhausted, this returns the response
 * (or rethrows the network error) rather than throwing its own error: every
 * provider client's existing status-code handling — permission-denied,
 * reauth-required, generic ApiError — keeps working unchanged on whatever
 * came back last.
 */
export async function fetchWithRetry(
  perform: (signal: AbortSignal) => Promise<Response>,
  policy: RetryPolicy = {},
): Promise<Response> {
  const maxAttempts = policy.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const maxTotalWaitMs = policy.maxTotalWaitMs ?? DEFAULT_MAX_TOTAL_WAIT_MS;
  const baseBackoffMs = policy.baseBackoffMs ?? DEFAULT_BACKOFF_MS;
  const attemptTimeoutMs = policy.attemptTimeoutMs ?? DEFAULT_ATTEMPT_TIMEOUT_MS;

  let attempt = 0;
  let totalWaitMs = 0;

  for (;;) {
    attempt += 1;
    let response: Response;
    try {
      response = await perform(AbortSignal.timeout(attemptTimeoutMs));
    } catch (error) {
      const budgetLeft = maxTotalWaitMs - totalWaitMs;
      if (attempt >= maxAttempts || budgetLeft <= 0) throw error;
      const waitMs = Math.min(backoffMs(attempt, baseBackoffMs), budgetLeft);
      totalWaitMs += waitMs;
      await sleep(waitMs);
      continue;
    }

    const retryable = isServerError(response) || (policy.isRetryableStatus?.(response) ?? false);
    if (!retryable) return response;

    const budgetLeft = maxTotalWaitMs - totalWaitMs;
    if (attempt >= maxAttempts || budgetLeft <= 0) return response;

    const waitMs = Math.min(retryAfterMs(response) ?? backoffMs(attempt, baseBackoffMs), budgetLeft);
    totalWaitMs += waitMs;
    await sleep(waitMs);
  }
}
