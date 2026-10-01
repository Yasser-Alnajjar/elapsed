/**
 * Phase 1.12 / E-8, E-16: SLA policy import coverage (unsupported
 * conditions/metrics, unresolved schedules, archived policies) and "no
 * matching policy" counts used to be returned or logged and nothing else —
 * never reaching the DB or the UI. `projectAndEvaluateSourceSyncs` (the
 * onboarding/webhook source-sync tail) now persists one `SlaImportSummary`
 * row per organization after each sync via `recordSlaImportSummary`, and
 * `apps/worker`'s cycle does the same (not exercised here — see
 * apps/worker's own suite for the worker path).
 *
 * Real Postgres, like source-sync-evaluation.test.ts. Needs a migrated
 * database at TEST_DATABASE_URL; skipped when unset.
 */
import type { PrismaClient } from "@sla/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sourceIntegration } from "./source-integration";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const at = (time: string) => new Date(`2026-09-17T${time}:00.000Z`);

describe.skipIf(!TEST_DATABASE_URL)("SLA import summary persistence (real Postgres)", () => {
  let prisma: PrismaClient;
  let sourceSync: typeof import("../src/lib/source-sync");

  let organizationId: string;
  let integrationId: string;

  beforeAll(async () => {
    const name = new URL(TEST_DATABASE_URL!).pathname.replace(/^\//, "");
    if (!/test/i.test(name)) {
      throw new Error(`TEST_DATABASE_URL points at database "${name}"; this suite truncates every table.`);
    }
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    prisma = (await import("@sla/db")).getPrismaClient();
    sourceSync = await import("../src/lib/source-sync");
  });

  beforeEach(async () => {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} CASCADE`,
    );

    const organization = await prisma.organization.create({ data: { name: "Import Summary Org" } });
    organizationId = organization.id;
    const integration = await prisma.integration.create({
      data: {
        organizationId,
        provider: "zendesk",
        credentials: { subdomain: "demo" },
        cursor: { backfillCompletedAt: at("00:00").toISOString() },
      },
    });
    integrationId = integration.id;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("has no summary row before any Zendesk sync has run", async () => {
    const summary = await prisma.slaImportSummary.findUnique({ where: { organizationId } });
    expect(summary).toBeNull();
  });

  it("persists import coverage and cases-with-no-matching-policy after a sync, and overwrites on the next one", async () => {
    // A policy with one unsupported filter condition (custom_status_id —
    // Zendesk's custom ticket statuses registry isn't ingested by this
    // importer, see RESOLVED_CONDITION_FIELDS/isResolvedConditionField in
    // packages/zendesk/src/policies.ts), one unsupported metric
    // (agent_work_time) alongside a usable one, matching only "normal"
    // priority — a case opened as "urgent" then has no matching policy at
    // all.
    await prisma.rawEvent.create({
      data: {
        integrationId,
        providerEventId: "sla_policy:1:h1",
        sourceHash: "h1",
        payload: {
          id: 1,
          title: "Normal only",
          filter: {
            all: [
              { field: "priority", operator: "is", value: "normal" },
              { field: "custom_status_id", operator: "is", value: 7 },
            ],
          },
          policy_metrics: [
            { priority: null, metric: "first_reply_time", target: 60, business_hours: true },
            { priority: null, metric: "agent_work_time", target: 30, business_hours: true },
          ],
        },
      },
    });
    await prisma.case.create({
      data: { organizationId, system: "zendesk", sourceIntegrationId: await sourceIntegration(prisma, organizationId, "zendesk"), externalId: "case-1", openedAt: at("09:00"), priority: "urgent" },
    });

    const first = await sourceSync.projectAndEvaluateSourceSyncs(prisma, organizationId);
    expect(first.providers.zendesk?.policyImport?.unsupportedConditions).toBe(1);
    expect(first.providers.zendesk?.policyImport?.unsupportedMetrics).toBe(1);
    expect(first.commitments.casesWithNoMatchingPolicy).toBe(1);

    const summary = await prisma.slaImportSummary.findUniqueOrThrow({ where: { organizationId } });
    expect(summary).toMatchObject({
      unsupportedConditions: 1,
      unsupportedMetrics: 1,
      policiesWithNoUsableTargets: 0,
      policiesWithUnresolvedSchedule: 0,
      policiesArchived: 0,
      casesWithNoMatchingPolicy: 1,
    });

    // The urgent case's priority is fixed, so a second sync (same coverage
    // gaps) overwrites the same row rather than creating a second one.
    await sourceSync.projectAndEvaluateSourceSyncs(prisma, organizationId);
    const rows = await prisma.slaImportSummary.findMany({ where: { organizationId } });
    expect(rows).toHaveLength(1);
  });
});
