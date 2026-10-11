import * as Yup from "yup";
import { getIn } from "./wizard";

/**
 * Client-side validation for the Custom REST wizard (Formik + Yup). It states the
 * one rule the server also enforces when a draft is saved
 * (`unconfirmedPostEndpoints` in `@sla/custom-ticket`): a `POST` request must carry
 * the owner's read-only confirmation. Anything else about an incomplete draft is
 * left to the server and to activation. The server is the authority; this only
 * stops the call early and puts the message next to the checkbox.
 */
export const POST_CONFIRMATION_MESSAGE = "Confirm that this POST only searches before you continue.";

const request = Yup.object({
  method: Yup.mixed(),
  readOnlySearch: Yup.mixed().when("method", {
    is: "POST",
    then: (schema) => schema.required(POST_CONFIRMATION_MESSAGE).oneOf([true], POST_CONFIRMATION_MESSAGE),
  }),
})
  .nullable()
  .default(undefined);

const section = Yup.object({ request }).nullable().default(undefined);

export const customConfigFormSchema = Yup.object({
  config: Yup.object({
    tickets: section,
    comments: section,
    ticketDetail: section,
    statusHistory: section,
  }),
});

/** Where each request's confirmation error lives in the Formik errors, in the order the wizard shows them. */
export const CONFIRMATION_ERROR_PATHS = [
  ["config", "tickets", "request", "readOnlySearch"],
  ["config", "comments", "request", "readOnlySearch"],
  ["config", "ticketDetail", "request", "readOnlySearch"],
  ["config", "statusHistory", "request", "readOnlySearch"],
] as const;

/** The confirmation messages in a Formik errors object, in step order. Any message blocks Save draft and moving forward. */
export function confirmationErrors(errors: unknown): string[] {
  return CONFIRMATION_ERROR_PATHS.map((path) => getIn(errors, path)).filter((message): message is string => typeof message === "string");
}
