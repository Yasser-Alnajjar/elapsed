import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Suites that run against the real Postgres at TEST_DATABASE_URL. Each one
// truncates every table between tests, so two running at once wipe each
// other's data: they get their own project, one file at a time, after the rest.
const realDatabaseSuites = [
  "apps/web/test/tenant-isolation.test.ts",
  "apps/web/test/report-data.test.ts",
  "apps/web/test/anomaly-data.test.ts",
  "apps/web/test/breached-at-data.test.ts",
  "apps/web/test/source-sync-evaluation.test.ts",
  "apps/web/test/official-link-correlation.test.ts",
  "apps/web/test/evaluation-persistence.test.ts",
  "apps/web/test/multi-commitment-pipeline.test.ts",
  "apps/web/test/event-ordering-persistence.test.ts",
  "apps/web/test/zendesk-requester-name.test.ts",
  "apps/web/test/zendesk-ticket-tags.test.ts",
  "apps/web/test/zendesk-sla-condition-fields.test.ts",
  "apps/web/test/commitment-re-resolution.test.ts",
  "apps/web/test/sla-e2e-matrix.test.ts",
  "apps/web/test/next-reply-commitment-persistence.test.ts",
  "apps/web/test/next-reply-cycle-pipeline.test.ts",
  "apps/web/test/next-reply-policy-import-e2e.test.ts",
  "apps/web/test/sla-policy-override-route.test.ts",
  "apps/web/test/organization-lock.test.ts",
  "apps/web/test/live-events.test.ts",
  "apps/web/test/evaluate-pipeline-conditional-write.test.ts",
  "apps/web/test/zendesk-sla-policy-archive.test.ts",
  "apps/web/test/sla-import-summary.test.ts",
  "apps/web/test/zendesk-sla-policy-position.test.ts",
  "apps/web/test/sla-golden-scenarios.test.ts",
  "apps/web/test/zendesk-normalization-scope.test.ts",
  "apps/web/test/jira-normalization-scope.test.ts",
  "apps/web/test/jira-correlation-scope.test.ts",
  "apps/web/test/jira-remote-link-unlink.test.ts",
  "apps/web/test/zendesk-webhook-route.test.ts",
  "apps/web/test/jira-webhook-route.test.ts",
  "apps/web/test/sla-native-policy-routes.test.ts",
  "apps/web/test/zendesk-calendar-import-e18.test.ts",
  "apps/web/test/sla-native-calendar-routes.test.ts",
  "apps/web/test/native-policy-calendar-resolution.test.ts",
  "apps/web/test/invitation-accept-race.test.ts",
  "apps/web/test/password-reset-race.test.ts",
  "apps/web/test/email-verification-race.test.ts",
  "apps/web/test/smoke-signup-to-alert.test.ts",
];

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["packages/*/test/**/*.test.ts", "apps/web/test/**/*.test.ts", "apps/worker/test/**/*.test.ts", "apps/concierge/test/**/*.test.ts"],
          exclude: realDatabaseSuites,
        },
      },
      {
        extends: true,
        test: {
          name: "real-database",
          include: realDatabaseSuites,
          fileParallelism: false,
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
  // apps/web's tsconfig keeps JSX as-is for Next to compile; tests that
  // render a component need it compiled here instead.
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    alias: {
      // Mirrors apps/web/tsconfig.json's "@/*" and "@modules/*" path
      // mappings — needed so tests under apps/web/test can import modules
      // (like proxy.ts, or a component under apps/web/modules) that use the
      // alias internally, without duplicating Next's own webpack/SWC config.
      "@modules": fileURLToPath(new URL("./apps/web/src/modules", import.meta.url)),
      "@": fileURLToPath(new URL("./apps/web/src", import.meta.url)),
    },
  },
});
