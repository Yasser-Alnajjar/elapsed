/**
 * How a route is treated by search engines. The four classes the SEO audit
 * sorts every route into (`lib/seo/routes.ts` holds the table).
 */
export type RouteClass =
  /** Public page that belongs in the index and the sitemap. */
  | "public-indexable"
  /** Reachable without a session, but kept out of the index. */
  | "public-noindex"
  /** Needs a signed-in session (or a secret token); blocked and noindexed. */
  | "private"
  /** Route handler (`/api/**`): never a page, blocked and noindexed. */
  | "api";

/** A public marketing, legal or docs page and the copy search results show for it. */
export interface PublicPage {
  /** Canonical path: leading slash, no trailing slash (except "/"). */
  path: string;
  /**
   * The page-specific part of the `<title>`. The root layout's template adds
   * " | Elapsed", so the brand is not repeated here.
   */
  title: string;
  /** Meta description, written for the search result snippet (about 120-160 characters). */
  description: string;
  /** Use `title` verbatim, without the " | Elapsed" suffix (the home page). */
  absoluteTitle?: boolean;
}

/** One question/answer pair, shared by the visible FAQ and its FAQPage markup. */
export interface FaqItem {
  question: string;
  answer: string;
}
