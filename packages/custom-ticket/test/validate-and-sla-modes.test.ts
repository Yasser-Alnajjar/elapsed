/**
 * "SLA modes", "SLA exclusion" and request-designation rows of plan 09 §13 at the
 * configuration level: what validation allows, what it marks unsupported, and
 * how the reply rules behave in each mode.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { deriveBatch, type RawRow } from "../src/derive";
import { parseConfig, type CustomConfig } from "../src/schema";
import { RAW_PREFIX } from "../src/shared";
import { storedSlaSupport, validateConfig } from "../src/validate";

const mock = JSON.parse(readFileSync(fileURLToPath(new URL("../dev/mock-helpdesk-config.json", import.meta.url)), "utf8"));

function build(patch: (c: Record<string, any>) => void = () => {}): { config: CustomConfig | null; issues: unknown } {
  const draft = structuredClone(mock) as Record<string, any>;
  patch(draft);
  const parsed = parseConfig(draft);
  return parsed.ok ? { config: parsed.config, issues: null } : { config: null, issues: parsed.issues };
}
function cfg(patch: (c: Record<string, any>) => void = () => {}): CustomConfig {
  const { config, issues } = build(patch);
  if (!config) throw new Error(`config invalid: ${JSON.stringify(issues)}`);
  return config;
}
const codes = (config: CustomConfig, options?: { allowPrivateHosts?: boolean }) => validateConfig(config, options).diagnostics.map((d) => `${d.severity}:${d.code}`);

describe("the reference configuration", () => {
  it("validates, supports every kind, and stores no exclusion", () => {
    const report = validateConfig(cfg(), { allowPrivateHosts: true });
    expect(report.ok).toBe(true);
    expect(report.support.first_response.state).toBe("supported");
    expect(report.support.next_reply.state).toBe("supported");
    expect(report.support.resolution.state).toBe("supported");
    expect(storedSlaSupport(report)).toBeNull(); // null slaSupport = behaves exactly as today
  });
});

describe("SLA modes: Full SLA versus Resolution-only", () => {
  it("Resolution-only marks first response and next reply unsupported, individually stored", () => {
    const report = validateConfig(cfg((c) => (c.slaMode = "resolution_only")), { allowPrivateHosts: true });
    expect(report.support.first_response).toEqual({ state: "unsupported", reasons: ["resolution_only_mode"] });
    expect(report.support.next_reply).toEqual({ state: "unsupported", reasons: ["resolution_only_mode"] });
    expect(report.support.resolution.state).not.toBe("unsupported");
    expect(storedSlaSupport(report)?.unsupportedKinds.sort()).toEqual(["first_response", "next_reply"]);
    expect(report.ok).toBe(true);
  });

  it("with no history source, resolution is supported with a limitation and the pause limitation is stated", () => {
    const report = validateConfig(cfg((c) => delete c.statusHistory), { allowPrivateHosts: true });
    expect(report.support.resolution.state).toBe("supported_with_limitations");
    expect(report.support.resolution.reasons).toContain("no_status_history_customer_wait_not_applied");
    expect(report.stored.limitations).toContain("no_status_history");
    expect(storedSlaSupport(report)).not.toBeNull();
  });

  it("Full SLA needs a comment source, an author-role mapping and a creation actor, each reported by name", () => {
    const noComments = validateConfig(cfg((c) => { delete c.comments; delete c.commentMapping; }), { allowPrivateHosts: true });
    expect(noComments.support.first_response.reasons).toContain("no_comments_source");
    expect(noComments.ok).toBe(false);

    const noRole = validateConfig(cfg((c) => delete c.valueMaps.authorRole), { allowPrivateHosts: true });
    expect(noRole.support.next_reply.reasons).toContain("no_author_role_mapping");

    const noActor = validateConfig(cfg((c) => delete c.creationActor), { allowPrivateHosts: true });
    expect(noActor.support.first_response.reasons).toContain("no_creation_actor");
  });

  it("no visibility field and no acknowledgement blocks Full SLA, and the acknowledgement is never defaulted (Q7)", () => {
    const blocked = validateConfig(cfg((c) => delete c.commentMapping.isPublic), { allowPrivateHosts: true });
    expect(blocked.support.first_response).toEqual({ state: "unsupported", reasons: ["comment_visibility_not_acknowledged"] });
    expect(blocked.ok).toBe(false);
    expect(blocked.diagnostics).toContainEqual({ severity: "error", code: "comment_visibility_not_acknowledged", path: "slaMode" });
    const acknowledged = validateConfig(cfg((c) => { delete c.commentMapping.isPublic; c.commentVisibilityAcknowledged = { userId: "owner-1", at: "2026-10-10T10:00:00Z" }; }), { allowPrivateHosts: true });
    expect(acknowledged.support.first_response.state).toBe("supported");
    // the parsed config of a document that never mentions the field must not carry it
    expect(cfg((c) => delete c.commentMapping.isPublic).commentVisibilityAcknowledged).toBeFalsy();
  });

  it("assuming the customer as creator is allowed but warned as asserted, not derived", () => {
    expect(codes(cfg((c) => (c.creationActor = { type: "assume_customer" })), { allowPrivateHosts: true })).toContain("warning:creation_actor_asserted_not_derived");
  });

  it("resolution without a terminal status or a closure timestamp is unsupported: an error in Resolution-only, a warning in Full", () => {
    const noClosure = (mode: string) => cfg((c) => { c.slaMode = mode; delete c.mapping.closedAt; delete c.statusHistory; });
    expect(codes(noClosure("resolution_only"), { allowPrivateHosts: true })).toContain("error:resolution_blocked_no_closure_timestamp");
    expect(codes(noClosure("full"), { allowPrivateHosts: true })).toContain("warning:resolution_blocked_no_closure_timestamp");
    expect(validateConfig(noClosure("full"), { allowPrivateHosts: true }).support.resolution.state).toBe("unsupported");
    const noTerminal = cfg((c) => (c.valueMaps.status = { new: "new", open: "open" }));
    expect(validateConfig(noTerminal, { allowPrivateHosts: true }).support.resolution.reasons).toEqual(["no_terminal_status_mapped"]);
  });
});

describe("request designation and destination rules at validation (§8.3, §13 SSRF row)", () => {
  const post = (extra: Record<string, unknown> = {}) => (c: Record<string, any>) => {
    c.tickets.request = { method: "POST", path: "/v2/search", body: { q: "{{updatedSince}}" }, ...extra };
  };

  it("a POST must be explicitly designated read-only; a GET must not carry a body or the designation", () => {
    const undesignated = cfg((c) => { post()(c); c.tickets.incremental = { format: "iso8601", lookbackSeconds: 300 }; });
    expect(codes(undesignated, { allowPrivateHosts: true })).toContain("error:post_requires_read_only_designation");
    const designated = cfg((c) => { post({ readOnlySearch: true })(c); c.tickets.incremental = { format: "iso8601", lookbackSeconds: 300 }; });
    expect(codes(designated, { allowPrivateHosts: true })).not.toContain("error:post_requires_read_only_designation");
    expect(build((c) => (c.tickets.request.readOnlySearch = false)).config).toBeNull(); // only the literal true is accepted
    expect(codes(cfg((c) => (c.tickets.request.readOnlySearch = true)), { allowPrivateHosts: true })).toContain("error:read_only_designation_on_get");
  });

  it("a ticket-detail request must be GET", () => {
    const detail = cfg((c) => (c.ticketDetail = { request: { method: "POST", path: "/v2/tickets/{{ticket.id}}", readOnlySearch: true } }));
    expect(codes(detail, { allowPrivateHosts: true })).toContain("error:ticket_detail_must_be_get");
  });

  it("refuses private, IP-literal, non-HTTPS and non-origin base URLs unless the deployment switch is on", () => {
    for (const baseUrl of ["https://127.0.0.1", "https://localhost", "http://api.example.com", "https://api.example.com:8443", "https://10.0.0.5", "https://metadata.google.internal"]) {
      expect(codes(cfg((c) => (c.connection.baseUrl = baseUrl))), baseUrl).toContain("error:destination_not_allowed");
    }
    expect(codes(cfg((c) => (c.connection.baseUrl = "https://api.example.com/v2")))).toContain("error:base_url_must_be_an_origin");
    expect(codes(cfg((c) => (c.connection.baseUrl = "https://api.example.com")))).not.toContain("error:destination_not_allowed");
  });

  it("rejects credential-looking query keys, template variables that would change the host, and unknown variables", () => {
    expect(build((c) => (c.tickets.request.query = { api_key: "abc" })).config).toBeNull();
    expect(build((c) => (c.tickets.request.query = { token: "{{cursor}}" })).config).toBeNull();
    expect(build((c) => (c.tickets.request.path = "/v2/{{hostname}}")).config).toBeNull();
    expect(build((c) => (c.tickets.request.headers = { "X-Forwarded-For": "1.2.3.4" })).config).toBeNull();
    expect(build((c) => (c.tickets.request.headers = { Host: "evil.com" })).config).toBeNull();
  });

  it("template variables are never substituted into the host: a brace host stays literal (validation accepts it, DNS then fails; recorded as a low-severity validation gap)", () => {
    const braces = cfg((c) => (c.connection.baseUrl = "https://{{ticket.id}}.example.com"));
    expect(braces.connection.baseUrl).toBe("https://{{ticket.id}}.example.com");
    const report = validateConfig(braces, { allowPrivateHosts: false });
    expect(report.diagnostics.map((d) => d.code)).not.toContain("destination_not_allowed"); // current behavior; a literal host cannot be steered by ticket data
  });

  it("incremental sync needs the updatedSince placeholder and vice versa", () => {
    expect(codes(cfg((c) => (c.tickets.request.query = { per_page: "{{limit}}" })))).toContain("error:incremental_without_placeholder");
    expect(codes(cfg((c) => delete c.tickets.incremental), { allowPrivateHosts: true })).toContain("error:placeholder_without_incremental");
  });

  it("a verified-404 deletion check needs a ticket-detail request", () => {
    expect(codes(cfg((c) => (c.deletion = { verifyWithDetail: true })), { allowPrivateHosts: true })).toContain("error:verify_with_detail_needs_ticket_detail");
  });

  it("warns, and does not block, when there is no incremental cursor (activation then needs a single-run listing)", () => {
    const report = validateConfig(cfg((c) => { delete c.tickets.incremental; c.tickets.request.query = { per_page: "{{limit}}" }; }), { allowPrivateHosts: true });
    expect(report.diagnostics.map((d) => `${d.severity}:${d.code}`)).toContain("warning:no_incremental_cursor_activation_needs_single_run_listing");
  });

  it("requires exactly one {id} in the ticket link template and a public host", () => {
    for (const ticketUrlTemplate of ["https://helpdesk.example.test/tickets", "https://helpdesk.example.test/{id}/{id}", "https://127.0.0.1/{id}", "https://u:p@helpdesk.example.test/{id}"]) {
      expect(codes(cfg((c) => (c.ticketUrlTemplate = ticketUrlTemplate)), { allowPrivateHosts: false }), ticketUrlTemplate).toContain("error:invalid_ticket_url_template");
    }
  });
});

describe("reply derivation (§13 SLA modes row): private notes never count, the opening message is not a reply", () => {
  const fetched = new Date("2026-10-01T00:00:00Z");
  const ticketRow: RawRow = {
    id: "r0",
    providerEventId: `${RAW_PREFIX.ticket}T-1:h`,
    payload: { id: "T-1", created_at: "2026-09-01T10:00:00Z", updated_at: "2026-09-01T12:00:00Z", state: "open", subject: "s", priority: "p1" },
    fetchedAt: fetched,
  };
  const comment = (id: string, at: string, role: "requester" | "agent", pub: boolean | null, n: number): RawRow => ({
    id: `c${n}`,
    providerEventId: `${RAW_PREFIX.comment}T-1:${id}:h`,
    payload: { t: "T-1", i: { id, at, author: { type: role }, ...(pub === null ? {} : { public: pub }) } },
    fetchedAt: fetched,
  });
  const run = (config: CustomConfig, ...rows: RawRow[]) => deriveBatch(config, [ticketRow, ...rows]);
  const types = (b: ReturnType<typeof deriveBatch>) => b.eventGroups[0]!.events.map((e) => e.type);

  it("a customer comment within a minute of creation is the opening message, later public comments are replies, private ones are ignored", () => {
    const batch = run(
      cfg((c) => (c.creationActor = { type: "assume_customer" })),
      comment("c1", "2026-09-01T10:00:20Z", "requester", true, 1),
      comment("c2", "2026-09-01T10:30:00Z", "agent", true, 2),
      comment("c3", "2026-09-01T10:40:00Z", "agent", false, 3), // internal note: never counts
      comment("c4", "2026-09-01T11:00:00Z", "requester", true, 4),
    );
    expect(types(batch)).toEqual(["case_created", "agent_replied", "customer_replied"]);
    expect(batch.failures).toEqual([]);
  });

  it("an unknown visibility is skipped with a diagnostic, never counted as public", () => {
    const batch = run(cfg((c) => (c.creationActor = { type: "assume_customer" })), comment("c2", "2026-09-01T10:30:00Z", "agent", null, 2));
    expect(types(batch)).toEqual(["case_created"]);
    expect(batch.diagnostics).toContainEqual({ id: "T-1", code: "unknown_visibility" });
  });

  it("the creation actor can come from the first comment's author, or fail the record when it cannot be derived (Full SLA)", () => {
    const fromComment = run(cfg((c) => (c.creationActor = { type: "first_comment_author" })), comment("c1", "2026-09-01T10:00:20Z", "agent", true, 1));
    expect(fromComment.eventGroups[0]!.events[0]).toMatchObject({ type: "case_created", actor: "agent" });
    const unknown = run(cfg((c) => (c.creationActor = { type: "first_comment_author" })));
    expect(unknown.failures[0]).toMatchObject({ id: "T-1", code: "creation_actor_unknown" });
  });

  it("an unknown author role never creates a reply event", () => {
    const strange: RawRow = { ...comment("c9", "2026-09-01T10:30:00Z", "agent", true, 9), payload: { t: "T-1", i: { id: "c9", at: "2026-09-01T10:30:00Z", author: { type: "bot" }, public: true } } };
    const batch = run(cfg((c) => (c.creationActor = { type: "assume_customer" })), strange);
    expect(types(batch)).toEqual(["case_created"]);
  });
});
