import { PLAN_LIST } from "@sla/db/plans";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HOME_FAQS } from "../src/modules/marketing/home/csr/home-content";
import { FAQS as PRICING_FAQS } from "../src/modules/marketing/pricing/csr/pricing-content";
import {
  faqStructuredData,
  homeStructuredData,
  pricingStructuredData,
  serializeJsonLd,
} from "../src/lib/seo/structured-data";
import type { JsonLdDocument, JsonLdNode } from "../src/lib/seo/structured-data";

const ORIGIN = "https://app.elapsedhq.io";

afterEach(() => {
  vi.unstubAllEnvs();
});

function nodes(doc: JsonLdDocument | null): JsonLdNode[] {
  expect(doc).not.toBeNull();
  return doc!["@graph"];
}

const byType = (graph: JsonLdNode[], type: string) => graph.find((node) => node["@type"] === type);

describe("home structured data", () => {
  it("describes the organization, the site, the product and the FAQ the page shows", () => {
    vi.stubEnv("NEXTAUTH_URL", ORIGIN);
    const doc = homeStructuredData(HOME_FAQS);

    expect(doc?.["@context"]).toBe("https://schema.org");
    expect(nodes(doc).map((node) => node["@type"])).toEqual([
      "Organization",
      "WebSite",
      "SoftwareApplication",
      "FAQPage",
    ]);
  });

  it("builds Organization and WebSite from the production origin, with a logo crawlers can fetch", () => {
    vi.stubEnv("NEXTAUTH_URL", ORIGIN);
    const graph = nodes(homeStructuredData(HOME_FAQS));
    const org = byType(graph, "Organization")!;
    const site = byType(graph, "WebSite")!;

    expect(org).toMatchObject({
      "@id": `${ORIGIN}/#organization`,
      name: "Elapsed",
      url: `${ORIGIN}/`,
      logo: { "@type": "ImageObject", url: `${ORIGIN}/icon-512.png` },
    });
    expect(site).toMatchObject({
      "@id": `${ORIGIN}/#website`,
      url: `${ORIGIN}/`,
      name: "Elapsed",
      inLanguage: "en",
      publisher: { "@id": `${ORIGIN}/#organization` },
    });
  });

  it("claims no sitelinks search box: the app has no site search", () => {
    vi.stubEnv("NEXTAUTH_URL", ORIGIN);
    expect(JSON.stringify(homeStructuredData(HOME_FAQS))).not.toContain("SearchAction");
  });

  it("builds FAQPage from the same questions the visible FAQ renders", () => {
    vi.stubEnv("NEXTAUTH_URL", ORIGIN);
    const faq = byType(nodes(homeStructuredData(HOME_FAQS)), "FAQPage") as {
      mainEntity: { name: string; acceptedAnswer: { text: string } }[];
    };
    expect(faq.mainEntity.map((q) => [q.name, q.acceptedAnswer.text])).toEqual(
      HOME_FAQS.map((item) => [item.question, item.answer]),
    );
  });
});

describe("SoftwareApplication offers", () => {
  it("lists a real price for each priced plan and none for the custom plan", () => {
    vi.stubEnv("NEXTAUTH_URL", ORIGIN);
    const app = byType(nodes(pricingStructuredData(PRICING_FAQS)), "SoftwareApplication") as {
      offers: { name: string; price: string; priceCurrency: string }[];
    };

    const priced = PLAN_LIST.filter((plan) => plan.monthlyPriceUsd !== null);
    expect(priced.length).toBeGreaterThan(0);
    expect(app.offers.map((offer) => [offer.name, offer.price, offer.priceCurrency])).toEqual(
      priced.map((plan) => [`${plan.name} plan`, plan.monthlyPriceUsd!.toFixed(2), "USD"]),
    );
    expect(app.offers.some((offer) => offer.name.startsWith("Enterprise"))).toBe(false);
  });

  it("is identical on the home page and the pricing page", () => {
    vi.stubEnv("NEXTAUTH_URL", ORIGIN);
    const home = byType(nodes(homeStructuredData(HOME_FAQS)), "SoftwareApplication");
    const pricing = byType(nodes(pricingStructuredData(PRICING_FAQS)), "SoftwareApplication");
    expect(pricing).toEqual(home);
    expect(pricing).toMatchObject({ applicationCategory: "BusinessApplication", operatingSystem: "Web" });
  });
});

describe("pricing and docs FAQ structured data", () => {
  it("builds the pricing FAQPage from the pricing page's own FAQ", () => {
    vi.stubEnv("NEXTAUTH_URL", ORIGIN);
    const faq = byType(nodes(pricingStructuredData(PRICING_FAQS)), "FAQPage") as {
      mainEntity: { name: string }[];
    };
    expect(faq.mainEntity.map((q) => q.name)).toEqual(PRICING_FAQS.map((item) => item.question));
  });

  it("builds a FAQPage-only document for the docs FAQ", () => {
    vi.stubEnv("NEXTAUTH_URL", ORIGIN);
    const doc = faqStructuredData([{ question: "Q?", answer: "A." }]);
    expect(nodes(doc)).toEqual([
      {
        "@type": "FAQPage",
        mainEntity: [{ "@type": "Question", name: "Q?", acceptedAnswer: { "@type": "Answer", text: "A." } }],
      },
    ]);
  });
});

describe("nothing invented", () => {
  it("contains no reviews, ratings, awards, statistics or contact details", () => {
    vi.stubEnv("NEXTAUTH_URL", ORIGIN);
    const all = JSON.stringify([
      homeStructuredData(HOME_FAQS),
      pricingStructuredData(PRICING_FAQS),
    ]);
    for (const forbidden of [
      "aggregateRating",
      "ratingValue",
      "reviewCount",
      "\"review\"",
      "award",
      "contactPoint",
      "telephone",
      "sameAs",
      "userInteractionCount",
    ]) {
      expect(all, forbidden).not.toContain(forbidden);
    }
  });

  it("has only absolute URLs on the production origin", () => {
    vi.stubEnv("NEXTAUTH_URL", ORIGIN);
    const urls = JSON.stringify(homeStructuredData(HOME_FAQS)).match(/"https?:\/\/[^"]+"/g) ?? [];
    for (const url of urls) {
      if (url.includes("schema.org")) continue;
      expect(url.startsWith(`"${ORIGIN}`), url).toBe(true);
    }
  });
});

describe("without a public origin", () => {
  it.each([
    ["unset", ""],
    ["localhost", "http://localhost:3000"],
    ["an IP address", "https://13.62.74.24"],
  ])("emits nothing when NEXTAUTH_URL is %s", (_label, url) => {
    vi.stubEnv("NEXTAUTH_URL", url);
    expect(homeStructuredData(HOME_FAQS)).toBeNull();
    expect(pricingStructuredData(PRICING_FAQS)).toBeNull();
    expect(faqStructuredData(HOME_FAQS)).toBeNull();
  });
});

describe("serializeJsonLd", () => {
  it("escapes < so page copy cannot close the script tag", () => {
    vi.stubEnv("NEXTAUTH_URL", ORIGIN);
    const doc = faqStructuredData([{ question: "Q", answer: "</script><script>alert(1)</script> <!--" }]);
    const json = serializeJsonLd(doc!);

    expect(json).not.toContain("<");
    expect(JSON.parse(json)["@graph"][0].mainEntity[0].acceptedAnswer.text).toBe(
      "</script><script>alert(1)</script> <!--",
    );
  });
});
