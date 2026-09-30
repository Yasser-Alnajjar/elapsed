export const DEFAULT_ORGANIZATION_CONCURRENCY = 5;

/** A missing or invalid value (NaN, < 1, non-integer) falls back to the default rather than disabling or unbounding the pool. */
export function normalizeConcurrency(value: number | undefined): number {
  return value !== undefined && Number.isInteger(value) && value >= 1
    ? value
    : DEFAULT_ORGANIZATION_CONCURRENCY;
}

/**
 * Runs `fn` over `items` with at most `limit` calls in flight: `limit` runners
 * each take the next unstarted item as soon as their current one settles, so
 * a slow item never holds back the others (no batch barriers) and nothing
 * beyond `limit` is ever started.
 *
 * Fail-fast on an unexpected throw, like the sequential loop it replaces: no
 * further items are started, but items already in flight are awaited to
 * completion before the first error is rethrown, so no work is left running
 * behind a rejected call.
 */
export async function forEachWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  let failed = false;
  let firstError: unknown;

  async function runner(): Promise<void> {
    while (!failed && next < items.length) {
      const index = next++;
      try {
        await fn(items[index]!, index);
      } catch (error) {
        if (!failed) {
          failed = true;
          firstError = error;
        }
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, runner),
  );
  if (failed) throw firstError;
}
