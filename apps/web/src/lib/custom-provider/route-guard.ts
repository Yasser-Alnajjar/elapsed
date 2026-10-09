import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { getPrismaClient, type PrismaClient } from "@sla/db";
import { authOptions } from "@/lib/auth";
import { requireOwner } from "@/lib/authz";
import { availabilityCheck, unavailableResponse } from "@/lib/integration-availability";
import { checkRateLimit } from "@/lib/rate-limit";

export interface OwnerContext {
  prisma: PrismaClient;
  organizationId: string;
  userId: string;
  /** Release the per-organization outbound slot. A no-op for routes that make no outbound request. */
  release(): void;
}

export type GuardResult = { ok: true; ctx: OwnerContext } | { ok: false; response: NextResponse };

const inFlight = new Set<string>();
const OUTBOUND_LIMIT = 12;
const OUTBOUND_WINDOW_MS = 60_000;

/**
 * The gate every Custom REST route passes (plan 09, 8.5, 8.7): a signed-in
 * organization OWNER (never a member), the organization taken from the session
 * and never from input, and platform availability (D33: the provider enabled
 * and this organization on its Beta allowlist, which replaced the operator's
 * Beta flag), checked server-side on every call. Only `status` and
 * `disconnect`, which make no outbound request, pass
 * `requireAvailable: false`: a customer can always see and disconnect a
 * paused source. The same-origin check for state-changing requests is applied by
 * `proxy.ts` for every `/api` route. Routes that make an outbound request also
 * take a per-organization rate limit and a single in-flight slot, so the
 * endpoint cannot be used as a scanner or a resolver; the caller must call
 * `release()` when done.
 */
export async function ownerGuard(options: { outbound?: boolean; requireAvailable?: boolean } = {}): Promise<GuardResult> {
  const session = await getServerSession(authOptions);
  if (!session) return { ok: false, response: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };
  const denied = requireOwner(session);
  if (denied) return { ok: false, response: denied };

  const prisma = getPrismaClient();
  const organizationId = session.user.organizationId;
  if (options.requireAvailable !== false) {
    const availability = await availabilityCheck(organizationId, "custom");
    if (!availability.available) return { ok: false, response: unavailableResponse(availability) };
  }

  let release = () => {};
  if (options.outbound) {
    const limited = checkRateLimit(`custom-outbound:${organizationId}`, OUTBOUND_LIMIT, OUTBOUND_WINDOW_MS);
    if (!limited.allowed) {
      return {
        ok: false,
        response: NextResponse.json({ error: "Too many requests. Try again shortly.", code: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds ?? 60) } }),
      };
    }
    if (inFlight.has(organizationId)) {
      return { ok: false, response: NextResponse.json({ error: "Another check is already running", code: "busy" }, { status: 429 }) };
    }
    inFlight.add(organizationId);
    release = () => void inFlight.delete(organizationId);
  }
  return { ok: true, ctx: { prisma, organizationId, userId: session.user.id, release } };
}

/** Maps a thrown error to a response that carries a fixed code and never the error's message. */
export function failure(code: string, status: number, extra: Record<string, unknown> = {}): NextResponse {
  return NextResponse.json({ error: code, code, ...extra }, { status });
}

export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  const body = await request.json().catch(() => null);
  return body !== null && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}
