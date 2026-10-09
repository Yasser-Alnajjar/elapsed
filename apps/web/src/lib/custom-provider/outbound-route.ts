import { NextResponse } from "next/server";
import { DraftNotReadyError, loadReadyDraft, openOutboundSession, type OutboundSession } from "@sla/custom-ticket";
import { failure, ownerGuard, type OwnerContext } from "./route-guard";

/**
 * Shared shell of the routes that call the customer's API (test, sample,
 * preview): the owner gate with its rate limit and single in-flight slot, the
 * draft's configuration and decrypted secrets, a bounded session, and a
 * guaranteed release. A blocked destination or any failure returns a safe
 * classification only, never what the name resolved to or what failed.
 */
export async function withOutboundSession(run: (session: OutboundSession, ctx: OwnerContext) => Promise<unknown>): Promise<NextResponse> {
  const guard = await ownerGuard({ outbound: true });
  if (!guard.ok) return guard.response;
  const { ctx } = guard;
  try {
    const draft = await loadReadyDraft(ctx.prisma, ctx.organizationId);
    const session = openOutboundSession(draft.config, draft.secrets);
    try {
      return NextResponse.json(await run(session, ctx));
    } finally {
      await session.dispose();
    }
  } catch (error) {
    if (error instanceof DraftNotReadyError) return failure(error.code, 409, { missing: error.missing });
    return failure("check_failed", 502);
  } finally {
    ctx.release();
  }
}
