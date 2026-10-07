import type { MetadataRoute } from "next";
import { robotsDisallowRules } from "@/lib/seo/routes";
import { getSiteOrigin } from "@/lib/seo/site";

// The sitemap line needs the public origin, which only exists at request time
// (the Docker image is built with a placeholder NEXTAUTH_URL). A statically
// generated robots.txt would freeze the build-time value.
export const dynamic = "force-dynamic";

/**
 * Public pages are open to every crawler; the signed-in app, the admin area,
 * the API and the emailed-token pages are blocked (`seo-routes.mjs`). A
 * deployment with no public origin (localhost, an IP address, a tunnel or an
 * unset NEXTAUTH_URL) blocks everything and publishes no sitemap.
 */
export default function robots(): MetadataRoute.Robots {
  const origin = getSiteOrigin();

  if (!origin) {
    return { rules: { userAgent: "*", disallow: "/" } };
  }

  return {
    rules: { userAgent: "*", allow: "/", disallow: robotsDisallowRules() },
    sitemap: `${origin}/sitemap.xml`,
  };
}
