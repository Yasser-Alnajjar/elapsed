import type { ComponentType, ReactNode } from "react";
import {
  Bolt,
  GitBranch,
  GitPullRequest,
  LifeBuoy,
  Ticket,
  TriangleAlert,
  Workflow,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { IntegrationProvider } from "@/lib/types/integrations";
import type { PulsePanelProps } from "./ConnectedCardBody";
import { GithubConnectForm } from "./GithubCard";
import { IntercomConnectButton } from "./IntercomCard";
import { JiraConnectButton } from "./JiraCard";
import { LinearConnectButton } from "./LinearCard";
import { ZendeskConnectForm } from "./ZendeskCard";

/** Everything that differs between the source-provider cards on the integrations page. */
export interface SourceIntegrationSpec {
  provider: IntegrationProvider;
  label: string;
  subtitle: string;
  tag: string;
  icon: ReactNode;
  badge?: ReactNode;
  /** Where an admin registers this provider's OAuth app. */
  help: { url: string; label: string };
  /** The read-only promise shown before connecting. */
  connectDescription: string;
  Connect: ComponentType;
  /** The workspace address chip on the connected card. */
  address: (subdomain: string | null) => string;
  /** The fact after the address chip (auth method, project count). */
  detail: { text: string; className: string };
  pulse: PulsePanelProps;
}

const oauthDetail = {
  text: "OAuth v2.0",
  className: "font-mono text-xxs uppercase",
};

const healthy = {
  health: "HEALTHY",
  healthTone: "success",
  healthIcon: <Bolt className="size-3.5" />,
} as const;

export const SOURCE_INTEGRATION_SPECS: SourceIntegrationSpec[] = [
  {
    provider: "zendesk",
    label: "Zendesk",
    subtitle: "Primary helpdesk event stream",
    tag: "TICKETS",
    icon: <Ticket className="size-4" />,
    help: {
      url: "https://support.zendesk.com/hc/en-us/articles/4408845965210-Using-OAuth-authentication-with-your-application",
      label: "Get your Zendesk OAuth app credentials",
    },
    connectDescription:
      "Read-only access — no tickets, comments, or fields are ever written back to Zendesk.",
    Connect: ZendeskConnectForm,
    address: (subdomain) => `${subdomain ?? "dataship"}.zendesk.com`,
    detail: oauthDetail,
    pulse: {
      title: "Ingress runway pulse",
      ...healthy,
      stats: [
        { label: "Last webhook", value: "4s ago", hint: "0x7f4c9a81" },
        {
          label: "Sync lag",
          value: "120ms",
          hint: "p99 < 210ms",
          tone: "success",
        },
        {
          label: "Daily events",
          value: "14,280",
          hint: "+12.4% avg",
          tone: "primary",
        },
      ],
    },
  },
  {
    provider: "jira",
    label: "Jira",
    subtitle: "Issue lifecycle & handoff",
    tag: "ENGINEERING",
    icon: <GitBranch className="size-4" />,
    help: {
      url: "https://developer.atlassian.com/console/myapps/",
      label: "Get your Jira OAuth app credentials",
    },
    connectDescription:
      "Read-only access — no issues, comments, or fields are ever written back to Jira.",
    Connect: JiraConnectButton,
    address: (subdomain) => `${subdomain ?? "dataship"}.atlassian.net`,
    detail: {
      text: "12 projects",
      className: "text-on-surface font-mono text-xxs",
    },
    pulse: {
      title: "Transit reconciliation",
      health: "14 LIMBO DETECTED",
      healthTone: "warning",
      healthIcon: <TriangleAlert className="size-3.5" />,
      stats: [
        { label: "Last poll", value: "28s ago", hint: "Changelog" },
        {
          label: "Limbo issues",
          value: "14 active",
          hint: "Unassigned",
          tone: "warning",
        },
        {
          label: "Webhook status",
          value: "Healthy",
          hint: "RFC-822",
          tone: "success",
        },
      ],
    },
  },
  {
    provider: "linear",
    label: "Linear",
    subtitle: "Alternative engineering-leg source",
    tag: "ENGINEERING",
    icon: <Workflow className="size-4" />,
    help: {
      url: "https://linear.app/settings/api",
      label: "Get your Linear OAuth app credentials",
    },
    connectDescription:
      "Read-only access — no issues, comments, or fields are ever written back to Linear. An alternative engineering-leg source alongside Jira, not a replacement.",
    Connect: LinearConnectButton,
    address: (subdomain) => `linear.app/${subdomain ?? "dataship"}`,
    detail: oauthDetail,
    pulse: {
      title: "Engineering leg pulse",
      ...healthy,
      stats: [
        { label: "Last webhook", value: "9s ago", hint: "Issue update" },
        {
          label: "Sync lag",
          value: "180ms",
          hint: "p99 < 320ms",
          tone: "success",
        },
        {
          label: "Daily events",
          value: "3,640",
          hint: "+6.1% avg",
          tone: "primary",
        },
      ],
    },
  },
  {
    provider: "intercom",
    label: "Intercom",
    subtitle: "Alternative helpdesk event stream",
    tag: "TICKETS",
    icon: <LifeBuoy className="size-4" />,
    badge: <Badge variant="beta">Beta</Badge>,
    help: {
      url: "https://developers.intercom.com/docs/build-an-integration/learn-more/authentication/setting-up-oauth",
      label: "Get your Intercom OAuth app credentials",
    },
    connectDescription:
      "Read-only access — no conversations, contacts, or fields are ever written back to Intercom. An alternative ticket source alongside Zendesk, not a replacement.",
    Connect: IntercomConnectButton,
    address: (subdomain) =>
      subdomain ? `app.intercom.com/a/apps/${subdomain}` : "app.intercom.com",
    detail: oauthDetail,
    pulse: {
      title: "Ingress runway pulse",
      ...healthy,
      stats: [
        { label: "Last webhook", value: "6s ago", hint: "Conversation" },
        {
          label: "Sync lag",
          value: "140ms",
          hint: "p99 < 260ms",
          tone: "success",
        },
        {
          label: "Daily events",
          value: "5,120",
          hint: "+8.7% avg",
          tone: "primary",
        },
      ],
    },
  },
  {
    provider: "github",
    label: "GitHub",
    subtitle: "Pull request lifecycle",
    tag: "ENGINEERING",
    icon: <GitPullRequest className="size-4" />,
    badge: <Badge variant="beta">Beta</Badge>,
    help: {
      url: "/docs/integrations/github#create-github-app",
      label: "Create your read-only GitHub App",
    },
    connectDescription:
      "Read-only access — no pull requests, reviews, or code are ever written back to GitHub. An engineering-leg source alongside Jira/Linear, correlated through whichever issue a pull request already references.",
    Connect: GithubConnectForm,
    address: (subdomain) =>
      subdomain ? `github.com/${subdomain}` : "github.com",
    detail: { text: "GitHub App", className: "font-mono text-xxs uppercase" },
    pulse: {
      title: "Pull request pulse",
      ...healthy,
      stats: [
        { label: "Last webhook", value: "12s ago", hint: "Pull request" },
        {
          label: "Sync lag",
          value: "160ms",
          hint: "p99 < 290ms",
          tone: "success",
        },
        {
          label: "Daily events",
          value: "2,310",
          hint: "+4.3% avg",
          tone: "primary",
        },
      ],
    },
  },
];
