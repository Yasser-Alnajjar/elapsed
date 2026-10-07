import type { MetadataRoute } from "next";
import { PUBLIC_PAGES } from "@/lib/seo/pages";
import { canonicalUrl, getSiteOrigin } from "@/lib/seo/site";

// Same reason as robots.ts: the origin is a runtime value.
export const dynamic = "force-dynamic";

/**
 * Exactly the registry of public, indexable, English pages, each at the URL
 * its own `<link rel="canonical">` names. No `lastModified`, `changeFrequency`
 * or `priority`: nothing tracks real modification dates, and search engines
 * ignore the other two. Empty without a public origin.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const origin = getSiteOrigin();
  if (!origin) return [];
  return PUBLIC_PAGES.map((page) => ({ url: canonicalUrl(origin, page.path) }));
}
