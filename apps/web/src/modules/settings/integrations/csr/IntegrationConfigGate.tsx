"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type {
  ConfigurableIntegrationProvider,
  IntegrationConfigStatus,
} from "@/lib/types/integrations";
import { IntegrationConfigForm } from "./IntegrationConfigForm";

interface IntegrationConfigGateProps {
  provider: ConfigurableIntegrationProvider;
  providerLabel: string;
  config: IntegrationConfigStatus;
  descriptionClass: string;
  /** Rendered instead of the config form once `config.configured` is true — the existing connect/connected UI for this provider. */
  children: ReactNode;
  /** Optional link to where an admin registers this provider's OAuth app and gets a client id/secret — shown in the unconfigured state, before "Configure" is clicked. */
  helpUrl?: string;
  helpLabel?: string;
  /**
   * Called after the config form saves successfully, in addition to
   * `router.refresh()`. Callers that hold their own client-side copy of
   * server data (e.g. onboarding's `useOnboardingBackfill`) need this since
   * `router.refresh()` alone re-renders the server tree but won't update
   * state a child already initialized from its previous props.
   */
  onConfigured?: () => void;
}

/**
 * Gates a provider card's body on whether its OAuth app has been configured
 * yet. Unconfigured: shows a "Configure" button instead of `children`
 * (existing connect/connected UI never renders, since there's nothing to
 * connect with) — the client id/secret inputs themselves only appear once
 * that button is clicked, not up front. Configured: renders `children`
 * as-is, plus a small affordance to edit the saved configuration later —
 * the client secret is only ever write-only, so editing reuses the same
 * form with the client id prefilled.
 */
export function IntegrationConfigGate({
  provider,
  providerLabel,
  config,
  descriptionClass,
  children,
  helpUrl,
  helpLabel,
  onConfigured,
}: IntegrationConfigGateProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);

  const handleSaved = () => {
    router.refresh();
    onConfigured?.();
  };

  if (!config.configured) {
    return (
      <div className="flex flex-1 flex-col gap-3">
        <p className={descriptionClass}>
          Register {providerLabel}&apos;s OAuth app to enable connecting.
        </p>
        {helpUrl && (
          <a
            href={helpUrl}
            target="_blank"
            rel="noreferrer"
            className="self-start text-xs text-primary underline-offset-2 hover:underline"
          >
            {helpLabel ?? "Get your client ID and secret"}
          </a>
        )}
        <IntegrationConfigForm
          provider={provider}
          providerLabel={providerLabel}
          onSaved={handleSaved}
        />
      </div>
    );
  }

  if (editing) {
    return (
      <div className="flex flex-1 flex-col">
        <IntegrationConfigForm
          provider={provider}
          providerLabel={providerLabel}
          initialClientId={config.clientId}
          onSaved={() => {
            setEditing(false);
            handleSaved();
          }}
          onCancel={() => setEditing(false)}
        />
      </div>
    );
  }

  return (
    <>
      {children}
      <Button
        type="button"
        variant="link"
        onClick={() => setEditing(true)}
        className="mt-3 h-auto self-start p-0 text-xs font-normal text-on-surface-variant underline-offset-2 hover:text-foreground hover:underline"
      >
        Edit configuration
      </Button>
    </>
  );
}
