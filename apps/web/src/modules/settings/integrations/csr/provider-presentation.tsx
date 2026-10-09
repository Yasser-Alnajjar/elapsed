"use client";

import { Code, Database, Layers, MessageCircle, Plug, Ticket, type LucideIcon } from "lucide-react";
import type { ComponentType } from "react";

import type { IntegrationProvider } from "@/lib/types/integrations";

import { CustomConnectLink } from "./CustomConnectLink";
import { GithubConnectForm } from "./GithubCard";
import { IntercomConnectButton } from "./IntercomCard";
import { JiraConnectButton } from "./JiraCard";
import { LinearConnectButton } from "./LinearCard";
import { ZendeskConnectForm } from "./ZendeskCard";

/**
 * What the guided onboarding flow needs to know about a provider that is not
 * in the adapter registry: wording, an icon and the connect control. The flow
 * itself names no provider (N5.1); it looks one up here, so a provider added
 * to `IntegrationProvider` is a compile error until it has an entry.
 *
 * Whatever the registry already knows (role, capabilities, read-only scopes)
 * arrives in `OnboardingStatus` instead and is never repeated here.
 */
export interface ProviderPresentation {
  icon: LucideIcon;
  /** One line under the provider's name on its connect card. */
  tagline: string;
  /** What this provider's cases are called to a customer: "tickets", "conversations". */
  caseNoun: string;
  /** Not promoted out of Beta yet (D17). */
  beta: boolean;
  /** Where an admin registers the OAuth app the connect button needs. */
  help?: { url: string; label: string };
  /** The read-only promise printed on the connect card. */
  readOnlyNote: string;
  /** The connect control. `returnTo` lands the OAuth callback back in the wizard, for the providers that honour it. */
  Connect: ComponentType<{ returnTo?: "onboarding" }>;
  /** Where "reconnect" goes when a stored token stops working. */
  reconnectHref(connection: { subdomain: string | null }): string;
}

const PRESENTATION: Record<IntegrationProvider, ProviderPresentation> = {
  zendesk: {
    icon: Ticket,
    tagline: "Ticket timestamps, SLA policies, and organizations",
    caseNoun: "tickets",
    beta: false,
    readOnlyNote: "Read-only access: nothing is ever written back to Zendesk.",
    Connect: ZendeskConnectForm,
    reconnectHref: ({ subdomain }) => `/api/integrations/zendesk/connect?subdomain=${encodeURIComponent(subdomain ?? "")}`,
  },
  intercom: {
    icon: MessageCircle,
    tagline: "Conversation timelines and reply deltas",
    caseNoun: "conversations",
    beta: true,
    help: {
      url: "https://developers.intercom.com/docs/build-an-integration/learn-more/authentication/setting-up-oauth",
      label: "Get your Intercom OAuth app credentials",
    },
    readOnlyNote: "Read-only access: no conversations, contacts, or fields are ever written back to Intercom.",
    Connect: IntercomConnectButton,
    reconnectHref: () => "/api/integrations/intercom/connect?returnTo=onboarding",
  },
  jira: {
    icon: Database,
    tagline: "Engineering-leg timing for escalated cases",
    caseNoun: "issues",
    beta: false,
    readOnlyNote: "Read-only access: no issues, comments, or workflows are ever written back to Jira.",
    Connect: JiraConnectButton,
    reconnectHref: () => "/api/integrations/jira/connect",
  },
  linear: {
    icon: Layers,
    tagline: "Engineering-leg timing for escalated cases",
    caseNoun: "issues",
    beta: false,
    help: { url: "https://linear.app/settings/api", label: "Get your Linear OAuth app credentials" },
    readOnlyNote: "Read-only access: no issues, comments, or fields are ever written back to Linear.",
    Connect: LinearConnectButton,
    reconnectHref: () => "/api/integrations/linear/connect",
  },
  github: {
    icon: Code,
    tagline: "Pull request lifecycle",
    caseNoun: "pull requests",
    beta: true,
    help: { url: "/docs/integrations/github#create-github-app", label: "Create your read-only GitHub App" },
    readOnlyNote: "Read-only access: correlated through whichever issue a pull request already references.",
    Connect: GithubConnectForm,
    reconnectHref: () => "/settings/integrations",
  },
  // Not offered in the guided onboarding flow (N9, V1): it has its own wizard, reached from the integrations page.
  custom: {
    icon: Plug,
    tagline: "Any helpdesk with a read-only JSON API",
    caseNoun: "tickets",
    beta: true,
    readOnlyNote: "Read-only access: Elapsed only reads from your API, over HTTPS, and never creates, edits or deletes anything.",
    Connect: CustomConnectLink,
    reconnectHref: () => "/settings/integrations/custom",
  },
};

export const providerPresentation = (provider: IntegrationProvider): ProviderPresentation => PRESENTATION[provider];
