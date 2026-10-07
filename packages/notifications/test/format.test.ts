import { BREACH_NOTIFICATION_THRESHOLD } from "@sla/core";
import { renderEmail } from "@sla/email";
import { describe, expect, it } from "vitest";
import { buildSlaAlertEmail, formatSlackMessage, type EmailBrand, type NotificationContext } from "../src/format";

const baseCandidate = {
  commitmentId: "cmt_1",
  caseId: "case_1",
  kind: "resolution" as const,
  status: "at_risk" as const,
  threshold: 80,
  remainingMinutes: 45,
  policyName: "Urgent SLA",
  targetMinutes: 240,
  startedAt: "2026-09-17T09:00:00.000Z",
};

describe("formatSlackMessage", () => {
  it("names the customer and ticket for an at-risk warning", () => {
    const text = formatSlackMessage(baseCandidate, {
      externalId: "4821",
      customerName: "Acme Co.",
    });
    expect(text).toContain("at risk");
    expect(text).toContain("#4821");
    expect(text).toContain("Acme Co.");
    expect(text).toContain("80%");
    expect(text).toContain("45m");
  });

  it("omits the customer clause when there is none", () => {
    const text = formatSlackMessage(baseCandidate, {
      externalId: "4821",
      customerName: null,
    });
    expect(text).not.toContain("for ");
    expect(text).toContain("#4821");
  });

  it("distinguishes first_response from resolution", () => {
    const text = formatSlackMessage(
      { ...baseCandidate, kind: "first_response" },
      {
        externalId: "1",
        customerName: null,
      },
    );
    expect(text).toContain("First response");
  });

  it("labels a next_reply candidate as Next reply", () => {
    const text = formatSlackMessage(
      { ...baseCandidate, kind: "next_reply" },
      {
        externalId: "1",
        customerName: null,
      },
    );
    expect(text).toContain("Next reply");
  });

  it("reports a breach with elapsed-over time, not remaining time", () => {
    const text = formatSlackMessage(
      {
        ...baseCandidate,
        status: "breached",
        threshold: BREACH_NOTIFICATION_THRESHOLD,
        breachedByMinutes: 130,
      },
      { externalId: "4821", customerName: "Acme Co." },
    );
    expect(text).toContain("breached");
    expect(text).toContain("2h 10m");
    expect(text).not.toContain("%");
  });

  it("includes the policy name, target, and start time (3.9)", () => {
    const text = formatSlackMessage(baseCandidate, {
      externalId: "4821",
      customerName: "Acme Co.",
    });
    expect(text).toContain("Policy: Urgent SLA");
    expect(text).toContain("Target: 4h");
    expect(text).toContain("Started: Sep 17, 2026, 09:00 UTC");
  });

  it("includes the exact breach time only once breached", () => {
    const atRisk = formatSlackMessage(baseCandidate, {
      externalId: "4821",
      customerName: null,
    });
    expect(atRisk).not.toContain("Breached:");

    const breached = formatSlackMessage(
      {
        ...baseCandidate,
        status: "breached",
        threshold: BREACH_NOTIFICATION_THRESHOLD,
        breachedByMinutes: 130,
        breachedAt: "2026-09-17T13:15:00.000Z",
      },
      { externalId: "4821", customerName: null },
    );
    expect(breached).toContain("Breached: Sep 17, 2026, 13:15 UTC");
  });

  it("includes a case link in Slack mrkdwn syntax only when caseUrl is provided (E-19)", () => {
    const withoutLink = formatSlackMessage(baseCandidate, {
      externalId: "4821",
      customerName: null,
    });
    expect(withoutLink).not.toContain("View ticket");

    const withLink = formatSlackMessage(baseCandidate, {
      externalId: "4821",
      customerName: null,
      caseUrl: "https://app.example.com/cases/case_1",
    });
    expect(withLink).toContain(
      "<https://app.example.com/cases/case_1|View ticket>",
    );
  });
});

/** Builds the alert and renders it through the real Elapsed layout, as the send path does. */
function email(candidate: typeof baseCandidate & Record<string, unknown>, context: NotificationContext, brand?: EmailBrand) {
  const request = buildSlaAlertEmail(candidate as never, context, brand);
  return { request, ...renderEmail(request, { appUrl: null, now: new Date("2026-10-07T00:00:00Z") }) };
}

describe("buildSlaAlertEmail", () => {
  it("is a request for the sla-alert template: data only, no subject, text or markup of its own", () => {
    const { request } = email(baseCandidate, { externalId: "4821", customerName: "Acme Co." });
    expect(request.template).toBe("sla-alert");
    expect(Object.keys(request).sort()).toEqual(["data", "template"]);
  });

  it("names the customer and ticket for an at-risk warning", () => {
    const { subject, text, html } = email(baseCandidate, { externalId: "4821", customerName: "Acme Co." });
    expect(subject).toBe("SLA at risk: Resolution on #4821 (Acme Co.)");
    for (const body of [text, html]) {
      expect(body).toContain("#4821");
      expect(body).toContain("Acme Co.");
      expect(body).toContain("80%");
      expect(body).toContain("45m");
    }
  });

  it("omits the customer clause when there is none", () => {
    const { subject, text, html } = email(baseCandidate, { externalId: "4821", customerName: null });
    expect(subject).not.toContain("(");
    expect(text).toContain("#4821");
    expect(text).not.toContain("Customer:");
    expect(html).not.toContain(">Customer<");
  });

  it("distinguishes first_response from resolution", () => {
    const { subject } = email({ ...baseCandidate, kind: "first_response" }, { externalId: "1", customerName: null });
    expect(subject).toContain("First response");
  });

  it("labels a next_reply candidate as Next reply", () => {
    const { subject, text, html } = email({ ...baseCandidate, kind: "next_reply" }, { externalId: "1", customerName: null });
    for (const body of [subject, text, html]) expect(body).toContain("Next reply");
  });

  it("reports a breach with elapsed-over time, not remaining time", () => {
    const { subject, text, html } = email(
      { ...baseCandidate, status: "breached", threshold: BREACH_NOTIFICATION_THRESHOLD, breachedByMinutes: 130 },
      { externalId: "4821", customerName: "Acme Co." },
    );
    expect(subject).toContain("breached");
    expect(text).toContain("2h 10m");
    expect(text).not.toContain("%");
    expect(html).toContain("2h 10m");
    expect(html).toContain("SLA breached");
  });

  it("always renders in the Elapsed shell, and names the organization only in the footer when it has a from name", () => {
    const context = { externalId: "4821", customerName: null };
    const plain = email(baseCandidate, context);
    expect(plain.html).toContain('data-elapsed-email="shell"');
    expect(plain.text).toContain("SLA alerts are enabled for your organization.");

    const branded = email(baseCandidate, context, { name: "Acme Support" });
    expect(branded.html).toContain('data-elapsed-email="shell"');
    expect(branded.html).toContain("Elapsed");
    expect(branded.text).toContain("SLA alerts are enabled for Acme Support.");
    // The organization's name never replaces the Elapsed wordmark.
    expect(branded.html).toContain('alt="Elapsed"');
  });

  it("renders a ticket link only when a caseUrl is provided", () => {
    const withoutLink = email(baseCandidate, { externalId: "4821", customerName: null });
    expect(withoutLink.html).not.toContain("View ticket");

    const withLink = email(baseCandidate, { externalId: "4821", customerName: null, caseUrl: "https://app.example.com/cases/case_1" });
    expect(withLink.html).toContain("View ticket");
    expect(withLink.html).toContain("https://app.example.com/cases/case_1");
    expect(withLink.text).toContain("View ticket: https://app.example.com/cases/case_1");
  });

  it("includes the policy name, target, and start time in text and HTML (3.9)", () => {
    const { text, html } = email(baseCandidate, { externalId: "4821", customerName: null });
    expect(text).toContain("Policy: Urgent SLA");
    expect(text).toContain("COMMITTED TARGET: 4h");
    expect(text).toContain("Started: Sep 17, 2026, 09:00 UTC");
    for (const fragment of ["Urgent SLA", "4h", "Sep 17, 2026, 09:00 UTC"]) expect(html).toContain(fragment);
  });

  it("includes the exact breach time only once breached", () => {
    const atRisk = email(baseCandidate, { externalId: "4821", customerName: null });
    expect(atRisk.html).not.toContain("Breached");
    expect(atRisk.text).not.toContain("Breached:");

    const breached = email(
      { ...baseCandidate, status: "breached", threshold: BREACH_NOTIFICATION_THRESHOLD, breachedByMinutes: 130, breachedAt: "2026-09-17T13:15:00.000Z" },
      { externalId: "4821", customerName: null },
    );
    expect(breached.text).toContain("Breached: Sep 17, 2026, 13:15 UTC");
    expect(breached.html).toContain("Sep 17, 2026, 13:15 UTC");
  });

  it("states when the source data is stale", () => {
    const { text } = email({ ...baseCandidate, sourceStaleSince: "2026-09-17T12:00:00.000Z" }, { externalId: "4821", customerName: null });
    expect(text).toContain("Source data stale since: Sep 17, 2026, 12:00 UTC");
  });

  it("escapes a policy name containing HTML special characters", () => {
    const { html } = email({ ...baseCandidate, policyName: "<b>VIP</b> & Co." }, { externalId: "4821", customerName: null });
    expect(html).not.toContain("<b>VIP</b>");
    expect(html).toContain("&lt;b&gt;VIP&lt;/b&gt; &amp; Co.");
  });

  it("escapes a customer name containing HTML special characters", () => {
    const { html } = email(baseCandidate, { externalId: "4821", customerName: "<b>Acme</b> & Co." });
    expect(html).not.toContain("<b>Acme</b>");
    expect(html).toContain("&lt;b&gt;Acme&lt;/b&gt; &amp; Co.");
  });

  it("shows the ticket name with the ticket number when the case has a subject", () => {
    const { html, text } = email(baseCandidate, { externalId: "4821", customerName: null, subject: "Payment webhook failing" });
    expect(html).toContain("Payment webhook failing");
    expect(html).toContain("Ticket #4821");
    expect(text).toContain("Payment webhook failing");
  });

  it("falls back to just the ticket number when the case has no subject", () => {
    const { html } = email(baseCandidate, { externalId: "4821", customerName: null, subject: null });
    expect(html).toContain("#4821");
  });

  it("escapes a ticket name containing HTML special characters", () => {
    const { html } = email(baseCandidate, { externalId: "4821", customerName: null, subject: "<script>alert(1)</script>" });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});
