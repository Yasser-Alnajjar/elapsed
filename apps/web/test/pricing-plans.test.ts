import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { formatPlanPrice, PLAN_LIST, planFeatureLines } from "@sla/db/plans";
import { PLAN_IDS, PLAN_LABELS, PLAN_PRICE_LABELS } from "../src/lib/types/admin";

vi.mock("@/components/shared/reveal", () => ({ Reveal: ({ children }: { children: unknown }) => children }));

const decode = (html: string) => html.replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

describe("pricing page and plan constant (N6.1, N6.6)", () => {
  it("renders every plan in PLANS, with its price and feature lines, and nothing else", async () => {
    const { PricingView } = await import("../src/modules/marketing/pricing/csr/PricingView");
    const html = decode(renderToStaticMarkup(createElement(PricingView)));

    const headings = [...html.matchAll(/<h2[^>]*>([^<]+)<\/h2>/g)].map((m) => m[1]).filter((h) => h !== "Frequently asked questions");
    expect(headings).toEqual(PLAN_LIST.map((plan) => plan.name));

    for (const plan of PLAN_LIST) {
      expect(html).toContain(formatPlanPrice(plan).price);
      for (const line of planFeatureLines(plan)) expect(html).toContain(line);
    }
  });

  it("describes no unbuilt feature on the page", async () => {
    const { PricingView } = await import("../src/modules/marketing/pricing/csr/PricingView");
    const text = decode(renderToStaticMarkup(createElement(PricingView))).toLowerCase();
    for (const claim of ["sso", "saml", "90-day", "case history", "prorated", "custom retention", "from your account settings"]) {
      expect(text).not.toContain(claim);
    }
  });

  it("makes the operator's plan labels and prices come from the same constant", () => {
    expect([...PLAN_IDS]).toEqual(PLAN_LIST.map((plan) => plan.id));
    for (const plan of PLAN_LIST) {
      expect(PLAN_LABELS[plan.id]).toBe(plan.name);
      expect(PLAN_PRICE_LABELS[plan.id]).toBe(formatPlanPrice(plan).price);
    }
  });
});
