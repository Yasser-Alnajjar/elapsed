import { AlertTriangle } from "lucide-react";
import { AlertDescription } from "@/components/ui/alert";
import { DismissibleAlert } from "@/components/ui/dismissible-alert";

interface ReauthBannerProps {
  /** Display name shown in the banner copy, e.g. "Zendesk", "Jira", "Linear". */
  provider: string;
  /** Where "Reconnect {provider}" sends the user — each provider's own /connect route. */
  reconnectHref: string;
}

/** Generalized across Zendesk/Jira/Linear (roadmap step 17) — was Zendesk-only. */
export function ReauthBanner({ provider, reconnectHref }: ReauthBannerProps) {
  return (
    <DismissibleAlert variant="warning">
      <AlertTriangle />
      <AlertDescription>
        <p>{provider} access has expired and needs to be reconnected before backfill can continue.</p>
        <a href={reconnectHref} className="mt-1 inline-block font-medium underline underline-offset-2">
          Reconnect {provider}
        </a>
      </AlertDescription>
    </DismissibleAlert>
  );
}
