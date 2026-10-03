import { z } from "zod";
import { MAX_SEAT_QUANTITY } from "@sla/db";
import { PLAN_IDS } from "@sla/db/plans";

/**
 * Untrusted billing request bodies, validated before they reach the domain.
 * Only intent travels from the browser (which plan, how many seats, which
 * version the page saw); organization, prices and limits are resolved on the
 * server from the session and `PLANS`.
 */

const version = z.number({ message: "expectedVersion is required" }).int().min(0);
const plan = z.enum(PLAN_IDS, { message: `plan must be one of: ${PLAN_IDS.join(", ")}` });
const seats = z
  .number({ message: "seatQuantity must be a number" })
  .int("Seats must be a whole number")
  .min(1, "At least one seat must be licensed")
  .max(MAX_SEAT_QUANTITY, `At most ${MAX_SEAT_QUANTITY} seats`);

export const subscriptionActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), plan, seatQuantity: seats.optional() }),
  z.object({ action: z.literal("change_plan"), plan, expectedVersion: version }),
  z.object({ action: z.literal("change_seats"), seatQuantity: seats, expectedVersion: version }),
  z.object({ action: z.literal("cancel"), expectedVersion: version }),
  z.object({ action: z.literal("resume"), expectedVersion: version }),
]);
export type SubscriptionActionInput = z.infer<typeof subscriptionActionSchema>;

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be at most ${max} characters`)
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .default(null);

const email = z.string().trim().toLowerCase().email("Enter a valid email address").max(254);

export const billingAccountSchema = z.object({
  billingEmail: email.nullable().or(z.literal("").transform(() => null)).default(null),
  legalName: optionalText(200, "Legal name"),
  addressLines: z
    .array(z.string().trim().max(200, "Address lines must be at most 200 characters"))
    .max(4, "At most 4 address lines")
    .default([])
    .transform((lines) => lines.filter((line) => line !== "")),
  country: optionalText(16, "Country"),
  taxId: optionalText(40, "Tax ID"),
  ccEmails: z.array(email).max(5, "At most 5 extra recipients").default([]),
});
export type BillingAccountFormInput = z.input<typeof billingAccountSchema>;

export const providerSessionSchema = z.object({ kind: z.enum(["portal", "payment_method"]) });

/** Operator overrides on one tenant. Every one but a note needs a written rationale for the audit log. */
const rationale = z.string().trim().min(10, "Give a rationale of at least 10 characters").max(1000);

export const adminBillingActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("change_plan"), plan, expectedVersion: version, rationale }),
  z.object({ action: z.literal("grant_grace"), rationale }),
  z.object({ action: z.literal("mark_paid"), invoiceId: z.string().min(1).max(64), rationale }),
  z.object({ action: z.literal("void_invoice"), invoiceId: z.string().min(1).max(64), rationale }),
  z.object({ action: z.literal("comp_open_invoices"), rationale }),
  z.object({ action: z.literal("retry_charge"), invoiceId: z.string().min(1).max(64) }),
  z.object({ action: z.literal("add_note"), note: z.string().trim().min(1, "A note cannot be empty").max(1000) }),
  z.object({ action: z.literal("reconcile") }),
]);
export type AdminBillingActionInput = z.infer<typeof adminBillingActionSchema>;
