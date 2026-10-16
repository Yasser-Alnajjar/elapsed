/**
 * Response security headers applied to every route via `next.config.mjs`'s
 * `headers()` (roadmap step 33). Plain `.mjs` rather than under `src/` so
 * the Next config can import it directly and vitest can test it as-is.
 *
 * CSP trade-off, deliberate: `script-src` keeps `'unsafe-inline'`. The App
 * Router streams its RSC payload through inline `<script>` tags and
 * `next-themes` injects an inline no-flash script, so a strict CSP would
 * need a per-request nonce — which forces every page (including the static
 * docs/marketing pages) into dynamic rendering. What this policy does
 * enforce is still meaningful: no scripts/styles/connections to any other
 * origin, no plugins (`object-src`), no `<base>` hijacking, forms can only
 * post back to this app, and the app can't be framed (clickjacking).
 *
 * @param {{ isDev: boolean }} options
 * @returns {{ key: string; value: string }[]}
 */
export function buildSecurityHeaders({ isDev }) {
  const csp = [
    "default-src 'self'",
    // React's dev build relies on eval for its debugging features; never in production.
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    // next/font self-hosts Inter/Fraunces under /_next/static, so no Google Fonts origin is needed.
    "font-src 'self' data:",
    // Dev: the HMR websocket.
    `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");

  const headers = [
    { key: "Content-Security-Policy", value: csp },
    // Legacy equivalent of frame-ancestors 'none' for browsers that predate CSP2.
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=()",
    },
  ];

  // Browsers ignore HSTS over plain http anyway, but sending it from
  // `next dev` on a LAN IP/ngrok tunnel would pin those hosts to https for
  // two years in the developer's browser. TLS terminates at the reverse
  // proxy in production (docs/deployment.md), where this header takes effect.
  if (!isDev) {
    headers.push({
      key: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains",
    });
  }

  return headers;
}
