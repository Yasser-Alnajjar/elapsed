export const SITE_NAME = "Elapsed";
export const SITE_TAGLINE = "Know before your customer does.";
export const SITE_DESCRIPTION =
  "Elapsed keeps one SLA clock running as customer cases move from your helpdesk to engineering, so you see what's at risk of breaching before it does.";

/**
 * Hostnames (and everything beneath them) that can never be a production
 * public domain: loopback/LAN names, reserved documentation domains, and the
 * dev tunnels this repo's `docker-compose.tunnel.yml` exposes a laptop
 * through. A deployment whose origin is one of these is a dev, staging or
 * unconfigured instance and must stay out of search results.
 */
const NON_PUBLIC_SUFFIXES = [
  "localhost",
  "local",
  "localdomain",
  "internal",
  "lan",
  "home.arpa",
  "test",
  "example",
  "invalid",
  "example.com",
  "example.net",
  "example.org",
  "ngrok.io",
  "ngrok.app",
  "ngrok.dev",
  "ngrok-free.app",
  "ngrok-free.dev",
  "trycloudflare.com",
  "loca.lt",
  "localtunnel.me",
];

const IPV4_HOSTNAME = /^\d{1,3}(?:\.\d{1,3}){3}$/;

function isPublicHostname(hostname: string): boolean {
  // `URL` keeps the brackets on IPv6 literals and normalizes odd IPv4 forms
  // (decimal, hex) to dotted quads, so these two checks cover every IP.
  if (hostname.startsWith("[") || IPV4_HOSTNAME.test(hostname)) return false;
  // A bare label (`web`, `nginx`) is an internal service name, not a domain.
  if (!hostname.includes(".")) return false;
  return !NON_PUBLIC_SUFFIXES.some(
    (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`),
  );
}

/**
 * The public origin (`https://example.org`, no trailing slash) search engines
 * should be pointed at, or `null` when this deployment has none.
 *
 * The origin comes from `NEXTAUTH_URL`, the one variable every deployment
 * already sets to its real public address (see `lib/app-url.ts`). Nothing is
 * guessed: an unset variable, a plain-http origin, an IP address, `localhost`,
 * a tunnel or a placeholder domain all return `null`, so sitemaps, canonical
 * data and structured data are never built from a URL that must not be
 * published, and the callers fall back to "do not index".
 *
 * Read at call time, never at import time: the Docker image is built with a
 * `http://localhost:3000` placeholder and the real value only exists in the
 * running container.
 */
export function resolveSiteOrigin(rawUrl: string | undefined): string | null {
  if (!rawUrl) return null;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  if (url.protocol !== "https:" || !isPublicHostname(url.hostname)) return null;
  return url.origin;
}

export function getSiteOrigin(): string | null {
  return resolveSiteOrigin(process.env.NEXTAUTH_URL);
}

/**
 * The canonical URL of a public page, written exactly as Next renders its
 * `<link rel="canonical">`: the bare origin for the home page, no trailing
 * slash anywhere else. The sitemap uses this so it lists the same string the
 * page declares.
 */
export function canonicalUrl(origin: string, path: string): string {
  return path === "/" ? origin : `${origin}${path}`;
}
