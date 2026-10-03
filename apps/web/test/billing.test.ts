import { describe, expect, it } from "vitest";
import {
  daysBetween,
  formatBillingDateTime,
  formatCount,
  formatHoursMinutes,
  formatMoney,
  formatPercent,
  formatRate,
  percentOf,
} from "../src/lib/billing-format";
import { countInvoicesByStatus, filterInvoices, invoiceYears, invoicesToCsv, sumInvoices } from "../src/lib/billing-invoices";
import { adminBillingActionSchema, billingAccountSchema, subscriptionActionSchema } from "../src/lib/billing-validation";
import type { BillingInvoice } from "../src/lib/types/billing";

function invoice(overrides: Partial<BillingInvoice>): BillingInvoice {
  return {
    id: "inv",
    number: "INV-2026-001",
    periodStart: "2026-01-28T00:00:00.000Z",
    periodEnd: "2026-02-28T00:00:00.000Z",
    description: "Team Plan · 20 Seats",
    detail: "Recurring contract · Monthly",
    detailHighlighted: false,
    amountCents: 14_900,
    currency: "USD",
    status: "paid",
    paymentMethodLabel: "Recorded payment",
    issuedAt: "2026-01-28T00:00:00.000Z",
    dueAt: "2026-02-11T00:00:00.000Z",
    paidAt: "2026-01-28T00:07:00.000Z",
    reference: "inv_1",
    ...overrides,
  };
}

describe("billing format", () => {
  it("formats money, rates and the custom price", () => {
    expect(formatMoney(14_900)).toBe("$149.00");
    expect(formatMoney(135_600)).toBe("$1,356.00");
    expect(formatMoney(null)).toBe("Custom");
    expect(formatRate(479_000, "year")).toBe("$4,790.00/yr");
    expect(formatRate(14_900, "month")).toBe("$149.00/mo");
  });

  it("formats counts and ratios compactly", () => {
    expect(formatCount(41_894)).toBe("41.9k");
    expect(formatCount(100_000)).toBe("100k");
    expect(formatCount(2_400_000)).toBe("2.4M");
    expect(formatCount(812)).toBe("812");
    expect(formatPercent(41_894, 100_000)).toBe("41.9%");
    expect(percentOf(7, 10)).toBe(70);
    expect(percentOf(12, 10)).toBe(100);
    expect(percentOf(3, null)).toBe(0);
  });

  it("formats UTC timestamps and spans", () => {
    expect(formatBillingDateTime("2026-09-28T00:14:00.000Z")).toBe("Sep 28, 2026 00:14 UTC");
    expect(formatHoursMinutes(68 * 3_600_000 + 12 * 60_000)).toBe("68h 12m");
    expect(formatHoursMinutes(-5)).toBe("0m");
    expect(daysBetween("2026-10-01T23:00:00Z", "2026-10-03T01:00:00Z")).toBe(2);
  });
});

describe("invoice ledger controls", () => {
  const invoices = [
    invoice({ id: "a", number: "INV-2026-009", periodStart: "2026-09-28T00:00:00.000Z" }),
    invoice({ id: "b", number: "INV-2026-008", periodStart: "2026-08-28T00:00:00.000Z", status: "open", amountCents: 16_400, paidAt: null }),
    invoice({ id: "c", number: "INV-2025-012", periodStart: "2025-12-28T00:00:00.000Z" }),
  ];

  it("filters by year, status and search", () => {
    expect(filterInvoices(invoices, { year: 2026, status: "all", query: "" }).map((i) => i.id)).toEqual(["a", "b"]);
    expect(filterInvoices(invoices, { year: 2026, status: "open", query: "" }).map((i) => i.id)).toEqual(["b"]);
    expect(filterInvoices(invoices, { year: 2026, status: "all", query: "009" }).map((i) => i.id)).toEqual(["a"]);
    expect(filterInvoices(invoices, { year: 2025, status: "all", query: "" }).map((i) => i.id)).toEqual(["c"]);
  });

  it("counts statuses per year, offers recent years, and sums only paid invoices", () => {
    expect(countInvoicesByStatus(invoices, 2026)).toMatchObject({ all: 2, paid: 1, open: 1 });
    expect(invoiceYears(invoices, 2026)).toEqual([2026, 2025, 2024]);
    expect(sumInvoices(invoices.slice(0, 2))).toBe(14_900);
  });

  it("exports CSV with a header and one row per invoice", () => {
    const lines = invoicesToCsv(invoices.slice(0, 1)).trim().split("\r\n");
    expect(lines[0]).toContain("Invoice");
    expect(lines[1]).toContain("INV-2026-009");
    expect(lines[1]).toContain("149.00");
  });
});

describe("billing request validation", () => {
  it("accepts only known subscription actions with whole, bounded seats and a version", () => {
    expect(subscriptionActionSchema.safeParse({ action: "start", plan: "team" }).success).toBe(true);
    expect(subscriptionActionSchema.safeParse({ action: "start", plan: "gold" }).success).toBe(false);
    expect(subscriptionActionSchema.safeParse({ action: "change_seats", seatQuantity: 2.5, expectedVersion: 1 }).success).toBe(false);
    expect(subscriptionActionSchema.safeParse({ action: "change_seats", seatQuantity: 0, expectedVersion: 1 }).success).toBe(false);
    expect(subscriptionActionSchema.safeParse({ action: "cancel" }).success).toBe(false);
    expect(subscriptionActionSchema.safeParse({ action: "resume", expectedVersion: -1 }).success).toBe(false);
  });

  it("normalizes the billing profile and rejects bad emails", () => {
    const parsed = billingAccountSchema.parse({ billingEmail: " AP@Acme.Test ", legalName: "  ", addressLines: ["1 Main", " "], ccEmails: [] });
    expect(parsed).toMatchObject({ billingEmail: "ap@acme.test", legalName: null, addressLines: ["1 Main"], country: null, taxId: null });
    expect(billingAccountSchema.safeParse({ billingEmail: "nope" }).success).toBe(false);
    expect(billingAccountSchema.safeParse({ ccEmails: Array(6).fill("a@b.co") }).success).toBe(false);
  });

  it("requires an operator rationale for every override but a note", () => {
    expect(adminBillingActionSchema.safeParse({ action: "grant_grace", rationale: "too short" }).success).toBe(false);
    expect(adminBillingActionSchema.safeParse({ action: "grant_grace", rationale: "Customer asked for a week" }).success).toBe(true);
    expect(adminBillingActionSchema.safeParse({ action: "add_note", note: "Called the CFO" }).success).toBe(true);
  });
});
