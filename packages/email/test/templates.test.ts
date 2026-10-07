import { describe, expect, it } from "vitest";
import { EMAIL_BRAND } from "../src/brand";
import { renderEmail } from "../src/render";
import { EMAIL_TEMPLATES, EMAIL_TEMPLATE_IDS, type EmailTemplateId } from "../src/templates";
import type { EmailTemplateRequest } from "../src/request";
import { TEMPLATE_FIXTURES } from "./fixtures";

const NOW = new Date("2026-10-07T00:00:00Z");
const APP_URL = "https://app.example.com";

function render(id: EmailTemplateId, data: unknown = TEMPLATE_FIXTURES[id], appUrl: string | null = APP_URL) {
  return renderEmail({ template: id, data } as EmailTemplateRequest, { appUrl, now: NOW });
}

describe("template registry", () => {
  it("has a fixture for every registered template, and no fixture for an unregistered one", () => {
    expect(Object.keys(TEMPLATE_FIXTURES).sort()).toEqual([...EMAIL_TEMPLATE_IDS].sort());
  });

  it("registers the emails Elapsed sends: account, alert, report, ops and test mail", () => {
    expect([...EMAIL_TEMPLATE_IDS].sort()).toEqual(
      ["email-change-verification", "email-verification", "invitation", "monthly-report", "ops-alert", "password-reset", "sla-alert", "smtp-test", "trial-ended"].sort(),
    );
  });

  it.each(EMAIL_TEMPLATE_IDS)("%s renders inside the Elapsed shell (HTML and plain text), whatever its content", (id) => {
    const email = render(id);

    // HTML: the shared document, logo, wordmark, category pill, footer, URL, copyright.
    expect(email.html.startsWith("<!doctype html>")).toBe(true);
    expect(email.html).toContain('data-elapsed-email="shell"');
    expect(email.html).toContain('src="cid:elapsed-logo"');
    expect(email.html).toContain(`>${EMAIL_BRAND.name}</td>`);
    expect(email.html).toContain(`${EMAIL_BRAND.name} · ${EMAIL_BRAND.categoryLabels[EMAIL_TEMPLATES[id].category]}`);
    expect(email.html).toContain(EMAIL_BRAND.descriptor);
    expect(email.html).toContain(`href="${APP_URL}"`);
    expect(email.html).toContain("© 2026 Elapsed. All rights reserved.");
    expect(email.html).toContain('<meta name="color-scheme" content="dark light">');
    expect(email.html).toContain('<meta name="viewport"');
    expect(email.html).toContain(`<title>${email.subject.replace(/&/g, "&amp;").replace(/'/g, "&#39;")}</title>`);

    // The logo travels with the message.
    expect(email.inlineImages.map((image) => image.cid)).toContain("elapsed-logo");

    // Plain text: the same frame, no markup.
    expect(email.text.startsWith("ELAPSED · ")).toBe(true);
    expect(email.text).toContain(EMAIL_BRAND.descriptor);
    expect(email.text).toContain(APP_URL);
    expect(email.text).toContain("© 2026 Elapsed. All rights reserved.");
    expect(email.text).not.toMatch(/<\/?[a-z][^>]*>/i);
    expect(email.text).not.toContain("&amp;");
  });

  it.each(EMAIL_TEMPLATE_IDS)("%s has a one-line subject, a bounded preheader and every link of its data in both bodies", (id) => {
    const email = render(id);
    expect(email.subject.length).toBeGreaterThan(0);
    expect(email.subject).not.toMatch(/[\r\n]/);

    const urls = JSON.stringify(TEMPLATE_FIXTURES[id]).match(/https:\/\/[^"\\]+/g) ?? [];
    for (const url of urls) {
      expect(email.text, url).toContain(url);
      expect(email.html, url).toContain(url.replace(/&/g, "&amp;"));
    }
  });

  it.each(EMAIL_TEMPLATE_IDS)("%s still renders fully branded when the deployment has no URL configured", (id) => {
    const email = render(id, TEMPLATE_FIXTURES[id], null);
    expect(email.html).toContain('data-elapsed-email="shell"');
    expect(email.html).toContain("© 2026 Elapsed. All rights reserved.");
    expect(email.text).toContain("© 2026 Elapsed. All rights reserved.");
    expect(email.html).not.toContain("Open Elapsed");
  });
});

describe("account email content", () => {
  it("email verification carries the link and its lifetime", () => {
    const email = render("email-verification");
    expect(email.subject).toBe("Verify your email for Elapsed");
    expect(email.text).toContain("Verify your email: https://app.example.com/verify-email?token=abc123");
    expect(email.text).toContain("single-use and expires in 24 hours");
  });

  it("email change confirmation says what was requested and that ignoring it changes nothing", () => {
    const email = render("email-change-verification");
    expect(email.subject).toBe("Confirm your new email for Elapsed");
    expect(email.text).toContain("Confirm this change: https://app.example.com/verify-email?token=def456");
    expect(email.text).toContain("the account's email won't change");
  });

  it("password reset carries the link, its lifetime in minutes, and the ignore-me line", () => {
    const email = render("password-reset");
    expect(email.subject).toBe("Reset your Elapsed password");
    expect(email.text).toContain("Reset your password: https://app.example.com/reset-password?token=ghi789");
    expect(email.text).toContain("expires in 60 minutes");
    expect(email.text).toContain("your password won't change");
  });

  it("invitation names the organization and carries the accept link and lifetime in days", () => {
    const email = render("invitation");
    expect(email.subject).toBe("You've been invited to join Acme Support on Elapsed");
    expect(email.text).toContain("Accept the invitation: https://app.example.com/invite/accept?token=jkl012");
    expect(email.text).toContain("expires in 7 days");
  });

  it("trial ended tells the owner that monitoring continues and what is paused, and never mentions charging", () => {
    const email = render("trial-ended");
    expect(email.subject).toBe("Your Elapsed trial for Acme Support has ended");
    expect(email.text).toContain("keep working");
    expect(email.text).toContain("paused");
    expect(email.text).toContain("See plans: https://app.example.com/pricing");
    expect(email.text.toLowerCase()).not.toContain("charged");
  });

  it("trial ended omits the plans button when there is no pricing URL", () => {
    const email = render("trial-ended", { organizationName: "Acme Support", pricingUrl: null });
    expect(email.html).not.toContain("See plans");
  });
});

describe("operational email content", () => {
  it("ops alert uses the alert's own subject and message, flagged as an alert or a recovery", () => {
    const alert = render("ops-alert");
    expect(alert.subject).toBe("SLA worker stalled: reconciliation_sweep");
    expect(alert.text).toContain("912s overdue");
    expect(alert.text).toContain("[OPERATIONAL ALERT]");

    const recovered = render("ops-alert", { subject: "SLA worker recovered: reconciliation_sweep", message: "Serviced again.", kind: "recovered" });
    expect(recovered.text).toContain("[RECOVERED]");
  });

  it("smtp test keeps its subject and says what a received test means", () => {
    const email = render("smtp-test");
    expect(email.subject).toBe("Elapsed — Test Email");
    expect(email.text).toContain("SMTP configuration for Elapsed is working correctly");
    expect(email.text).toContain("on behalf of Acme Support");
  });
});

describe("sla-alert content", () => {
  const alert = (overrides: Record<string, unknown> = {}) => render("sla-alert", { ...TEMPLATE_FIXTURES["sla-alert"], ...overrides });

  it("at risk: names the kind, ticket and customer, the runway left and the share of target used", () => {
    const email = alert();
    expect(email.subject).toBe("SLA at risk: Resolution on #4821 (Acme Co.)");
    expect(email.text).toContain("[SLA AT RISK]");
    expect(email.text).toContain("Resolution SLA at risk");
    expect(email.text).toContain("REMAINING RUNWAY: 45m");
    expect(email.text).toContain("COMMITTED TARGET: 4h");
    expect(email.text).toContain("80% of target used, 45m remaining.");
    expect(email.text).toContain("Policy: Urgent SLA");
    expect(email.text).toContain("Started: Sep 17, 2026, 09:00 UTC");
    expect(email.text).not.toContain("Breached:");
    expect(email.html).toContain("Payment webhook failing");
    expect(email.html).toContain("Ticket #4821");
  });

  it("breached: reports time over target, not remaining time, and the breach instant", () => {
    const email = alert({ severity: "breach", figureText: "2h 10m", thresholdPercent: undefined, breachedText: "Sep 17, 2026, 13:15 UTC" });
    expect(email.subject).toBe("SLA breached: Resolution on #4821 (Acme Co.)");
    expect(email.text).toContain("[SLA BREACHED]");
    expect(email.text).toContain("BREACH OVERAGE: +2h 10m");
    expect(email.text).toContain("Over target by 2h 10m.");
    expect(email.text).toContain("Breached: Sep 17, 2026, 13:15 UTC");
    expect(email.text).not.toContain("%");
  });

  it("includes the stale-source line when the source data is stale", () => {
    expect(alert({ sourceStaleSinceText: "Sep 17, 2026, 12:00 UTC" }).text).toContain("Source data stale since: Sep 17, 2026, 12:00 UTC");
  });

  it("shows the view button only when there is a case link", () => {
    expect(alert().html).toContain("View ticket");
    const bare = alert({ caseUrl: null });
    expect(bare.html).not.toContain("View ticket");
    expect(bare.text).not.toContain("View ticket");
  });

  it("names the organization in the footer, or 'your organization' when it set no from name", () => {
    expect(alert().text).toContain("SLA alerts are enabled for Acme Support.");
    expect(alert({ senderName: null }).text).toContain("SLA alerts are enabled for your organization.");
  });

  it("escapes policy, customer and ticket names", () => {
    const email = alert({ policyName: "<b>VIP</b> & Co.", customerName: "<i>Acme</i>", ticketName: "<script>alert(1)</script>" });
    expect(email.html).not.toContain("<b>VIP</b>");
    expect(email.html).not.toContain("<script>alert(1)</script>");
    expect(email.html).toContain("&lt;b&gt;VIP&lt;/b&gt; &amp; Co.");
  });

  it("keeps a customer name containing a line break out of the subject header", () => {
    expect(alert({ customerName: "Acme\r\nBcc: evil@example.com" }).subject).not.toMatch(/[\r\n]/);
  });
});

describe("monthly-report content", () => {
  it("states the period, overview figures, compliance, stages, top customers, link coverage and case list", () => {
    const email = render("monthly-report");
    expect(email.subject).toBe("Acme Support: SLA report for September 2026");
    for (const fragment of ["SLA report for September 2026", "Acme Support · Europe/Berlin", "Cases opened: 318", "Breached: 20", "Compliance: 86.7%", "- First response: 90% (90 met, 10 breached)", "- Support: 14 breaches", "- Globex: 7 breaches", "214 of 318", "attached CSV lists the first 500 breaches of 612", "View breached cases: https://app.example.com/cases?breached=1"]) {
      expect(email.text, fragment).toContain(fragment);
    }
  });

  it("renders the empty states", () => {
    const email = render("monthly-report", { ...TEMPLATE_FIXTURES["monthly-report"], stages: [], topCustomers: [], csvNote: null, caseListUrl: null });
    expect(email.text).toContain("No breaches this month.");
    expect(email.text).toContain("None.");
    expect(email.text).not.toContain("attached CSV lists");
    expect(email.html).not.toContain("View breached cases");
  });

  it("uses neutral language: where time was spent, never who is at fault", () => {
    const { html, text } = render("monthly-report");
    for (const output of [html, text]) expect(output).not.toMatch(/\b(blame|fault|responsible|culprit|negligen\w*)\b/i);
  });
});
