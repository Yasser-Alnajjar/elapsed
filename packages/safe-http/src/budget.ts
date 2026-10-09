import { SafeHttpError } from "./errors";

export const DEFAULT_RUN_BUDGET_MS = 120_000;
export const DEFAULT_MIN_USEFUL_MS = 1_000;
export const DEFAULT_REQUESTS_PER_SECOND = 5;
export const DEFAULT_MAX_BYTES_PER_RUN = 50 * 1024 * 1024;
export const DEFAULT_STOP_CHECK_INTERVAL_MS = 5_000;

export interface RunBudgetOptions {
  /** Wall-clock budget for the whole ingest run (default 120 s; plan 09, 6.3). */
  totalMs?: number;
  /** No attempt begins with less than this left (default 1 s). */
  minUsefulMs?: number;
  /** Request starts per second, retries included (default 5). */
  requestsPerSecond?: number;
  /** Bytes read across all responses in the run (default 50 MB). */
  maxBytes?: number;
  /**
   * Called before every attempt, after every back-off wake-up and every
   * `stopCheckIntervalMs` while a request is on the wire. Returns a short
   * fixed reason code to stop the run (the Beta flag turned off), else null.
   */
  checkStop?: () => Promise<string | null>;
  stopCheckIntervalMs?: number;
  /** Injectable monotonic clock (ms) and sleeper, for deterministic callers. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * One budget per ingest run: a monotonic wall-clock deadline that covers every
 * request attempt, retry back-off, rate-limit wait and child request, a request
 * rate, and a byte cap. The client consults it before each attempt and bounds
 * every attempt, wait and `Retry-After` by what remains.
 */
export class RunBudget {
  readonly totalMs: number;
  readonly minUsefulMs: number;
  readonly maxBytes: number;
  readonly stopCheckIntervalMs: number;
  private readonly startedAt: number;
  private readonly spacingMs: number;
  private nextSlotAt = 0;
  private bytes = 0;
  private requestCount = 0;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  private readonly stopCheck: (() => Promise<string | null>) | undefined;

  constructor(options: RunBudgetOptions = {}) {
    this.totalMs = options.totalMs ?? DEFAULT_RUN_BUDGET_MS;
    this.minUsefulMs = options.minUsefulMs ?? DEFAULT_MIN_USEFUL_MS;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES_PER_RUN;
    this.stopCheckIntervalMs = options.stopCheckIntervalMs ?? DEFAULT_STOP_CHECK_INTERVAL_MS;
    this.spacingMs = 1000 / (options.requestsPerSecond ?? DEFAULT_REQUESTS_PER_SECOND);
    this.now = options.now ?? (() => performance.now());
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.stopCheck = options.checkStop;
    this.startedAt = this.now();
  }

  remainingMs(): number {
    return Math.max(0, this.totalMs - (this.now() - this.startedAt));
  }

  get bytesRead(): number {
    return this.bytes;
  }

  get requests(): number {
    return this.requestCount;
  }

  get elapsedMs(): number {
    return this.now() - this.startedAt;
  }

  /** Returns the stop reason if the caller's stop check fires, else null. */
  async stopReason(): Promise<string | null> {
    return this.stopCheck ? this.stopCheck() : null;
  }

  /** Throws `stopped` when the caller's stop check fires. */
  async assertNotStopped(): Promise<void> {
    const reason = await this.stopReason();
    if (reason !== null) throw new SafeHttpError("stopped", { reason });
  }

  /** Throws `budget_exhausted` when too little time is left for a useful attempt. */
  assertCanStart(): void {
    if (this.remainingMs() < this.minUsefulMs) throw new SafeHttpError("budget_exhausted");
  }

  /**
   * Reserves the next request slot (5 per second), waiting if needed, and never
   * past the budget: if the wait would leave less than a useful attempt, the
   * run ends instead of waiting.
   */
  async reserveRequestSlot(): Promise<void> {
    this.assertCanStart();
    const t = this.now();
    const slot = Math.max(t, this.nextSlotAt);
    this.nextSlotAt = slot + this.spacingMs;
    const wait = slot - t;
    if (wait > 0) {
      if (this.remainingMs() - wait < this.minUsefulMs) throw new SafeHttpError("budget_exhausted");
      await this.sleep(wait);
    }
    this.assertCanStart();
    this.requestCount += 1;
  }

  /** Adds response bytes; throws `run_cap_reached` when the per-run byte cap is exceeded. */
  addBytes(count: number): void {
    this.bytes += count;
    if (this.bytes > this.maxBytes) throw new SafeHttpError("run_cap_reached");
  }
}
