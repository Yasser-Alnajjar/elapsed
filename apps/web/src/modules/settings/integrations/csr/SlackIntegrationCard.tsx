"use client";

import { MessageSquare } from "lucide-react";
import type {
  IntegrationConfigStatus,
  SlackConnectionView,
} from "@/lib/types/integrations";
import { MetaLine } from "./ConnectedCardBody";
import { ConnectPrompt } from "./ConnectPrompt";
import { DisconnectButton } from "./DisconnectButton";
import { IntegrationCardShell } from "./IntegrationCardShell";
import { IntegrationConfigGate } from "./IntegrationConfigGate";
import { StatusIndicator } from "./IntegrationStatus";
import { descriptionClass, formatDateTime } from "./card-format";
import {
  SlackChannelChangeButton,
  SlackChannelPicker,
  SlackConnectButton,
} from "./SlackCard";

/** The alert channel's card: workspace, bound dispatch channel, and channel controls. */
export function SlackIntegrationCard({
  slack,
  config,
  delay,
}: {
  slack: SlackConnectionView;
  config: IntegrationConfigStatus;
  delay: number;
}) {
  return (
    <IntegrationCardShell
      delay={delay}
      icon={<MessageSquare className="size-4" />}
      connected={slack.connected}
      title="Slack"
      subtitle="Real-time at-risk & breach alerts"
      tag="DISPATCH"
      status={
        config.configured &&
        slack.connected && <StatusIndicator tone="success" label="Connected" />
      }
    >
      <IntegrationConfigGate
        provider="slack"
        providerLabel="Slack"
        config={config}
        connected={slack.connected}
        descriptionClass={descriptionClass}
        helpUrl="https://api.slack.com/apps"
        helpLabel="Get your Slack app credentials"
      >
        {slack.connected ? (
          <SlackConnectedBody slack={slack} />
        ) : (
          <ConnectPrompt description="The only alert channel in v1. Posts when a commitment crosses a warning threshold or breaches.">
            <SlackConnectButton />
          </ConnectPrompt>
        )}
      </IntegrationConfigGate>
    </IntegrationCardShell>
  );
}

function SlackConnectedBody({ slack }: { slack: SlackConnectionView }) {
  return (
    <div className="flex flex-1 flex-col gap-4">
      <MetaLine>
        <span className="text-on-surface-variant">Workspace:</span>
        <span className="bg-surface-container border-outline-variant/30 text-on-surface rounded border px-1.5 py-0.5 font-mono text-xxs font-medium">
          {slack.teamName}
        </span>
        <span className="text-outline font-mono text-xxs">
          ({formatDateTime(slack.installedAt!)})
        </span>
      </MetaLine>

      <div className="bg-surface-container border-outline-variant/20 flex flex-col gap-2 rounded-lg border p-4">
        <div className="text-outline border-outline-variant/20 flex items-center justify-between border-b pb-1.5 font-mono text-xxs">
          <span className="uppercase tracking-wider">Dispatch destinations</span>
          <span className="text-success font-semibold">
            {slack.channelId ? "1 BOUND" : "0 BOUND"}
          </span>
        </div>
        {slack.channelId && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            <span className="bg-surface-container-lowest text-outline border-outline-variant/30 flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-xxs">
              <span className="text-outline">#</span>
              {slack.channelName}
              <span className="bg-success ms-1 size-1.5 rounded-full" />
            </span>
          </div>
        )}
        <p className="text-on-surface-variant line-clamp-2 text-xs">
          Critical SLA runway warnings under 4h are routed with high-priority
          countdown thread cards.
        </p>
      </div>

      <div className="border-outline-variant/20 mt-auto flex flex-wrap items-center justify-between gap-2 border-t pt-2">
        <DisconnectButton provider="slack" providerLabel="Slack" />
        {slack.channelId ? <SlackChannelChangeButton /> : <SlackChannelPicker />}
      </div>
    </div>
  );
}
