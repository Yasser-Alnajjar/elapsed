/**
 * The wizard's POST read-only confirmation (Formik + Yup): Save draft, Next and the
 * step tabs all stop on `confirmationErrors(...)`, and the same rule is enforced
 * by the server when a draft is saved (`unconfirmedPostEndpoints`).
 */
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { validateYupSchema, yupToFormErrors } from "formik";
import { describe, expect, it } from "vitest";
import { unconfirmedPostEndpoints } from "@sla/custom-ticket";
import { StepTickets } from "@/modules/settings/custom-provider/csr/StepTickets";
import { emptyConfig, editTicketsRequest, setIn } from "@/lib/custom-provider/wizard";
import { POST_CONFIRMATION_MESSAGE, confirmationErrors, customConfigFormSchema } from "@/lib/custom-provider/wizard-schema";

type Doc = ReturnType<typeof emptyConfig>;

/** What Formik computes before it will call onSubmit. */
async function formErrors(config: Doc): Promise<Record<string, unknown>> {
  try {
    await validateYupSchema({ config, secrets: {}, json: "" }, customConfigFormSchema);
    return {};
  } catch (error) {
    return yupToFormErrors(error);
  }
}
const withTickets = (request: Record<string, unknown>): Doc => setIn(emptyConfig(), ["tickets", "request"], request);
const post = (extra: Record<string, unknown> = {}) => withTickets({ method: "POST", path: "/v2/search", body: { q: "x" }, ...extra });

describe("an unconfirmed POST blocks Save draft and Next", () => {
  it("returns the message at the ticket request's confirmation field", async () => {
    const errors = await formErrors(post());
    expect(confirmationErrors(errors)).toEqual([POST_CONFIRMATION_MESSAGE]);
    expect((errors as any).config.tickets.request.readOnlySearch).toBe(POST_CONFIRMATION_MESSAGE);
  });

  it("a confirmation of false is not a confirmation", async () => {
    expect(confirmationErrors(await formErrors(post({ readOnlySearch: false })))).toEqual([POST_CONFIRMATION_MESSAGE]);
  });

  it("a confirmed POST is allowed through", async () => {
    expect(confirmationErrors(await formErrors(post({ readOnlySearch: true })))).toEqual([]);
  });

  it("covers the other request sections too", async () => {
    const config = setIn(post({ readOnlySearch: true }), ["comments"], { request: { method: "POST", path: "/t/{{ticket.id}}/c" } });
    expect(confirmationErrors(await formErrors(config))).toEqual([POST_CONFIRMATION_MESSAGE]);
  });

  it("an edit after confirming needs a new confirmation", async () => {
    const confirmed = { method: "POST", path: "/v2/search", body: { q: "x" }, readOnlySearch: true };
    expect(confirmationErrors(await formErrors(withTickets(confirmed)))).toEqual([]);
    for (const patch of [{ path: "/v2/other" }, { body: { q: "y" } }, { query: { a: "1" } }]) {
      expect(confirmationErrors(await formErrors(withTickets(editTicketsRequest(confirmed, patch))))).toEqual([POST_CONFIRMATION_MESSAGE]);
    }
    const backToGet = editTicketsRequest(confirmed, { method: "GET" });
    expect(confirmationErrors(await formErrors(withTickets(backToGet)))).toEqual([]);
    expect(confirmationErrors(await formErrors(withTickets(editTicketsRequest(backToGet, { method: "POST" }))))).toEqual([POST_CONFIRMATION_MESSAGE]);
  });
});

describe("GET is unchanged", () => {
  it("raises no confirmation error, with or without other fields, and an incomplete draft still passes the gate", async () => {
    expect(confirmationErrors(await formErrors(emptyConfig()))).toEqual([]);
    expect(confirmationErrors(await formErrors(withTickets({ method: "GET", path: "/tickets", query: { a: "1" } })))).toEqual([]);
    const incomplete = { schemaVersion: 1, tickets: { request: { method: "GET" } } } as unknown as Doc;
    expect(confirmationErrors(await formErrors(incomplete))).toEqual([]);
  });
});

describe("the browser and the server apply the same rule", () => {
  const cases: [string, unknown][] = [
    ["GET", emptyConfig()],
    ["unconfirmed POST", post()],
    ["POST with false", post({ readOnlySearch: false })],
    ["confirmed POST", post({ readOnlySearch: true })],
    ["unconfirmed POST in comments", setIn(emptyConfig(), ["comments"], { request: { method: "POST", path: "/c" } })],
    ["confirmed POST in history", setIn(emptyConfig(), ["statusHistory"], { request: { method: "POST", path: "/h", readOnlySearch: true } })],
    ["incomplete draft", { tickets: { request: { method: "GET" } } }],
    ["empty document", {}],
  ];
  it.each(cases)("%s", async (_name, config) => {
    const browserBlocks = confirmationErrors(await formErrors(config as Doc)).length > 0;
    const serverBlocks = unconfirmedPostEndpoints(config).length > 0;
    expect(browserBlocks).toBe(serverBlocks);
  });
});

describe("the inline error next to the checkbox", () => {
  const props = (config: Doc, postConfirmationError?: string) => ({ config, set: () => {}, paths: [], secretsSet: [], secrets: {}, setSecret: () => {}, userId: "u", postConfirmationError });

  it("shows the message as an alert tied to the checkbox", () => {
    const html = renderToString(createElement(StepTickets, props(post(), POST_CONFIRMATION_MESSAGE)));
    expect(html).toContain(POST_CONFIRMATION_MESSAGE);
    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-describedby="cp-readonly-error"');
  });

  it("shows no error before the owner tries to continue, and none for a GET", () => {
    expect(renderToString(createElement(StepTickets, props(post())))).not.toContain('role="alert"');
    const get = renderToString(createElement(StepTickets, props(emptyConfig())));
    expect(get).not.toContain("cp-readonly");
    expect(get).not.toContain('role="alert"');
  });

  it("says the confirmation is the customer's responsibility and does not claim Elapsed verifies the endpoint", () => {
    const html = renderToString(createElement(StepTickets, props(post())));
    expect(html).toContain("I confirm this POST only searches");
    expect(html).toContain("Elapsed cannot check this itself");
  });
});
