import type { EmailTemplateData, EmailTemplateId } from "../src";

/**
 * One realistic request per registered template. `satisfies` makes adding a
 * template without a fixture a type error, and the registry test checks the
 * ids match at runtime, so every template is exercised by every layout test.
 */
export const TEMPLATE_FIXTURES = {
  "email-verification": { verifyUrl: "https://app.example.com/verify-email?token=abc123", ttlHours: 24 },
  "email-change-verification": { confirmUrl: "https://app.example.com/verify-email?token=def456", ttlHours: 24 },
  "password-reset": { resetUrl: "https://app.example.com/reset-password?token=ghi789", ttlMinutes: 60 },
  invitation: { organizationName: "Acme Support", acceptUrl: "https://app.example.com/invite/accept?token=jkl012", ttlDays: 7 },
  "trial-ended": { organizationName: "Acme Support", pricingUrl: "https://app.example.com/pricing" },
  "ops-alert": {
    subject: "SLA worker stalled: reconciliation_sweep",
    message: "reconciliation_sweep is 912s overdue for at least one organization (4 organizations, 4 leased, 0 with an expired lease).",
  },
  "sla-alert": {
    severity: "at_risk",
    kindLabel: "Resolution",
    ticketLabel: "#4821",
    ticketName: "Payment webhook failing",
    customerName: "Acme Co.",
    figureText: "45m",
    thresholdPercent: 80,
    targetText: "4h",
    policyName: "Urgent SLA",
    startedText: "Sep 17, 2026, 09:00 UTC",
    caseUrl: "https://app.example.com/cases/case_1?ref=alert&n=n_1",
    senderName: "Acme Support",
  },
  "monthly-report": {
    organizationName: "Acme Support",
    periodLabel: "September 2026",
    timezone: "Europe/Berlin",
    overview: [
      { label: "Cases opened", value: "318" },
      { label: "Met", value: "130" },
      { label: "Breached", value: "20", tone: "danger" },
      { label: "Compliance", value: "86.7%", tone: "info" },
    ],
    compliance: [
      { label: "First response", value: "90% (90 met, 10 breached)" },
      { label: "Next reply", value: "80% (40 met, 10 breached)" },
      { label: "Resolution", value: "n/a (0 met, 0 breached)" },
    ],
    stages: [
      { label: "Support", value: "14 breaches", swatch: "support" },
      { label: "Engineering", value: "6 breaches", swatch: "engineering" },
    ],
    topCustomers: [{ label: "Globex", value: "7 breaches" }],
    linkCoverage: "69%: 214 of 318 cases from the last 30 days of the month are linked to engineering work. Only certain links count.",
    csvNote: "The attached CSV lists the first 500 breaches of 612.",
    caseListUrl: "https://app.example.com/cases?breached=1",
  },
  "smtp-test": { senderName: "Acme Support" },
} satisfies { [K in EmailTemplateId]: EmailTemplateData<K> };
