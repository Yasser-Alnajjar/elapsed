import { isIP } from "node:net";
import { SafeHttpError } from "./errors";

const MAX_URL_LENGTH = 2048;
const BLOCKED_SUFFIXES = [".local", ".internal", ".localhost"];
const BLOCKED_NAMES = new Set([
  "localhost",
  "metadata",
  "metadata.google.internal",
  "instance-data",
  "instance-data.ec2.internal",
  "metadata.azure.com",
]);
/** Cloud metadata endpoints that are not in a routable range check by themselves. */
export const BLOCKED_METADATA_ADDRESSES = new Set(["169.254.169.254", "fd00:ec2::254"]);

export interface DestinationOptions {
  /**
   * Local development only (a deployment-level switch, never per
   * organization): allows private and loopback addresses, `http:` and any
   * port, so a fixture server can stand in for a customer API.
   */
  allowPrivateHosts?: boolean;
}

/** `CUSTOM_PROVIDER_ALLOW_PRIVATE_HOSTS=1` (modelled on `SMTP_ALLOW_PRIVATE_HOSTS`). */
export function privateHostsAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CUSTOM_PROVIDER_ALLOW_PRIVATE_HOSTS === "1";
}

export interface ParsedOrigin {
  readonly origin: string;
  readonly hostname: string;
  readonly port: number;
  readonly protocol: "https:" | "http:";
}

function invalid(): never {
  throw new SafeHttpError("blocked_destination");
}

/** The host-name rules of plan 09, 8.1 steps 1 and 2. Throws `blocked_destination` on any violation. */
export function assertAllowedHostname(rawHostname: string, options: DestinationOptions = {}): string {
  const hostname = rawHostname.toLowerCase().replace(/\.$/, "");
  if (options.allowPrivateHosts) return hostname;
  if (hostname === "" || hostname.startsWith("[") || isIP(hostname)) invalid(); // IP literals, including IPv6
  if (!hostname.includes(".")) invalid(); // single-label hosts
  if (BLOCKED_NAMES.has(hostname)) invalid();
  if (BLOCKED_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) invalid();
  // Names that are all digits and dots survived WHATWG normalization as non-IP (for example `1.2.3`): refuse.
  if (/^[0-9.]+$/.test(hostname)) invalid();
  return hostname;
}

/**
 * Parses an HTTPS base origin: WHATWG URL parse (which normalizes decimal,
 * octal and hex IPv4 forms), `https:` only, port 443 only, no userinfo, no
 * path, query or fragment, length-limited, and an allowed host name.
 */
export function parseHttpsOrigin(input: string, options: DestinationOptions = {}): ParsedOrigin {
  if (typeof input !== "string" || input.length === 0 || input.length > MAX_URL_LENGTH) invalid();
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return invalid();
  }
  if (url.username !== "" || url.password !== "") invalid();
  if (!options.allowPrivateHosts) {
    if (url.protocol !== "https:") invalid();
    if (url.port !== "" && url.port !== "443") invalid();
  } else if (url.protocol !== "https:" && url.protocol !== "http:") {
    invalid();
  }
  const hostname = assertAllowedHostname(url.hostname, options);
  const port = url.port === "" ? (url.protocol === "https:" ? 443 : 80) : Number(url.port);
  const defaultPort = url.protocol === "https:" ? 443 : 80;
  const origin = `${url.protocol}//${hostname}${port === defaultPort ? "" : `:${port}`}`;
  return { origin, hostname, port, protocol: url.protocol as "https:" | "http:" };
}

/** A request URL must stay on the base origin: same scheme, host and port, no userinfo, within the length limit. */
export function assertSameOrigin(base: ParsedOrigin, input: string | URL): URL {
  let url: URL;
  try {
    url = typeof input === "string" ? new URL(input) : new URL(input.toString());
  } catch {
    throw new SafeHttpError("invalid_request");
  }
  if (url.toString().length > MAX_URL_LENGTH) throw new SafeHttpError("invalid_request");
  if (url.username !== "" || url.password !== "") throw new SafeHttpError("invalid_request");
  const port = url.port === "" ? (url.protocol === "https:" ? 443 : 80) : Number(url.port);
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (url.protocol !== base.protocol || hostname !== base.hostname || port !== base.port) throw new SafeHttpError("invalid_request");
  if (url.hostname !== hostname) url.hostname = hostname; // normalize a trailing dot so SNI and the certificate check use the bare name
  return url;
}

/**
 * Builds a request URL from the base origin, a path and a query. Each path
 * segment and each query value is URL-encoded, so a variable can never change
 * the scheme, host or port (plan 09, 4.2).
 */
export function buildUrl(base: ParsedOrigin, path: string, query: Record<string, string> = {}): URL {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\") || /[\u0000-\u001f]/.test(path)) {
    throw new SafeHttpError("invalid_request");
  }
  const url = new URL(base.origin);
  const segments = path.split("/").slice(1).map((segment) => {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      throw new SafeHttpError("invalid_request");
    }
    if (decoded === "." || decoded === ".." || decoded.includes("/")) throw new SafeHttpError("invalid_request");
    return encodeURIComponent(decoded);
  });
  url.pathname = `/${segments.join("/")}`;
  for (const [key, value] of Object.entries(query)) url.searchParams.append(key, value);
  return assertSameOrigin(base, url);
}

const FORBIDDEN_HEADERS = new Set(["host", "content-length", "transfer-encoding", "connection", "cookie", "set-cookie", "upgrade", "te", "trailer", "proxy-authorization", "proxy-connection"]);
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

/** Header rules of plan 09, 8.3: no hop-by-hop or routing headers, no `X-Forwarded-*`, no CR/LF. */
export function validateHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (!HEADER_NAME.test(name) || FORBIDDEN_HEADERS.has(lower) || lower.startsWith("x-forwarded-")) {
      throw new SafeHttpError("invalid_request");
    }
    if (typeof value !== "string" || /[\r\n\u0000]/.test(value)) throw new SafeHttpError("invalid_request");
    out[lower] = value;
  }
  return out;
}

/** Query keys that look like credentials; rejected at validation (plan 09, 8.3). */
const CREDENTIAL_QUERY_KEY = /^(key|api[-_]?key|apikey|token|access[-_]?token|secret|password|passwd|auth|authorization|signature|sig|credential|credentials)$/i;
export function isCredentialLookingQueryKey(key: string): boolean {
  return CREDENTIAL_QUERY_KEY.test(key);
}
