/**
 * The integrations page groups source cards by the role each provider
 * adapter declares, carried to the client in `IntegrationsPageData`. The
 * grouping itself must never name a provider, so these fixtures use roles
 * that differ from the real registry to prove it follows the data.
 */
import { describe, expect, it } from "vitest";
import type { IntegrationsPageData } from "../src/lib/types/integrations";
import type { SourceIntegrationSpec } from "../src/modules/settings/integrations/csr/source-integration-specs";
import { groupSpecsByRole } from "../src/modules/settings/integrations/csr/integration-groups";

const spec = (provider: SourceIntegrationSpec["provider"]) => ({ provider }) as SourceIntegrationSpec;

function pageData(roles: Record<string, string>): IntegrationsPageData {
  return Object.fromEntries(Object.entries(roles).map(([p, role]) => [p, { role }])) as unknown as IntegrationsPageData;
}

describe("groupSpecsByRole", () => {
  it("buckets cards by the role in the page data, groups in first-seen order, cards in spec order", () => {
    const specs = [spec("zendesk"), spec("jira"), spec("linear"), spec("intercom"), spec("github")];
    const data = pageData({
      zendesk: "ticket_source",
      jira: "work_tracker",
      linear: "work_tracker",
      intercom: "ticket_source",
      github: "code_host",
    });

    expect(groupSpecsByRole(specs, data).map(({ role, specs }) => [role, specs.map((s) => s.provider)])).toEqual([
      ["ticket_source", ["zendesk", "intercom"]],
      ["work_tracker", ["jira", "linear"]],
      ["code_host", ["github"]],
    ]);
  });

  it("follows the data, not provider names: a provider moves group when its role does", () => {
    const specs = [spec("github"), spec("zendesk")];
    const data = pageData({ github: "work_tracker", zendesk: "work_tracker" });

    expect(groupSpecsByRole(specs, data)).toEqual([{ role: "work_tracker", specs }]);
  });
});
