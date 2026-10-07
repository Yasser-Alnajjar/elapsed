import { PLAN_LIST } from "@sla/db/plans";
import type { FaqItem } from "@/lib/types/seo";
import { getSiteOrigin, SITE_DESCRIPTION, SITE_NAME } from "./site";

export type JsonLdNode = Record<string, unknown>;

export interface JsonLdDocument {
  "@context": "https://schema.org";
  "@graph": JsonLdNode[];
}

/*
 * Only what the site can stand behind: no ratings, reviews, awards, customer
 * counts or contact details, because none of those exist in the product. The
 * WebSite node has no `SearchAction` either: the app has no site search (the
 * header's search box is disabled). Every builder returns `null` without a
 * public origin, since schema.org URLs must be absolute and must never be a
 * localhost or IP address.
 */

function organizationNode(origin: string): JsonLdNode {
  return {
    "@type": "Organization",
    "@id": `${origin}/#organization`,
    name: SITE_NAME,
    url: `${origin}/`,
    logo: {
      "@type": "ImageObject",
      url: `${origin}/icon-512.png`,
      width: 512,
      height: 512,
    },
    description: SITE_DESCRIPTION,
  };
}

function webSiteNode(origin: string): JsonLdNode {
  return {
    "@type": "WebSite",
    "@id": `${origin}/#website`,
    url: `${origin}/`,
    name: SITE_NAME,
    description: SITE_DESCRIPTION,
    inLanguage: "en",
    publisher: { "@id": `${origin}/#organization` },
  };
}

/**
 * The product itself, with one `Offer` per plan that has a list price. The
 * prices are read from `@sla/db/plans`, the constant the pricing page renders
 * and entitlement checks enforce. The Enterprise plan has no list price
 * ("Custom"), so it gets no `Offer` rather than an invented number.
 */
function softwareApplicationNode(origin: string): JsonLdNode {
  const offers = PLAN_LIST.flatMap((plan) =>
    plan.monthlyPriceUsd === null
      ? []
      : [
          {
            "@type": "Offer",
            name: `${plan.name} plan`,
            description: plan.description,
            url: `${origin}/pricing`,
            price: plan.monthlyPriceUsd.toFixed(2),
            priceCurrency: "USD",
            priceSpecification: {
              "@type": "UnitPriceSpecification",
              price: plan.monthlyPriceUsd.toFixed(2),
              priceCurrency: "USD",
              unitCode: "MON",
            },
          },
        ],
  );

  return {
    "@type": "SoftwareApplication",
    "@id": `${origin}/#software`,
    name: SITE_NAME,
    url: `${origin}/`,
    description: SITE_DESCRIPTION,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    inLanguage: "en",
    publisher: { "@id": `${origin}/#organization` },
    ...(offers.length > 0 ? { offers } : {}),
  };
}

/** `FAQPage` for a FAQ the page really shows, built from the same items the page renders. */
function faqPageNode(items: readonly FaqItem[]): JsonLdNode {
  return {
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };
}

function document(nodes: JsonLdNode[]): JsonLdDocument {
  return { "@context": "https://schema.org", "@graph": nodes };
}

/** Home page: the organization, the site, the product and its FAQ. */
export function homeStructuredData(
  faqs: readonly FaqItem[],
): JsonLdDocument | null {
  const origin = getSiteOrigin();
  if (!origin) return null;
  return document([
    organizationNode(origin),
    webSiteNode(origin),
    softwareApplicationNode(origin),
    faqPageNode(faqs),
  ]);
}

/** Pricing page: the product with its plan offers, and the billing FAQ. */
export function pricingStructuredData(
  faqs: readonly FaqItem[],
): JsonLdDocument | null {
  const origin = getSiteOrigin();
  if (!origin) return null;
  return document([
    organizationNode(origin),
    softwareApplicationNode(origin),
    faqPageNode(faqs),
  ]);
}

/** A page that is only a FAQ (the docs FAQ). */
export function faqStructuredData(
  faqs: readonly FaqItem[],
): JsonLdDocument | null {
  if (!getSiteOrigin()) return null;
  return document([faqPageNode(faqs)]);
}

/**
 * JSON for a `<script type="application/ld+json">` body. `<` is escaped so
 * copy containing `</script>` (or `<!--`) can't end the tag early.
 */
export function serializeJsonLd(data: JsonLdDocument): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
