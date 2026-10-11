/**
 * Integration lifecycle stage in documentation and onboarding: one persisted
 * source (`IntegrationAvailability`, D33), one wording module, one badge. A
 * Beta → Stable change in `/admin/integrations` must show up on every surface
 * without editing any of them, so these tests pin the three ways that could
 * silently stop being true: the wording per stage, the stage reaching the page
 * metadata, and no page carrying its own hardcoded "Beta".
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CATALOG_PROVIDERS, INTEGRATION_CATALOG } from "@sla/db/availability";

import { ReleaseStageBadge, ReleaseStageNotice } from "../src/components/shared/release-stage";
import { RELEASE_STAGE_LABELS, releaseStageSentence, releaseStageSeoSuffix, type ReleaseStage } from "../src/lib/release-stage";
import { getIntegrationPageMetadata } from "../src/lib/seo/metadata";
import { PUBLIC_PAGES } from "../src/lib/seo/pages";

const STAGES: ReleaseStage[] = ["stable", "beta", "coming_soon"];
const SRC = fileURLToPath(new URL("../src", import.meta.url));
const read = (relative: string) => readFileSync(join(SRC, relative), "utf8");

describe("stage wording", () => {
  it("warns for Beta and Coming soon, and says nothing for Stable", () => {
    expect(releaseStageSentence("beta")).toContain("Beta");
    expect(releaseStageSentence("beta")).toMatch(/limitations|unexpectedly/);
    expect(releaseStageSentence("coming_soon")).toContain("coming soon");
    expect(releaseStageSentence("stable")).toBeNull();
    expect(releaseStageSeoSuffix("stable")).toBe("");
  });

  it("never describes Stable as error-free or uninterrupted", () => {
    const everything = STAGES.map((stage) => `${RELEASE_STAGE_LABELS[stage]} ${releaseStageSentence(stage) ?? ""} ${releaseStageSeoSuffix(stage)}`).join(" ");
    expect(everything).not.toMatch(/error-free|guarantee|uninterrupted|always available|never fail/i);
  });
});

describe("shared badge and notice", () => {
  const html = (node: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(node);

  it("labels Beta and Coming soon everywhere, and Stable only where asked", () => {
    expect(html(createElement(ReleaseStageBadge, { stage: "beta" }))).toContain("Beta");
    expect(html(createElement(ReleaseStageBadge, { stage: "coming_soon" }))).toContain("Coming soon");
    expect(html(createElement(ReleaseStageBadge, { stage: "stable" }))).toBe("");
    const stable = html(createElement(ReleaseStageBadge, { stage: "stable", showStable: true }));
    expect(stable).toContain("Stable");
    expect(stable).not.toContain("Beta");
  });

  it("shows the Beta warning with a link to Known limitations, and nothing for Stable", () => {
    const beta = html(createElement(ReleaseStageNotice, { stage: "beta", limitationsHref: "#limitations" }));
    expect(beta).toContain("This integration is in Beta");
    expect(beta).toContain('href="#limitations"');
    expect(html(createElement(ReleaseStageNotice, { stage: "stable", limitationsHref: "#limitations" }))).toBe("");
  });
});

describe("page metadata follows the stage", () => {
  const intercom = "/docs/integrations/intercom" as const;

  it("adds the Beta sentence for Beta and removes it for Stable", () => {
    expect(getIntegrationPageMetadata(intercom, "beta").description).toMatch(/Currently in Beta\.$/);
    const stable = getIntegrationPageMetadata(intercom, "stable").description as string;
    expect(stable).not.toMatch(/Beta/);
    expect(stable.length).toBeGreaterThanOrEqual(70);
  });

  it("keeps the static registry stage-neutral and every description inside a search snippet in every stage", () => {
    for (const page of PUBLIC_PAGES) expect(page.description, page.path).not.toMatch(/\bBeta\b/);
    // Slack has no release stage (it is not a registered provider), so it keeps its static description.
    for (const page of PUBLIC_PAGES.filter((p) => (CATALOG_PROVIDERS as string[]).includes(p.path.replace("/docs/integrations/", "")))) {
      for (const stage of STAGES) {
        const description = getIntegrationPageMetadata(page.path as typeof intercom, stage).description as string;
        expect(description.length, `${page.path} ${stage}`).toBeLessThanOrEqual(160);
      }
    }
  });
});

describe("no surface carries its own stage", () => {
  const providerPages = readdirSync(join(SRC, "app/docs/integrations")).filter((name) => (CATALOG_PROVIDERS as string[]).includes(name));

  it("covers every provider that has a public documentation page", () => {
    expect(providerPages.sort()).toEqual(["github", "intercom", "jira", "linear", "zendesk"]);
  });

  it.each(["zendesk", "jira", "linear", "intercom", "github"])("the %s page reads the persisted stage per request", (provider) => {
    const source = read(`app/docs/integrations/${provider}/page.tsx`);
    expect(source).toContain('export const dynamic = "force-dynamic"');
    expect(source).toContain(`getReleaseStage("${provider}")`);
    expect(source).toContain("getIntegrationPageMetadata");
    expect(source).toContain("<ReleaseStageBadge");
    expect(source).toContain("<ReleaseStageNotice");
    expect(source).not.toMatch(/variant="beta"/);
    expect(source).not.toMatch(/>\s*Beta\s*</);
    expect(source).not.toMatch(/This integration is in Beta/);
  });

  it("the home page renders per request and takes each tool's stage from the policy", () => {
    expect(read("app/page.tsx")).toContain('export const dynamic = "force-dynamic"');
    expect(read("modules/marketing/home/ssr/Home.tsx")).toContain("getReleaseStages()");
    const view = read("modules/marketing/home/csr/HomeView.tsx");
    expect(view).not.toMatch(/beta:\s*true/);
    expect(view).not.toMatch(/>\s*Beta\s*</);
  });

  it("settings, onboarding and the Custom REST page use the shared badge, not their own", () => {
    for (const file of [
      "modules/settings/integrations/csr/SourceIntegrationCard.tsx",
      "modules/settings/integrations/csr/CustomIntegrationCard.tsx",
      "modules/onboarding/onboarding/csr/ConnectorCards.tsx",
      "modules/settings/custom-provider/csr/CustomProviderView.tsx",
    ]) {
      const source = read(file);
      expect(source, file).toContain("@/components/shared/release-stage");
      expect(source, file).not.toMatch(/<Badge variant="beta">\s*Beta/);
    }
  });
});

describe("getReleaseStages", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("@sla/db");
    vi.restoreAllMocks();
  });

  async function load(list: () => Promise<unknown>) {
    vi.resetModules();
    vi.doMock("server-only", () => ({}));
    vi.doMock("@sla/db", () => ({ getPrismaClient: () => ({}), listIntegrationAvailabilityPolicies: list }));
    return import("../src/lib/release-stage-data");
  }

  it("returns the persisted stage of every provider, so a promotion shows up on the next request", async () => {
    const { getReleaseStages, getReleaseStage } = await load(async () =>
      CATALOG_PROVIDERS.map((provider) => ({ provider, releaseStage: provider === "intercom" ? "stable" : INTEGRATION_CATALOG[provider].defaults.releaseStage })),
    );
    const stages = await getReleaseStages();
    expect(stages.intercom).toBe("stable");
    expect(stages.github).toBe("beta");
    expect(await getReleaseStage("intercom")).toBe("stable");
  });

  it("falls back to the catalog default when the policy cannot be read", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { getReleaseStages } = await load(async () => {
      throw new Error("database unavailable");
    });
    const stages = await getReleaseStages();
    for (const provider of CATALOG_PROVIDERS) expect(stages[provider]).toBe(INTEGRATION_CATALOG[provider].defaults.releaseStage);
  });
});
