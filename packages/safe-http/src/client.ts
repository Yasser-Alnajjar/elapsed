import { lookup as dnsLookup } from "node:dns";
import { Agent, request } from "undici";
import { isPublicAddress } from "./address";
import { RunBudget } from "./budget";
import { SafeHttpError } from "./errors";
import { parseJsonLimited } from "./json";
import { BLOCKED_METADATA_ADDRESSES, assertSameOrigin, parseHttpsOrigin, validateHeaders, type DestinationOptions, type ParsedOrigin } from "./url";

export const DEFAULT_ATTEMPT_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
export const DEFAULT_MAX_JSON_DEPTH = 20;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_BASE_BACKOFF_MS = 5_000;
const CONNECT_TIMEOUT_MS = 10_000;

export interface SafeRequest {
  method: "GET" | "POST";
  /** Absolute URL on the base origin, built with `buildUrl` or taken from a same-origin next link. */
  url: URL | string;
  /** Extra headers for this request (merged over the client's default headers). */
  headers?: Record<string, string>;
  /** `POST` only: an already-serialized JSON body. */
  body?: string;
}

export interface SafeResponse {
  readonly status: number;
  /** Lowercased header names. */
  readonly headers: Readonly<Record<string, string>>;
  readonly text: string;
  /** Parsed with the depth limit. Throws `bad_response` for a non-JSON body. */
  json(): unknown;
  /** True when the retry loop was cut short by the run budget while this retryable response was the last one. */
  readonly retriesCutByBudget: boolean;
}

export interface SafeHttpClientOptions {
  /** The base origin; every request must stay on it. */
  baseUrl: string;
  budget: RunBudget;
  /** Default headers for every request (authentication). Validated once. */
  headers?: Record<string, string>;
  /** Secret values that must never appear as a query-string value. */
  secretValues?: readonly string[];
  /** Deployment-level local-development switch; see `privateHostsAllowed`. */
  destination?: DestinationOptions;
  attemptTimeoutMs?: number;
  maxResponseBytes?: number;
  maxJsonDepth?: number;
  maxAttempts?: number;
  baseBackoffMs?: number;
  /** Test seams: name resolution, address policy and an extra trusted CA. Production code passes none. */
  resolve?: (hostname: string) => Promise<string[]>;
  isAllowedAddress?: (address: string) => boolean;
  tlsCa?: string | Buffer;
}

export interface SafeHttpClient {
  readonly origin: ParsedOrigin;
  request(req: SafeRequest): Promise<SafeResponse>;
  /** Closes the pooled connections. One client per ingest run; never reuse across runs or tenants. */
  close(): Promise<void>;
}

// undici's `LookupFunction` callback accepts both the single-address and the `all: true` forms.
type LookupCallback = (error: NodeJS.ErrnoException | null, address: string | { address: string; family: number }[], family?: number) => void;

function defaultResolve(hostname: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    dnsLookup(hostname, { all: true, verbatim: true }, (error, records) => {
      if (error) reject(error);
      else resolve(records.map((record) => record.address));
    });
  });
}

/** Destroys a response body without an unhandled 'error' event. */
function discard(body: { on(event: "error", listener: () => void): unknown; destroy(): unknown }): void {
  body.on("error", () => undefined);
  body.destroy();
}

function errorCode(error: unknown): string {
  const e = error as { code?: unknown; cause?: { code?: unknown } } | null;
  return String(e?.code ?? e?.cause?.code ?? "");
}

const TLS_CODES = /^(ERR_TLS_|ERR_SSL_|CERT_|UNABLE_TO_|DEPTH_ZERO|SELF_SIGNED|HOSTNAME_MISMATCH|ERR_OSSL)/;
const TIMEOUT_CODES = new Set(["UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_CONNECT_TIMEOUT", "ETIMEDOUT"]);

function mapTransportError(error: unknown): SafeHttpError {
  if (error instanceof SafeHttpError) return error;
  const code = errorCode(error);
  if (code === "EBLOCKED") return new SafeHttpError("blocked_destination");
  if (TLS_CODES.test(code)) return new SafeHttpError("tls_error");
  if (TIMEOUT_CODES.has(code)) return new SafeHttpError("timeout");
  return new SafeHttpError("unreachable");
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

function retryAfterMs(headers: Readonly<Record<string, string>>): number | null {
  const header = headers["retry-after"];
  if (header === undefined) return null;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
}

/**
 * The only HTTP client the custom ticket provider uses (plan 09, 8.2/8.3).
 *
 * - Destination: the address connected to is the address validated. Name
 *   resolution and validation happen inside undici's `connect.lookup`, and
 *   every resolved address must be public or the request is refused; the
 *   socket then connects to that validated set only, with SNI and certificate
 *   verification against the host name (N9.1 spike).
 * - No redirects (a 3xx is an error), no proxy environment variables, no HTTP/2.
 * - `undici.request`, not `fetch`: the body is never decompressed, so a
 *   server that ignores `Accept-Encoding: identity` is refused rather than
 *   expanded, and the byte caps apply to the bytes on the wire.
 * - Every attempt, retry back-off, rate-limit wait and `Retry-After` is
 *   bounded by the run budget; errors carry only a fixed code.
 */
export function createSafeHttpClient(options: SafeHttpClientOptions): SafeHttpClient {
  const origin = parseHttpsOrigin(options.baseUrl, options.destination);
  const budget = options.budget;
  const defaultHeaders = validateHeaders(options.headers ?? {});
  const secrets = (options.secretValues ?? []).filter((value) => value.length > 0);
  const attemptTimeoutMs = options.attemptTimeoutMs ?? DEFAULT_ATTEMPT_TIMEOUT_MS;
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const maxJsonDepth = options.maxJsonDepth ?? DEFAULT_MAX_JSON_DEPTH;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const baseBackoffMs = options.baseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS;
  const resolveName = options.resolve ?? defaultResolve;
  const allowPrivate = options.destination?.allowPrivateHosts === true;
  const isAllowed = options.isAllowedAddress ?? isPublicAddress;

  const agent = new Agent({
    connect: {
      timeout: CONNECT_TIMEOUT_MS,
      ...(options.tlsCa ? { ca: options.tlsCa } : {}),
      // Resolve, validate EVERY address, then hand the connect layer only the validated set.
      lookup(hostname: string, lookupOptions: { all?: boolean }, callback: LookupCallback) {
        resolveName(hostname).then(
          (addresses) => {
            const blocked =
              addresses.length === 0 ||
              addresses.some((address) => BLOCKED_METADATA_ADDRESSES.has(address) || (!allowPrivate && !isAllowed(address)));
            if (blocked) {
              const error = new Error("blocked_destination") as NodeJS.ErrnoException;
              error.code = "EBLOCKED";
              callback(error, []);
              return;
            }
            const records = addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
            if (lookupOptions?.all) callback(null, records);
            else callback(null, records[0]!.address, records[0]!.family);
          },
          (error: unknown) => callback(error as NodeJS.ErrnoException, []),
        );
      },
    },
    keepAliveTimeout: 4_000,
    keepAliveMaxTimeout: 10_000,
  });

  function prepare(req: SafeRequest): { url: URL; headers: Record<string, string>; body: string | undefined } {
    if (req.method !== "GET" && req.method !== "POST") throw new SafeHttpError("invalid_request");
    if (req.method === "GET" && req.body !== undefined) throw new SafeHttpError("invalid_request");
    const url = assertSameOrigin(origin, req.url);
    if (url.hash !== "") throw new SafeHttpError("invalid_request");
    if (secrets.length > 0) {
      for (const value of url.searchParams.values()) {
        if (secrets.includes(value)) throw new SafeHttpError("invalid_request");
      }
    }
    const headers = {
      accept: "application/json",
      "accept-encoding": "identity",
      ...(req.method === "POST" ? { "content-type": "application/json" } : {}),
      ...defaultHeaders,
      ...validateHeaders(req.headers ?? {}),
    };
    // The identity encoding and JSON content type are not the caller's to override.
    headers["accept-encoding"] = "identity";
    return { url, headers, body: req.body };
  }

  async function attemptOnce(url: URL, method: "GET" | "POST", headers: Record<string, string>, body: string | undefined, timeoutMs: number): Promise<{ status: number; headers: Record<string, string>; text: string }> {
    const controller = new AbortController();
    let stopReason: string | null = null;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    let checking = false;
    const interval = setInterval(() => {
      if (checking) return;
      checking = true;
      budget
        .stopReason()
        .then((reason) => {
          if (reason !== null && stopReason === null) {
            stopReason = reason;
            controller.abort();
          }
        })
        .catch(() => undefined)
        .finally(() => {
          checking = false;
        });
    }, budget.stopCheckIntervalMs);
    try {
      const response = await request(url, {
        method,
        headers,
        ...(body !== undefined ? { body } : {}),
        dispatcher: agent,
        signal: controller.signal,
        headersTimeout: timeoutMs,
        bodyTimeout: timeoutMs,
      });
      const responseHeaders: Record<string, string> = {};
      for (const [name, value] of Object.entries(response.headers)) {
        if (value !== undefined) responseHeaders[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : String(value);
      }
      if (response.statusCode >= 300 && response.statusCode < 400) {
        discard(response.body);
        throw new SafeHttpError("redirect", { status: response.statusCode });
      }
      const encoding = responseHeaders["content-encoding"];
      if (encoding !== undefined && encoding.toLowerCase() !== "identity") {
        discard(response.body);
        throw new SafeHttpError("unsupported_encoding", { status: response.statusCode });
      }
      const declared = Number(responseHeaders["content-length"]);
      if (Number.isFinite(declared) && declared > maxResponseBytes) {
        discard(response.body);
        throw new SafeHttpError("response_too_large", { status: response.statusCode });
      }
      if (response.statusCode >= 400 && response.statusCode !== 429 && response.statusCode < 500) {
        // The caller classifies these from the status alone; the body is not read.
        discard(response.body);
        return { status: response.statusCode, headers: responseHeaders, text: "" };
      }
      const chunks: Buffer[] = [];
      let received = 0;
      for await (const chunk of response.body) {
        const buffer = chunk as Buffer;
        received += buffer.length;
        if (received > maxResponseBytes) {
          discard(response.body);
          throw new SafeHttpError("response_too_large", { status: response.statusCode });
        }
        budget.addBytes(buffer.length);
        chunks.push(buffer);
      }
      return { status: response.statusCode, headers: responseHeaders, text: Buffer.concat(chunks).toString("utf8") };
    } catch (error) {
      if (stopReason !== null) throw new SafeHttpError("stopped", { reason: stopReason });
      if (timedOut) throw new SafeHttpError("timeout");
      throw mapTransportError(error);
    } finally {
      clearTimeout(timer);
      clearInterval(interval);
    }
  }

  /** Sleeps in slices so the stop check also gates a back-off wake-up, never past the budget. */
  async function backoff(ms: number): Promise<void> {
    let left = Math.min(ms, Math.max(0, budget.remainingMs() - budget.minUsefulMs));
    while (left > 0) {
      const slice = Math.min(left, budget.stopCheckIntervalMs);
      await budget.sleep(slice);
      left -= slice;
      await budget.assertNotStopped();
    }
  }

  function toResponse(raw: { status: number; headers: Record<string, string>; text: string }, cut: boolean): SafeResponse {
    return {
      status: raw.status,
      headers: raw.headers,
      text: raw.text,
      retriesCutByBudget: cut,
      json: () => {
        const type = raw.headers["content-type"]?.toLowerCase() ?? "";
        if (!/(^|[/+;\s])json/.test(type)) throw new SafeHttpError("bad_response", { status: raw.status });
        return parseJsonLimited(raw.text, maxJsonDepth);
      },
    };
  }

  return {
    origin,
    async request(req) {
      const { url, headers, body } = prepare(req);
      let attempt = 0;
      for (;;) {
        attempt += 1;
        await budget.assertNotStopped();
        await budget.reserveRequestSlot(); // throws budget_exhausted before any attempt that cannot be useful
        const timeoutMs = Math.min(attemptTimeoutMs, budget.remainingMs());
        let raw: { status: number; headers: Record<string, string>; text: string } | null = null;
        let failure: SafeHttpError | null = null;
        try {
          raw = await attemptOnce(url, req.method, headers, body, timeoutMs);
        } catch (error) {
          failure = error instanceof SafeHttpError ? error : mapTransportError(error);
        }
        if (raw && !isRetryableStatus(raw.status)) return toResponse(raw, false);
        if (failure && failure.code !== "timeout" && failure.code !== "unreachable") throw failure;
        // A retryable outcome: 5xx/429 or a transport failure that may clear.
        const outOfAttempts = attempt >= maxAttempts;
        const wait = Math.min(raw ? (retryAfterMs(raw.headers) ?? baseBackoffMs * 2 ** (attempt - 1)) : baseBackoffMs * 2 ** (attempt - 1), 60_000);
        const budgetCut = budget.remainingMs() - wait < budget.minUsefulMs;
        if (outOfAttempts || budgetCut) {
          // A real failure stays a failure: the budget cannot turn it into a partial run.
          if (raw) return toResponse(raw, !outOfAttempts && budgetCut);
          throw new SafeHttpError(failure!.code, { ...(failure!.status !== undefined ? { status: failure!.status } : {}), budgetCut: !outOfAttempts && budgetCut });
        }
        await backoff(wait);
      }
    },
    async close() {
      await agent.close();
    },
  };
}
