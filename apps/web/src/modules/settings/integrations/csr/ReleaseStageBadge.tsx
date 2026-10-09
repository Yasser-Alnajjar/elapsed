import { Badge } from "@/components/ui/badge";
import type { ProviderAvailabilityView } from "@/lib/types/integrations";

/** The provider's release stage, from its persisted availability (D33; was a per-provider constant): nothing for Stable. */
export function ReleaseStageBadge({ stage }: { stage: ProviderAvailabilityView["releaseStage"] }) {
  if (stage === "beta") return <Badge variant="beta">Beta</Badge>;
  if (stage === "coming_soon") return <Badge variant="outline">Coming soon</Badge>;
  return null;
}
