/**
 * Error classes every provider adapter shares, so the worker catches three
 * base types instead of one class per provider. Provider packages keep their
 * own class names (Sentry grouping and log event names depend on them) and
 * extend or carry the brand of these.
 */

/**
 * The integration's credentials are invalid, expired or revoked. Callers
 * surface this and never retry; the integration moves to `reauth_required`.
 */
export class ReauthRequiredError extends Error {
  constructor(message = "Integration requires reauthorization") {
    super(message);
    this.name = "ReauthRequiredError";
  }
}

/**
 * Brand carried by every permission-denied error. The provider classes keep
 * extending their own `*ApiError` (callers rely on `instanceof ZendeskApiError`
 * with `status === 403`), and a class can have only one parent, so the shared
 * type is recognised by this brand instead of by inheritance.
 */
export const PERMISSION_DENIED_BRAND: unique symbol = Symbol.for("@sla/ingestion/permission-denied");

/**
 * A 403: the token is valid, but the connecting user can no longer read what
 * was asked for. The fix is restoring that user's access provider-side, not a
 * new OAuth grant. `error instanceof PermissionDeniedError` is true for this
 * class and for any error carrying the brand.
 */
export class PermissionDeniedError extends Error {
  readonly [PERMISSION_DENIED_BRAND] = true as const;

  constructor(message = "Provider denied access") {
    super(message);
    this.name = "PermissionDeniedError";
  }

  static [Symbol.hasInstance](value: unknown): boolean {
    return typeof value === "object" && value !== null && (value as Record<symbol, unknown>)[PERMISSION_DENIED_BRAND] === true;
  }
}

/**
 * The provider could not be reached or answered with a 5xx, a network failure
 * or a timeout. Transient and not the customer's doing; N3 uses it to isolate
 * one provider's outage from the rest of the cycle.
 */
export class ProviderUnavailableError extends Error {
  constructor(message = "Provider is unavailable") {
    super(message);
    this.name = "ProviderUnavailableError";
  }
}

/**
 * The organization has no OAuth app configuration for this provider, so there
 * is nothing the worker can ingest for it. An expected configuration state,
 * not a worker failure: the integration is skipped and the organization
 * carries on with its other integrations. Deliberately narrow: an unreadable
 * config, a missing app URL and every provider error stay real failures.
 */
export class IntegrationNotConfiguredError extends Error {
  constructor(providerLabel: string) {
    super(`${providerLabel} is not configured for this organization`);
    this.name = "IntegrationNotConfiguredError";
  }
}
