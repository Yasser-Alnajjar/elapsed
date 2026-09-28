/**
 * Runs each Phase 0 page loader once against a seeded organization with
 * `PERF_METRICS=1` and prints the `perf_scope` counters
 * (implementation-plans/performance-plan.md). Re-run after each phase to
 * compare against the recorded baseline in ROADMAP_Product.md 7.7.
 *
 * `getCaseListData` imports the `server-only` guard, which throws
 * unconditionally outside a Next.js server-component build — registering
 * `server-only-loader.mjs` before dynamically importing the loaders gives it
 * a no-op stand-in for this one script, the same way Next's own webpack
 * alias does for a real request.
 *
 * Usage: `pnpm --filter @sla/web perf:baseline [organizationId]`.
 */
import { register } from "node:module";
import { getPrismaClient } from "@sla/db";

register("./server-only-loader.mjs", import.meta.url);

const ORG_ID = process.argv[2] ?? "cmugf49bx0000ryryapk5xg7w";

async function main() {
  const prisma = getPrismaClient();
  const { getDashboardData } = await import("../src/lib/dashboard-data");
  const { getCaseListData } = await import("../src/lib/case-list-data");
  const { getCaseDetailData } = await import("../src/lib/case-detail-data");
  const { getAtRiskData } = await import("../src/lib/at-risk-data");

  console.log("=== /dashboard ===");
  const t0 = performance.now();
  await getDashboardData(prisma, ORG_ID);
  console.log("wall ms:", Math.round(performance.now() - t0));

  console.log("=== /cases ===");
  const t1 = performance.now();
  await getCaseListData(prisma, ORG_ID);
  console.log("wall ms:", Math.round(performance.now() - t1));

  console.log("=== /at-risk ===");
  const t2 = performance.now();
  await getAtRiskData(prisma, ORG_ID);
  console.log("wall ms:", Math.round(performance.now() - t2));

  const someCase = await prisma.case.findFirst({
    where: {
      organizationId: ORG_ID,
      deletedAt: null,
      commitments: { some: { closedAt: null } },
    },
    select: { id: true },
  });
  console.log("=== /cases/[id] ===");
  const t3 = performance.now();
  await getCaseDetailData(prisma, ORG_ID, someCase!.id);
  console.log("wall ms:", Math.round(performance.now() - t3));

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
