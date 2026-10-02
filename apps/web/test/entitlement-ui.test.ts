/**
 * The customer-facing trial and limit notices (N6.3, N6.4): wording, the
 * replaceable upgrade CTA, and the page an owner lands on after a blocked connect.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@modules/settings/integrations", () => ({ Integrations: () => createElement("div", { "data-testid": "integrations" }) }));

const html = (element: React.ReactElement) => renderToStaticMarkup(element).replace(/&#x27;/g, "'");

afterEach(() => vi.unstubAllEnvs());

describe("getUpgradeCta", () => {
  it("is a mailto contact when a support address is configured, and plain text when not", async () => {
    const { getUpgradeCta } = await import("../src/lib/upgrade-cta");
    vi.stubEnv("NEXT_PUBLIC_SUPPORT_EMAIL", " help@elapsed.test ");
    expect(getUpgradeCta()).toMatchObject({ label: "Contact us to upgrade", href: expect.stringMatching(/^mailto:help@elapsed\.test\?subject=/) });
    vi.stubEnv("NEXT_PUBLIC_SUPPORT_EMAIL", "");
    expect(getUpgradeCta()).toEqual({ label: "Contact Elapsed support to upgrade", href: null });
  });
});

describe("PlanNoticeBanner: expired trial", () => {
  const render = async (props: import("../src/components/shared/plan-notice-banner").PlanNotice) => {
    const { PlanNoticeBanner } = await import("../src/components/shared/plan-notice-banner");
    return html(createElement(PlanNoticeBanner, { notice: props }));
  };
  const expired = { trialExpiredAt: "2026-10-01T00:00:00.000Z", overLimit: [] };

  it("says monitoring, alerts, cases and history continue, and that adding configuration is paused", async () => {
    const markup = await render(expired);
    expect(markup).toContain("Your trial ended on");
    expect(markup).toContain("Cases, SLA monitoring, alerts and history keep working");
    expect(markup).toContain("adding members, integrations or SLA policies is paused until you upgrade");
  });

  it("offers the contact CTA, never /sign-up or /pricing", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPPORT_EMAIL", "help@elapsed.test");
    const withContact = await render(expired);
    expect(withContact).toContain('href="mailto:help@elapsed.test');
    expect(withContact).toContain("Contact us to upgrade");
    expect(withContact).not.toMatch(/sign-up|\/pricing/);

    vi.stubEnv("NEXT_PUBLIC_SUPPORT_EMAIL", "");
    const withoutContact = await render(expired);
    expect(withoutContact).toContain("Contact Elapsed support to upgrade");
    expect(withoutContact).not.toContain("<a ");
  });

  it("renders nothing without a notice, and keeps over-limit wording free of any claim that something is switched off", async () => {
    expect(await render({ trialExpiredAt: null, overLimit: [] })).toBe("");
    const over = await render({ trialExpiredAt: null, overLimit: [{ resource: "seats", used: 6, limit: 5 }] });
    expect(over).toContain("6 of 5 seats");
    expect(over).toContain("Nothing is switched off");
  });
});

describe("EntitlementWarningAlert", () => {
  it("shows the reached and exceeded wording with the CTA, as a warning rather than an error", async () => {
    const { EntitlementWarningAlert } = await import("../src/components/shared/entitlement-alerts");
    const reached = html(createElement(EntitlementWarningAlert, { warning: { level: "reached", message: "You have reached your plan's limit: 5 of 5 seats." } }));
    expect(reached).toContain('data-level="reached"');
    expect(reached).toContain("5 of 5 seats");
    expect(reached).toContain("Contact Elapsed support to upgrade");
    expect(reached).not.toContain("destructive");

    const exceeded = html(createElement(EntitlementWarningAlert, { warning: { level: "exceeded", message: "You are over your plan's limit: 6 of 5 seats." } }));
    expect(exceeded).toContain('data-level="exceeded"');
  });
});

describe("blocked-connect notice (?entitlement=trial_expired)", () => {
  it("names the provider that was blocked, says nothing changed and monitoring is unaffected", async () => {
    const { EntitlementBlockedNotice } = await import("../src/components/shared/entitlement-alerts");
    const markup = html(createElement(EntitlementBlockedNotice, { action: "connect", provider: "jira" }));
    expect(markup).toContain("couldn't connect Jira because your trial has ended");
    expect(markup).toContain("Nothing was changed");
    expect(markup).toContain("cases, SLA monitoring, alerts and history are unaffected");
  });

  it("falls back to generic wording for anything it does not recognise, and never echoes the query text", async () => {
    const { EntitlementBlockedNotice } = await import("../src/components/shared/entitlement-alerts");
    const markup = html(createElement(EntitlementBlockedNotice, { action: "connect", provider: "<script>x</script>" }));
    expect(markup).toContain("couldn't complete that action");
    expect(markup).not.toContain("script");
    expect(html(createElement(EntitlementBlockedNotice, { provider: "constructor" }))).toContain("complete that action");
  });

  it("is shown on the integrations page only for trial_expired", async () => {
    const { default: Page } = await import("../src/app/(main)/settings/integrations/page");
    const render = async (searchParams: { entitlement?: string; action?: string; provider?: string }) => html(await Page({ searchParams: Promise.resolve(searchParams) }));

    const blocked = await render({ entitlement: "trial_expired", action: "connect", provider: "zendesk" });
    expect(blocked).toContain('data-testid="entitlement-blocked"');
    expect(blocked).toContain("connect Zendesk");
    expect(blocked).toContain('data-testid="integrations"');

    for (const other of [{}, { entitlement: "something_else" }]) {
      expect(await render(other)).not.toContain("entitlement-blocked");
    }
  });

  it("is what a blocked connect redirects to, for every provider", async () => {
    const { blockedConnectRedirect } = await import("../src/lib/entitlements");
    for (const provider of ["zendesk", "jira", "linear", "intercom", "github"] as const) {
      expect(blockedConnectRedirect(provider)).toBe(`/settings/integrations?entitlement=trial_expired&action=connect&provider=${provider}`);
    }
  });
});
