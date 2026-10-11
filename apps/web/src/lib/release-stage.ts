import type { ProviderAvailabilityView } from "@/lib/types/integrations";

/**
 * The lifecycle stage of an integration, as persisted in `IntegrationAvailability`
 * (D33) and edited in `/admin/integrations`. This file holds only the wording
 * for each stage; where a stage comes from is `release-stage-data.ts` (public
 * pages) and `integrations-data.ts` (signed-in pages), both of which read the
 * same persisted policy.
 *
 * A stage is not a connection status and not sync health: Stable does not mean
 * a connection is healthy or that it will never fail.
 */
export type ReleaseStage = ProviderAvailabilityView["releaseStage"];

export const RELEASE_STAGE_LABELS: Record<ReleaseStage, string> = {
  stable: "Stable",
  beta: "Beta",
  coming_soon: "Coming soon",
};

/**
 * A sentence for the top of an integration's page, or null when the stage
 * needs no warning (Stable). Pages that have a "Known limitations" section
 * link to it.
 */
export function releaseStageSentence(stage: ReleaseStage): string | null {
  switch (stage) {
    case "beta":
      return "This integration is in Beta, an early-release stage: it may have limitations or behave unexpectedly.";
    case "coming_soon":
      return "This integration is coming soon and can't be connected yet.";
    case "stable":
      return null;
  }
}

/** Appended to a page's search description; empty for Stable. */
export function releaseStageSeoSuffix(stage: ReleaseStage): string {
  switch (stage) {
    case "beta":
      return " Currently in Beta.";
    case "coming_soon":
      return " Coming soon.";
    case "stable":
      return "";
  }
}
