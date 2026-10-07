import type { RouteClass } from "@/lib/types/seo";
import { NOINDEX_PATH_PREFIXES } from "../../../seo-routes.mjs";
import { PUBLIC_PAGES } from "./pages";

/**
 * Pages anyone can open without a session that still stay out of the index.
 *
 * - The sign-in, sign-up and forgot-password forms: duplicate-looking thin
 *   pages (and `/sign-in?callbackUrl=...` is what every private URL redirects
 *   to). Crawlable on purpose so the `noindex` tag is seen.
 * - The reset-password, verify-email and invite pages: reached only from an
 *   emailed link with a secret in the query string, so they are also blocked
 *   in robots.txt (they are in `NOINDEX_PATH_PREFIXES` too).
 * - `/docs/deployment`: the self-hosting guide. It prints this deployment's
 *   own address, is not linked from the docs navigation, and is not part of
 *   the product documentation customers search for.
 */
export const PUBLIC_NOINDEX_PREFIXES = [
  "/sign-in",
  "/sign-up",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/invite",
  "/docs/deployment",
] as const;

function isUnder(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * The SEO class of a URL path, or `null` when nothing classifies it (the
 * route-tree test fails on that, so a new route can't ship unclassified).
 *
 * Order matters: the token pages (`/reset-password`, ...) are reachable
 * without a session, so they classify as public even though robots.txt also
 * blocks them.
 */
export function classifyPath(path: string): RouteClass | null {
  if (isUnder(path, "/api")) return "api";
  if (PUBLIC_PAGES.some((page) => page.path === path)) return "public-indexable";
  if (PUBLIC_NOINDEX_PREFIXES.some((prefix) => isUnder(path, prefix))) {
    return "public-noindex";
  }
  if (NOINDEX_PATH_PREFIXES.some((prefix) => isUnder(path, prefix))) {
    return "private";
  }
  return null;
}

/**
 * The robots.txt `Disallow` lines. Each prefix is written twice, `/cases/` and
 * `/cases$`, so `/cases` and everything under it is blocked but a future
 * public page such as `/cases-studies` is not swallowed by a bare `/cases`.
 * Nothing under `/_next/` is listed: the CSS and JavaScript crawlers need to
 * render a page must stay fetchable.
 */
export function robotsDisallowRules(): string[] {
  return NOINDEX_PATH_PREFIXES.flatMap((prefix) => [`${prefix}/`, `${prefix}$`]);
}
