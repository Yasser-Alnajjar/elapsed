import { Ban, PauseCircle } from "lucide-react";
import { CATALOG_PROVIDERS, isIntegrationUnavailableCode, unavailableMessage } from "@sla/db/availability";
import { AlertDescription } from "@/components/ui/alert";
import { DismissibleAlert } from "@/components/ui/dismissible-alert";
import type { IntegrationProvider, ProviderAvailabilityView } from "@/lib/types/integrations";

/**
 * A connected integration whose provider Elapsed has made unavailable (D33):
 * "Paused by Elapsed", never "Disconnected". Nothing is deleted, and syncing
 * resumes from where it stopped when the provider is available again.
 */
export function PausedByElapsedBanner({ providerLabel, availability }: { providerLabel: string; availability: ProviderAvailabilityView }) {
  return (
    <DismissibleAlert variant="warning" data-testid="paused-by-elapsed">
      <PauseCircle />
      <AlertDescription>
        <p>
          <span className="font-semibold">Paused by Elapsed.</span> {availability.message}
          {availability.statusMessage ? ` ${availability.statusMessage}` : ""}
        </p>
        <p className="mt-1">
          Your connection, cases and history are kept and stay visible. No new {providerLabel} data arrives until it is available again, then syncing catches up
          automatically. You don&apos;t need to do anything.
        </p>
      </AlertDescription>
    </DismissibleAlert>
  );
}

/**
 * Shown on the integrations page after a connect or OAuth flow was refused
 * because the provider is unavailable (`?availability=<code>&provider=<provider>`).
 * Only known codes and providers are named; anything else renders nothing.
 */
export function IntegrationUnavailableNotice({ code, provider }: { code?: string; provider?: string }) {
  if (!isIntegrationUnavailableCode(code) || !provider || !(CATALOG_PROVIDERS as string[]).includes(provider)) return null;
  return (
    <DismissibleAlert variant="warning" className="mb-4" data-testid="integration-unavailable">
      <Ban />
      <AlertDescription>
        <p>{unavailableMessage(provider as IntegrationProvider, code)} Nothing was changed.</p>
      </AlertDescription>
    </DismissibleAlert>
  );
}
