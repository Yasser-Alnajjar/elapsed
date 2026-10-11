import { NextResponse } from "next/server";
import { getDraft, parseConfig } from "@sla/custom-ticket";
import { computeConfigDiff } from "@/lib/custom-provider/config-diff";
import { failure, ownerGuard } from "@/lib/custom-provider/route-guard";

export const maxDuration = 150;

/**
 * The dry-run diff of plan 09, 6.8 (N9.12-F1): which stored cases and events
 * the draft would change if it were activated, derived from the snapshots
 * already stored and never from the customer's API. Owner only. It makes no
 * outbound request but re-derives the whole stored set, so it takes the same
 * per-organization rate limit and single slot as the outbound checks. Writes
 * nothing and activates nothing.
 */
export async function POST() {
  const guard = await ownerGuard({ outbound: true });
  if (!guard.ok) return guard.response;
  const { prisma, organizationId } = guard.ctx;
  try {
    const draft = await getDraft(prisma, organizationId);
    if (!draft) return failure("no_draft", 409);
    const parsed = parseConfig(draft.config);
    if (!parsed.ok) return NextResponse.json({ error: "invalid", code: "invalid", issues: parsed.issues }, { status: 422 });
    return NextResponse.json(await computeConfigDiff(prisma, organizationId, parsed.config));
  } finally {
    guard.ctx.release();
  }
}
