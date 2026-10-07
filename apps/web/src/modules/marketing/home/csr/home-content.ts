import type { FaqItem } from "@/lib/types/seo";

// Plain data, no "use client": the visible FAQ (HomeView) and the FAQPage
// structured data (ssr/Home.tsx) read this one list, so they cannot disagree.
export const HOME_FAQS: FaqItem[] = [
  {
    question: "Is Elapsed read-only?",
    answer:
      "Yes, for every connected data source (Zendesk, Jira, Linear, Intercom, GitHub). The only outbound writes anywhere in the product are a Slack message and an alert email.",
  },
  {
    question: "How fresh is the data?",
    answer:
      "Every 5 minutes for open cases, every 30 minutes for a full reconciliation sweep, and near-instantly for Zendesk and Jira when a webhook is configured.",
  },
  {
    question: "How does Elapsed know which Jira issue belongs to a ticket?",
    answer:
      "By reading Jira's own remote-link data on the issue and matching a Zendesk URL against your exact connected subdomain. When there is no link, the case has no engineering leg and is never guessed at.",
  },
  {
    question: "Does it handle business hours and holidays?",
    answer:
      "Yes. Calendars imported from Zendesk business-hours schedules, or a 24/7 always-open calendar, are used to compute working time. A date marked as a holiday contributes zero working minutes.",
  },
  {
    question: "How far back does history go?",
    answer:
      "90 days from the date each integration was connected, so you see your baseline on day one.",
  },
];
