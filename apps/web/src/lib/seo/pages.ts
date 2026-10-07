import { PLAN_LIST, TRIAL_LENGTH_DAYS } from "@sla/db/plans";
import type { PublicPage } from "@/lib/types/seo";
import { SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE } from "./site";

/**
 * "Starter at $49/month, Team at $149/month and Enterprise with custom
 * pricing", read from the same plan constant the pricing page renders, so the
 * snippet in a search result can't drift from the page it links to.
 */
function pricingSummary(): string {
  const parts = PLAN_LIST.map((plan) =>
    plan.monthlyPriceUsd === null
      ? `${plan.name} with custom pricing`
      : `${plan.name} at $${plan.monthlyPriceUsd}/month`,
  );
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * Every public page that belongs in the index, and the only place its title
 * and description are written. The page files read their metadata from here
 * (`getPageMetadata`) and `sitemap.ts` lists exactly these paths, so a page
 * cannot be indexed without copy of its own or listed without being indexable.
 * A new `app/docs/**` page fails `seo-routes.test.ts` until it is added.
 */
const pages = [
  {
    path: "/",
    title: SITE_NAME,
    absoluteTitle: true,
    description: SITE_DESCRIPTION,
  },
  {
    path: "/pricing",
    title: "Pricing and plans",
    description: `Compare ${SITE_NAME} plans: ${pricingSummary()}. Every new organization starts with a ${TRIAL_LENGTH_DAYS}-day trial.`,
  },
  {
    path: "/about",
    title: "About us",
    description: `Why we built ${SITE_NAME}: to show the whole path from a helpdesk ticket to an engineering fix in one place, so SLA risk is visible before anything breaches.`,
  },
  {
    path: "/terms",
    title: "Terms of Service",
    description: `The terms for using ${SITE_NAME}: what the service does, your account and integrations, acceptable use, data ownership, availability and termination.`,
  },
  {
    path: "/privacy",
    title: "Privacy Policy",
    description: `What data ${SITE_NAME} collects and doesn't collect, how it is used, how long it is kept, who it is shared with, how it is secured and your choices.`,
  },
  {
    path: "/docs",
    title: "Documentation",
    description: `Guides for connecting your helpdesk and engineering tools to ${SITE_NAME}, understanding how SLA time is calculated, and finding customer cases at risk of breach.`,
  },
  {
    path: "/docs/getting-started",
    title: "Getting started",
    description: `Connect your support and engineering systems to ${SITE_NAME} to see where customer-facing SLA time is spent and which cases are nearing or past their targets.`,
  },
  {
    path: "/docs/how-it-works",
    title: "How it works",
    description: `How ${SITE_NAME} treats an escalated customer issue as one case and rebuilds a single, explainable SLA clock from the events your connected systems report.`,
  },
  {
    path: "/docs/cases",
    title: "Cases and the case timeline",
    description: `How ${SITE_NAME} follows one customer request across every system it touches, and how the All cases table and the case detail page explain each SLA number.`,
  },
  {
    path: "/docs/sla",
    title: "SLA policies, targets and elapsed time",
    description: `How ${SITE_NAME} computes SLA time from recorded event history, a specific policy version and a specific calendar version, rather than a stored running counter.`,
  },
  {
    path: "/docs/dashboard",
    title: "Dashboard and SLA analytics",
    description: `What the ${SITE_NAME} dashboard shows about the cases that need attention right now, followed by the monthly-report-style SLA analytics.`,
  },
  {
    path: "/docs/notifications",
    title: "Slack and email alerts",
    description: `How ${SITE_NAME} sends Slack and email alerts the moment an SLA commitment crosses a warning threshold or breaches, so you find out before your customer does.`,
  },
  {
    path: "/docs/configuration",
    title: "Configuration reference",
    description: `Every ${SITE_NAME} setting in one place, including engineering targets, customer calendar overrides and bringing your own OAuth app. All of it is optional.`,
  },
  {
    path: "/docs/security",
    title: "Security summary",
    description: `What ${SITE_NAME} can access, what it stores, and how it is protected. Written to be forwarded to a security reviewer.`,
  },
  {
    path: "/docs/troubleshooting",
    title: "Troubleshooting",
    description: `Fixes for common ${SITE_NAME} setup, integration, synchronization and SLA problems, from Zendesk and Jira connection errors to tickets that don't appear.`,
  },
  {
    path: "/docs/faq",
    title: "Frequently asked questions",
    description: `Quick answers about what ${SITE_NAME} supports, whether it is read-only, how often data refreshes, and how SLA time and escalations are calculated.`,
  },
  {
    path: "/docs/integrations/zendesk",
    title: "Connect Zendesk",
    description: `Create a Zendesk OAuth client and connect Zendesk, the system of record for your SLA policies, business calendars, customers and ticket history, to ${SITE_NAME}.`,
  },
  {
    path: "/docs/integrations/jira",
    title: "Connect Jira",
    description: `Connect Jira to ${SITE_NAME} for the engineering side of the timeline: what happened to an escalated case after a Zendesk ticket was linked to a Jira issue.`,
  },
  {
    path: "/docs/integrations/slack",
    title: "Connect Slack",
    description: `Create a Slack app and connect it to ${SITE_NAME} to post a message to one channel the moment a commitment crosses a warning threshold or breaches.`,
  },
  {
    path: "/docs/integrations/linear",
    title: "Connect Linear",
    description: `Connect Linear to ${SITE_NAME} as an alternative to Jira for the engineering leg of a case by creating a Linear OAuth application and adding its credentials.`,
  },
  {
    path: "/docs/integrations/intercom",
    title: "Connect Intercom",
    description: `Connect Intercom to ${SITE_NAME} as an alternative ticket source to Zendesk, and learn how it differs. This integration is in Beta.`,
  },
  {
    path: "/docs/integrations/github",
    title: "Connect GitHub",
    description: `Track engineering time from pull requests by creating a read-only GitHub App and connecting it to ${SITE_NAME}. This integration is in Beta.`,
  },
] as const satisfies readonly PublicPage[];

export type PublicPath = (typeof pages)[number]["path"];

export const PUBLIC_PAGES: readonly PublicPage[] = pages;

export const HOME_PAGE = pages[0];

/** Social-card alt text, shared with the generated image's own copy. */
export const SOCIAL_IMAGE_ALT = `${SITE_NAME}: ${SITE_TAGLINE}`;
