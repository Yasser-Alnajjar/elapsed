/**
 * Route prefixes that must never appear in a search index: the signed-in app,
 * the platform-admin area, every API route (OAuth callbacks and webhooks
 * included) and the token-in-the-URL pages (password reset, email
 * verification, invitations, connect links).
 *
 * One list, three consumers: `next.config.mjs` turns it into `X-Robots-Tag`
 * response headers (the only way to mark a JSON response, and a guard a page
 * can't forget to opt into), `src/app/robots.ts` turns it into `Disallow`
 * rules, and the SEO tests check that no public page falls under a prefix.
 * Plain `.mjs` for the same reason as `security-headers.mjs`: the Next config
 * can import it directly and vitest can test it as-is.
 *
 * `/sign-in`, `/sign-up` and `/forgot-password` are deliberately NOT listed.
 * They are linked from every public page, so they stay crawlable and carry a
 * `noindex` meta tag instead: a crawler blocked by robots.txt never sees the
 * tag, and a blocked URL that is linked from elsewhere can still be indexed
 * as a bare URL.
 *
 * @type {readonly string[]}
 */
export const NOINDEX_PATH_PREFIXES = [
  "/api",
  "/admin",
  "/operator",
  "/dashboard",
  "/cases",
  "/at-risk",
  "/billing",
  "/settings",
  "/internal",
  "/onboarding",
  "/connect",
  "/invite",
  "/reset-password",
  "/verify-email",
];

/**
 * `headers()` entries for `next.config.mjs`: `X-Robots-Tag` on every
 * non-indexable prefix. Each prefix needs two sources because `:path*` only
 * matches below the prefix, not the bare path (`/dashboard` itself).
 *
 * @returns {{ source: string; headers: { key: string; value: string }[] }[]}
 */
export function buildNoIndexHeaders() {
  return NOINDEX_PATH_PREFIXES.flatMap((prefix) =>
    [prefix, `${prefix}/:path*`].map((source) => ({
      source,
      headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
    })),
  );
}
