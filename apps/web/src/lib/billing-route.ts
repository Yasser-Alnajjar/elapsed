import { NextResponse } from "next/server";
import { BillingError, type BillingErrorCode } from "@sla/db";
import type { ZodError } from "zod";

/** HTTP status per refused billing operation. */
const STATUS: Record<BillingErrorCode, number> = {
  invalid_input: 400,
  not_found: 404,
  invalid_transition: 409,
  conflict: 409,
  invalid_plan: 422,
  invalid_seats: 422,
  contact_sales: 422,
  provider_unavailable: 501,
};

/** The typed error body every billing route returns: `{ error, code }`. */
export function billingErrorResponse(error: unknown): NextResponse | null {
  if (!(error instanceof BillingError)) return null;
  return NextResponse.json({ error: error.message, code: error.code }, { status: STATUS[error.code] });
}

export function invalidInputResponse(error: ZodError): NextResponse {
  return NextResponse.json({ error: error.issues[0]?.message ?? "Invalid input", code: "invalid_input" }, { status: 400 });
}
