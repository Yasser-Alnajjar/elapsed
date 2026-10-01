import type { IntegrationProvider } from "@sla/db";
import { githubAdapter } from "@sla/github";
import type { ProviderAdapter } from "@sla/ingestion";
import { intercomAdapter } from "@sla/intercom";
import { jiraAdapter } from "@sla/jira";
import { linearAdapter } from "@sla/linear";
import { zendeskAdapter } from "@sla/zendesk";

/**
 * Every provider the worker can reach, as one statically typed record: a
 * provider added to the `IntegrationProvider` enum is a compile error here
 * until it has an adapter. No plugin loading, no runtime registration (D16).
 * The one place in the worker allowed to name providers.
 */
export const PROVIDERS = {
  zendesk: zendeskAdapter,
  jira: jiraAdapter,
  intercom: intercomAdapter,
  linear: linearAdapter,
  github: githubAdapter,
} satisfies Record<IntegrationProvider, ProviderAdapter>;
