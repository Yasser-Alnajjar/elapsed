/**
 * N10 (D33): no provider route can bypass platform availability. Every route
 * that can connect a provider, complete its OAuth, start or mint a connect
 * link, write its OAuth app configuration, import from it, accept its webhooks
 * or export from it calls one of the availability helpers; the exceptions are
 * listed here by name, each with its reason. A new route under these trees
 * fails this test until it is gated or deliberately exempted.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const WEB_SRC = fileURLToPath(new URL("../src/", import.meta.url));

function routes(dir: string, found: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) routes(path, found);
    else if (name === "route.ts") found.push(relative(WEB_SRC, path).split("\\").join("/"));
  }
  return found;
}

/** Calls that enforce availability (see `lib/integration-availability.ts`). */
const GATES = [
  "requireIntegrationAvailable(",
  "requireIntegrationAvailableOrRedirect(",
  "availabilityCheck(",
  "ignoreWebhookIfUnavailable(",
  "resolveIntegrationAvailability(",
  // Shared wrappers that call one of the above, checked below.
  "createIntegrationConfigHandlers(",
  "ownerGuard(",
  "withOutboundSession(",
];

/** Routes that deliberately do not check availability. */
const EXEMPT: Record<string, string> = {
  "app/api/integrations/zendesk/disconnect/route.ts": "a customer can always disconnect (D33)",
  "app/api/integrations/jira/disconnect/route.ts": "a customer can always disconnect (D33)",
  "app/api/integrations/linear/disconnect/route.ts": "a customer can always disconnect (D33)",
  "app/api/integrations/intercom/disconnect/route.ts": "a customer can always disconnect (D33)",
  "app/api/integrations/github/disconnect/route.ts": "a customer can always disconnect (D33)",
  "app/api/integrations/slack/callback/route.ts": "Slack is out of N10 scope (ruling 7)",
  "app/api/integrations/slack/channel/route.ts": "Slack is out of N10 scope (ruling 7)",
  "app/api/integrations/slack/channels/route.ts": "Slack is out of N10 scope (ruling 7)",
  "app/api/integrations/slack/config/route.ts": "Slack is out of N10 scope (ruling 7); the shared config factory skips it",
  "app/api/integrations/slack/connect/route.ts": "Slack is out of N10 scope (ruling 7)",
  "app/api/integrations/slack/disconnect/route.ts": "Slack is out of N10 scope (ruling 7)",
};

const GATED_TREES = ["app/api/integrations", "app/api/webhooks", "app/api/concierge"];
const read = (path: string) => readFileSync(join(WEB_SRC, path), "utf8");

describe("integration availability boundary (N10, D33)", () => {
  const all = GATED_TREES.flatMap((tree) => routes(join(WEB_SRC, tree)))
    // The concierge listing routes read only stored rows; its exports call the provider.
    .filter((path) => !path.startsWith("app/api/concierge/") || path.endsWith("/export/route.ts"));

  it("finds the provider routes", () => {
    expect(all.length).toBeGreaterThan(40);
  });

  it("every provider route calls an availability gate, or is exempt by name", () => {
    const ungated = all.filter((path) => !EXEMPT[path] && !GATES.some((gate) => read(path).includes(gate)));
    expect(ungated).toEqual([]);
  });

  it("every exemption still exists (a stale entry would hide a new route)", () => {
    for (const path of Object.keys(EXEMPT)) expect(all, path).toContain(path);
  });

  it("the shared wrappers really gate", () => {
    const guard = read("lib/custom-provider/route-guard.ts");
    expect(guard).toContain('availabilityCheck(organizationId, "custom")');
    expect(read("lib/custom-provider/outbound-route.ts")).toContain("ownerGuard({ outbound: true })");
    expect(read("lib/integration-config-route.ts")).toMatch(/requireIntegrationAvailable\(organizationId, provider\)/);
  });

  it("only Custom REST status and disconnect skip the gate, and both make no outbound request", () => {
    const skipping = all.filter((path) => read(path).includes("requireAvailable: false"));
    expect(skipping.sort()).toEqual(["app/api/integrations/custom/disconnect/route.ts", "app/api/integrations/custom/status/route.ts"]);
  });

  it("every OAuth callback checks availability before it exchanges the code", () => {
    for (const provider of ["zendesk", "jira", "linear", "intercom", "github"]) {
      const source = read(`app/api/integrations/${provider}/callback/route.ts`);
      const gate = Math.max(source.indexOf("requireIntegrationAvailableOrRedirect("), source.indexOf("availabilityCheck("));
      expect(gate, provider).toBeGreaterThan(0);
      expect(gate, provider).toBeLessThan(source.indexOf("await exchangeCodeForToken("));
    }
  });

  it("webhooks authenticate first, then check availability, then parse", () => {
    for (const provider of ["zendesk", "jira"]) {
      const source = read(`app/api/webhooks/${provider}/[integrationId]/route.ts`);
      const verify = source.indexOf("verifyWebhook!(");
      const gate = source.indexOf("ignoreWebhookIfUnavailable(");
      expect(verify, provider).toBeGreaterThan(0);
      expect(gate, provider).toBeGreaterThan(verify);
      expect(gate, provider).toBeLessThan(source.indexOf("JSON.parse(") > 0 ? source.indexOf("JSON.parse(") : source.indexOf("request.json()"));
    }
  });
});
