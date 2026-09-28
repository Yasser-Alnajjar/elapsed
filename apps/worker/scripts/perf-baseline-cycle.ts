import { getPrismaClient } from "@sla/db";
import { loadWorkerConfig } from "../src/config";
import { runCycle } from "../src/cycle";

async function main() {
  const prisma = getPrismaClient();
  const config = loadWorkerConfig();

  console.log("=== active_set_poll ===");
  const pollResult = await runCycle(
    prisma,
    config,
    "active_set_poll",
    "perf-baseline-poll",
  );
  console.log("cycle result:", pollResult);

  console.log("=== reconciliation_sweep ===");
  const reconcileResult = await runCycle(
    prisma,
    config,
    "reconciliation_sweep",
    "perf-baseline-reconcile",
  );
  console.log("cycle result:", reconcileResult);

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
