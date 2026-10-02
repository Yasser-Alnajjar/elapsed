/** N5.4: the security page's scopes come from the constants the OAuth flows request, so it cannot drift. */
import { describe, expect, it } from "vitest";
import { JIRA_OAUTH_SCOPES } from "@sla/jira";
import { LINEAR_OAUTH_SCOPES } from "@sla/linear";
import { ZENDESK_OAUTH_SCOPES } from "@sla/zendesk";
import { SLACK_BOT_SCOPES } from "@sla/slack";
import { getProviderAccessFacts, SLACK_ACCESS_FACT } from "@/lib/security-summary";

describe("security summary facts", () => {
  const facts = Object.fromEntries(getProviderAccessFacts().map((f) => [f.provider, f]));

  it("lists every provider in the registry", () => {
    expect(Object.keys(facts).sort()).toEqual(["github", "intercom", "jira", "linear", "zendesk"]);
  });

  it("reports the exact scopes the OAuth modules request", () => {
    expect(facts.jira!.scopes).toEqual([...JIRA_OAUTH_SCOPES]);
    expect(facts.linear!.scopes).toEqual([...LINEAR_OAUTH_SCOPES]);
    expect(facts.zendesk!.scopes).toEqual([...ZENDESK_OAUTH_SCOPES]);
    expect(SLACK_ACCESS_FACT.scopes).toEqual([...SLACK_BOT_SCOPES]);
  });

  it("claims read-only only where no requested scope can write", () => {
    for (const fact of Object.values(facts)) {
      for (const scope of fact.scopes) expect(scope, `${fact.provider}:${scope}`).not.toMatch(/write|admin|manage|(^|:)(edit|create|delete)/i);
    }
  });

  it("explains read-only enforcement for providers that take no scope", () => {
    for (const fact of Object.values(facts)) if (fact.scopes.length === 0) expect(fact.note).toBeTruthy();
  });
});
