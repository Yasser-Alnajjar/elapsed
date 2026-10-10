import { NextResponse } from "next/server";
import {
  getPrismaClient,
  resolveIntegrationAvailability,
  type IntegrationAvailabilityDecision,
  type IntegrationProvider,
} from "@sla/db";

/**
 * The web side of platform integration availability (D33, plan 10 §5.2).
 * Every route that can connect a provider, complete or start its OAuth, write
 * its OAuth app configuration, import from it, accept its webhooks or call its
 * API asks here first, after its own authentication and before any provider
 * call or write. The answer is read from the database on every call (no cache),
 * so an operator's change applies to the next request on every instance.
 *
 * `integration-availability-boundary.test.ts` (on `testing`) fails for a
 * provider route that does not call one of these helpers.
 */

type Unavailable = Extract<IntegrationAvailabilityDecision, { available: false }>;

export function availabilityCheck(organizationId: string, provider: IntegrationProvider): Promise<IntegrationAvailabilityDecision> {
  return resolveIntegrationAvailability(getPrismaClient(), organizationId, provider);
}

/** The documented API refusal: 403 `{ error, code, provider, statusMessage }`. */
export function unavailableResponse(decision: Unavailable): NextResponse {
  return NextResponse.json(
    { error: decision.message, code: decision.code, provider: decision.provider, statusMessage: decision.statusMessage },
    { status: 403 },
  );
}

/** For JSON routes: null when the provider is available, else the 403 refusal. */
export async function requireIntegrationAvailable(organizationId: string, provider: IntegrationProvider): Promise<NextResponse | null> {
  const decision = await availabilityCheck(organizationId, provider);
  return decision.available ? null : unavailableResponse(decision);
}

/** Where a browser flow lands when the provider is unavailable; the integrations page explains it. */
export function availabilityRedirectPath(provider: IntegrationProvider, code: Unavailable["code"]): string {
  return `/settings/integrations?availability=${code}&provider=${provider}`;
}

/**
 * For browser (OAuth) GET routes: null when the provider is available, else a
 * redirect to the integrations page with the reason. `base` is the URL the
 * route already resolves its redirects against.
 */
export async function requireIntegrationAvailableOrRedirect(
  organizationId: string,
  provider: IntegrationProvider,
  base: string | URL,
): Promise<NextResponse | null> {
  const decision = await availabilityCheck(organizationId, provider);
  return decision.available ? null : NextResponse.redirect(new URL(availabilityRedirectPath(provider, decision.code), base));
}

/**
 * For webhook receivers (D33 ruling 5): an unavailable provider's delivery is
 * acknowledged with HTTP 200 and ignored, so the sender does not retry or
 * disable the webhook. Nothing is stored; the next poll after re-enablement
 * fetches the change from the stored cursor.
 */
export async function ignoreWebhookIfUnavailable(organizationId: string, provider: IntegrationProvider): Promise<NextResponse | null> {
  const decision = await availabilityCheck(organizationId, provider);
  return decision.available ? null : NextResponse.json({ status: "ignored", reason: decision.code });
}
