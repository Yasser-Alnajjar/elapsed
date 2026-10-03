"use client";

import type { ReactNode } from "react";
import { ShieldCheck, type LucideIcon } from "lucide-react";

import type { ProviderOnboardingStatus } from "@/lib/types/onboarding";
import { IntegrationConfigGate } from "@modules/settings/integrations/csr/IntegrationConfigGate";
import { providerPresentation } from "@modules/settings/integrations/csr/provider-presentation";

import { DESCRIPTION_CLASS } from "./constants";

interface ConnectorHeaderProps {
  icon: LucideIcon;
  name: string;
  badge: string;
  tagline: string;
  /** Not promoted out of Beta yet (D17). */
  beta?: boolean;
}

/** Icon + name + connector badge above a provider's connect form — ported from the mockups' connector card header. */
export function ConnectorHeader({
  icon: Icon,
  name,
  badge,
  tagline,
  beta = false,
}: ConnectorHeaderProps) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-surface-container-highest text-primary">
        <Icon className="size-5 shrink-0" />
      </div>
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="font-headline-md text-headline-md text-on-surface">
            {name}
          </span>
          <span className="font-label-caps text-label-caps rounded bg-primary/10 px-1.5 py-0.5 uppercase text-primary">
            {badge}
          </span>
          {beta && <BetaBadge />}
        </div>
        <span className="font-body-sm text-body-sm text-on-surface-variant">
          {tagline}
        </span>
      </div>
    </div>
  );
}

function BetaBadge() {
  return (
    <span className="font-label-caps text-label-caps rounded bg-secondary-container/40 px-1.5 py-0.5 uppercase text-on-secondary-container">
      Beta
    </span>
  );
}

/**
 * Read-only access banner. The scopes are the ones the provider's authorize
 * URL is built from (via its adapter), never a copy; a provider that takes no
 * scope per request prints where its read-only grant is configured instead.
 */
function ScopeBanner({
  access,
}: {
  access: ProviderOnboardingStatus["access"];
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-surface-container-lowest p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2 text-on-surface-variant">
        <ShieldCheck className="size-[18px] shrink-0 text-tertiary" />
        <span className="font-body-sm text-body-sm">
          {access.scopes.length > 0
            ? "Read-only scopes enforced:"
            : (access.note ?? "Read-only access.")}
        </span>
      </div>
      {access.scopes.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {access.scopes.map((scope) => (
            <span
              key={scope}
              className="font-code-audit text-code-audit rounded bg-surface-container-high px-1.5 py-0.5 text-primary"
            >
              {scope}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** The large elevated surface every primary connector step sits on. */
export function ConnectorCard({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-5 rounded-xl bg-surface-container p-6 shadow-elevated">
      {children}
    </div>
  );
}

interface ProviderCardProps {
  provider: ProviderOnboardingStatus;
  onConfigured?: () => void;
}

/** A compact connect card for a provider that is offered next to the primary one: gated on its OAuth app config like the primary card. */
export function AlternativeConnectorCard({
  provider,
  onConfigured,
}: ProviderCardProps) {
  const {
    icon: Icon,
    tagline,
    beta,
    help,
    readOnlyNote,
    Connect,
  } = providerPresentation(provider.provider);

  return (
    <div className="flex flex-col gap-3 rounded-xl bg-surface-container p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface-container-highest text-primary">
          <Icon className="size-5 shrink-0" />
        </div>
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="font-headline-sm text-headline-sm text-on-surface">
              {provider.label}
            </span>
            {beta && <BetaBadge />}
          </div>
          <span className="font-body-sm text-body-sm text-on-surface-variant">
            {tagline}
          </span>
        </div>
      </div>

      <IntegrationConfigGate
        provider={provider.provider}
        providerLabel={provider.label}
        config={provider.config}
        descriptionClass={DESCRIPTION_CLASS}
        helpUrl={help?.url}
        helpLabel={help?.label}
        onConfigured={onConfigured}
      >
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <p className="font-body-sm text-body-sm text-on-surface-variant">
            {readOnlyNote}
          </p>
          <Connect returnTo="onboarding" />
        </div>
      </IntegrationConfigGate>
    </div>
  );
}

/** The large connect card for a role's primary connector: header, read-only scopes, then the gated connect control. */
export function PrimaryConnectorCard({
  provider,
  description,
  footer,
  onConfigured,
}: ProviderCardProps & { description: string; footer?: ReactNode }) {
  const { icon, tagline, beta, help, Connect } = providerPresentation(
    provider.provider,
  );

  return (
    <ConnectorCard>
      <ConnectorHeader
        icon={icon}
        name={provider.label}
        badge="Primary connector"
        tagline={tagline}
        beta={beta}
      />

      <ScopeBanner access={provider.access} />

      <IntegrationConfigGate
        provider={provider.provider}
        providerLabel={provider.label}
        config={provider.config}
        descriptionClass={DESCRIPTION_CLASS}
        helpUrl={help?.url}
        helpLabel={help?.label}
        onConfigured={onConfigured}
      >
        <p className={DESCRIPTION_CLASS}>{description}</p>

        <div className="mt-4">
          <Connect returnTo="onboarding" />
        </div>
      </IntegrationConfigGate>

      {footer}
    </ConnectorCard>
  );
}
