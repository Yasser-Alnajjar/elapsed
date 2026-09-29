import { getPrismaClient } from "@sla/db";
import { loadWorkerConfig } from "../src/config";
import { runCycle } from "../src/cycle";

// Set PERF_ORG_ID to measure one organization only (or a comma-separated list
// for a multi-organization tick). Strongly recommended: an unscoped run cycles
// every organization in the database, including any with live
// Zendesk/Jira/Slack credentials (real external side effects).
const organizationIds = process.env.PERF_ORG_ID
  ? process.env.PERF_ORG_ID.split(",").map((id) => id.trim()).filter(Boolean)
  : undefined;

async function main() {
  const prisma = getPrismaClient();
  const config = loadWorkerConfig();

  console.log("=== active_set_poll ===");
  const pollResult = await runCycle(
    prisma,
    config,
    "active_set_poll",
    "perf-baseline-poll",
    { organizationIds },
  );
  console.log("cycle result:", pollResult);

  console.log("=== reconciliation_sweep ===");
  const reconcileResult = await runCycle(
    prisma,
    config,
    "reconciliation_sweep",
    "perf-baseline-reconcile",
    { organizationIds },
  );
  console.log("cycle result:", reconcileResult);

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
