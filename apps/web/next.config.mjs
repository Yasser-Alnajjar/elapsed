import { fileURLToPath } from "node:url";
import path from "node:path";
import { withSentryConfig } from "@sentry/nextjs/config";
import { buildNoIndexHeaders } from "./seo-routes.mjs";
import { buildSecurityHeaders } from "./security-headers.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ["192.168.1.46", "192.168.1.49"],
  // Self-contained server bundle for the Docker image (docs/deployment.md) —
  // the tracing root is the monorepo root so workspace packages under
  // packages/* are traced correctly instead of just this app's own tree.
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../../"),
  poweredByHeader: false,
  // N4.1: the operator pages moved to /admin. The old paths redirect for one
  // release so bookmarks keep working, then this block is deleted. Temporary
  // (307) on purpose: nothing should cache a redirect that is about to go.
  async redirects() {
    return [
      { source: "/operator", destination: "/admin", permanent: false },
      { source: "/operator/monitoring", destination: "/admin/monitoring", permanent: false },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: buildSecurityHeaders({
          isDev: process.env.NODE_ENV !== "production",
        }),
      },
      // `X-Robots-Tag: noindex` on the signed-in app, admin, API and token
      // pages (seo-routes.mjs): the one way to mark a JSON response, and a
      // guard that does not depend on each page's own metadata.
      ...buildNoIndexHeaders(),
    ];
  },
};

// Source-map upload (roadmap 7.6) happens only at build time and only when
// SENTRY_AUTH_TOKEN, SENTRY_ORG and SENTRY_PROJECT are all set — the same
// "missing credentials mean skip" convention as SENTRY_DSN. Without them the
// config is exported untouched, so builds without a Sentry project (CI, local
// Docker) behave exactly as before. Debug IDs tie uploaded maps to the
// running bundles, so no release name has to be threaded into the runtime.
const uploadSourceMaps = Boolean(
  process.env.SENTRY_AUTH_TOKEN &&
  process.env.SENTRY_ORG &&
  process.env.SENTRY_PROJECT,
);

export default uploadSourceMaps
  ? withSentryConfig(nextConfig, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      // Self-hosted Sentry: set SENTRY_URL. Unset means sentry.io.
      sentryUrl: process.env.SENTRY_URL || undefined,
      silent: !process.env.CI,
      telemetry: false,
      // Maps are uploaded, then removed from the build output so the
      // standalone image never serves them.
      sourcemaps: { deleteSourcemapsAfterUpload: true },
    })
  : nextConfig;
