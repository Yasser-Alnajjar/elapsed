/**
 * H-11 dev replay (never run against production): full re-normalization of the
 * Zendesk integration, repair of first-response commitments whose start
 * disagrees with the rule, then the commitment + evaluation pipelines.
 * Deliberately does NOT run the notification pipeline (no alerts are sent).
 * Usage: dotenv -e ../../.env -- tsx h4/apply-h11-dev.mts <organizationId> [--apply]
 */
import { getPrismaClient } from "../src/index";
import { runZendeskNormalization } from "../../zendesk/src/normalize";
import { runCommitmentPipeline, runEvaluationPipeline } from "../../commitments/src/index";
import { repairFirstResponseStart } from "../../commitments/src/scripts/repair-first-response-start";

const [organizationId] = process.argv.slice(2);
const apply = process.argv.includes("--apply");
const prisma = getPrismaClient();
const integration = await prisma.integration.findFirstOrThrow({ where: { organizationId, provider: "zendesk" } });

console.log("normalization:", JSON.stringify(await runZendeskNormalization(prisma, integration.id)));
const repaired = await repairFirstResponseStart(prisma, { organizationId, apply });
console.log(apply ? "repair (applied):" : "repair (dry run):", JSON.stringify(repaired, null, 1));
if (apply) {
  console.log("commitment pipeline:", JSON.stringify(await runCommitmentPipeline(prisma, organizationId)));
  const asOf = new Date().toISOString();
  console.log("evaluation pipeline:", JSON.stringify(await runEvaluationPipeline(prisma, organizationId, { asOf, scope: "all" })).slice(0, 400));
}
await prisma.$disconnect();
