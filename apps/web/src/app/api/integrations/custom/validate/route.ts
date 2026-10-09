import { NextResponse } from "next/server";
import { getDraft, parseConfig, storedSlaSupport, validateConfig } from "@sla/custom-ticket";
import { assessActivationImpact } from "@sla/commitments";
import { privateHostsAllowed } from "@sla/safe-http";
import { failure, ownerGuard } from "@/lib/custom-provider/route-guard";

/**
 * Validates the draft without calling the customer's API: structure, semantic
 * rules, the per-metric SLA verdicts (supported, supported with limitations,
 * unsupported, with reasons) and what activating it would do to commitments
 * that already exist. The full-listing check for a source with no incremental
 * cursor runs inside activation, where its numbers are returned if it refuses.
 */
export async function POST() {
  const guard = await ownerGuard();
  if (!guard.ok) return guard.response;
  const { prisma, organizationId } = guard.ctx;
  const draft = await getDraft(prisma, organizationId);
  if (!draft) return failure("no_draft", 409);
  const parsed = parseConfig(draft.config);
  if (!parsed.ok) return NextResponse.json({ ok: false, issues: parsed.issues, diagnostics: [] });
  const report = validateConfig(parsed.config, { allowPrivateHosts: privateHostsAllowed() });
  const existing = await prisma.integration.findUnique({
    where: { organizationId_provider: { organizationId, provider: "custom" } },
    select: { id: true, slaSupport: true },
  });
  const impact = await assessActivationImpact(prisma, {
    organizationId,
    integrationId: existing?.id ?? null,
    current: existing?.slaSupport ?? null,
    target: storedSlaSupport(report),
  });
  return NextResponse.json({
    ok: report.ok,
    issues: [],
    diagnostics: report.diagnostics,
    support: report.support,
    limitations: report.stored.limitations,
    requiredSecrets: report.requiredSecrets,
    secretsSet: draft.secretsSet,
    impact,
  });
}
