import { parseHttpsOrigin, type ParsedOrigin } from "@sla/safe-http";
import { secretFieldNames, variablesIn, type CustomConfig, type Expr, type PaginationConfig, type RequestConfig } from "./schema";

export type Severity = "error" | "warning";

export interface Diagnostic {
  severity: Severity;
  /** A fixed code. */
  code: string;
  /** Dotted path into the document. */
  path: string;
}

export type MetricSupport = "supported" | "supported_with_limitations" | "unsupported";

export interface MetricVerdict {
  state: MetricSupport;
  /** Fixed reason codes, in the order they were found. Empty for `supported`. */
  reasons: string[];
}

export interface SlaSupportSummary {
  first_response: MetricVerdict;
  next_reply: MetricVerdict;
  resolution: MetricVerdict;
}

/** What `Integration.slaSupport` stores (plan 09, 5.4). `null` means full support and is what every other provider has. */
export interface StoredSlaSupport {
  unsupportedKinds: ("first_response" | "next_reply" | "resolution")[];
  limitations: string[];
}

export interface ValidationReport {
  diagnostics: Diagnostic[];
  /** True when there is no `error` diagnostic. */
  ok: boolean;
  /** Per-metric verdicts, shown before activation. */
  support: SlaSupportSummary;
  stored: StoredSlaSupport;
  /** Secret fields the owner must supply for this auth type. */
  requiredSecrets: string[];
  /** Mapped status values that mean resolved or closed. */
  terminalStatuses: string[];
}

const TERMINAL = new Set(["resolved", "closed"]);

/** Every source path an expression reads (for the response explorer and diagnostics). */
export function* pathsIn(expr: Expr): Generator<string> {
  if (typeof expr === "string") {
    yield expr;
    return;
  }
  if (expr.transform === "coalesce") for (const part of expr.of) yield* pathsIn(part);
  else if (expr.transform === "template") for (const part of Object.values(expr.values)) yield* pathsIn(part);
  else if (expr.transform === "constant") return;
  else yield* pathsIn(expr.of);
}

function exprDepth(expr: Expr): number {
  if (typeof expr === "string" || expr.transform === "constant") return 1;
  if (expr.transform === "coalesce") return 1 + Math.max(0, ...expr.of.map(exprDepth));
  if (expr.transform === "template") return 1 + Math.max(0, ...Object.values(expr.values).map(exprDepth));
  return 1 + exprDepth(expr.of);
}

function requestVariables(request: RequestConfig): Set<string> {
  const names = new Set<string>();
  const add = (s: string) => variablesIn(s).forEach((v) => names.add(v));
  add(request.path);
  for (const value of Object.values(request.query ?? {})) add(value);
  const walk = (v: unknown) => {
    if (typeof v === "string") add(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v !== null && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(request.body);
  return names;
}

function checkRequest(request: RequestConfig, path: string, allowed: readonly string[], out: Diagnostic[]): void {
  const err = (code: string, sub = "") => out.push({ severity: "error", code, path: `${path}${sub}` });
  if (request.method === "POST") {
    if (request.readOnlySearch !== true) err("post_requires_read_only_designation", ".readOnlySearch");
  } else {
    if (request.body !== undefined) err("get_with_body", ".body");
    if (request.readOnlySearch !== undefined) err("read_only_designation_on_get", ".readOnlySearch");
  }
  for (const name of requestVariables(request)) {
    if (!allowed.includes(name)) err("variable_not_available_here", ".path");
  }
}

function checkPagination(p: PaginationConfig, request: RequestConfig, path: string, out: Diagnostic[]): void {
  if ("in" in p && p.in === "body" && request.method !== "POST") out.push({ severity: "error", code: "body_parameter_on_get", path: `${path}.in` });
  if (p.type === "page" || p.type === "offset" || p.type === "cursor") {
    // The engine sets pagination parameters itself; a template variable for the same thing would be sent twice.
    const used = requestVariables(request);
    const clash = p.type === "page" ? ["page"] : p.type === "offset" ? ["offset"] : ["cursor"];
    if (clash.some((v) => used.has(v))) out.push({ severity: "error", code: "pagination_variable_in_template", path });
  }
}

/** Every path in the document that reads a field of a source record, for the diagnostics that need to know. */
function mappingHasPath(expr: Expr | undefined | null): boolean {
  return expr !== undefined && expr !== null;
}

/**
 * Semantic validation that a schema cannot express (plan 09, 4.2, 5.2, 5.3,
 * 8.3) plus the per-metric SLA verdicts. Pure: no network. The connectivity
 * and sample checks run in the API layer.
 */
export function validateConfig(config: CustomConfig, options: { allowPrivateHosts?: boolean } = {}): ValidationReport {
  const out: Diagnostic[] = [];
  const err = (code: string, path: string) => out.push({ severity: "error", code, path });
  const warn = (code: string, path: string) => out.push({ severity: "warning", code, path });

  // Connection and ticket-link host.
  let origin: ParsedOrigin | null = null;
  try {
    origin = parseHttpsOrigin(config.connection.baseUrl, { allowPrivateHosts: options.allowPrivateHosts ?? false });
    const asUrl = new URL(config.connection.baseUrl);
    if ((asUrl.pathname !== "/" && asUrl.pathname !== "") || asUrl.search !== "" || asUrl.hash !== "") err("base_url_must_be_an_origin", "connection.baseUrl");
  } catch {
    err("destination_not_allowed", "connection.baseUrl");
  }
  if (config.ticketUrlTemplate) {
    try {
      const template = config.ticketUrlTemplate;
      if ((template.match(/\{id\}/g) ?? []).length !== 1) throw new Error("id");
      const probe = new URL(template.replace("{id}", "1"));
      parseHttpsOrigin(probe.origin, { allowPrivateHosts: options.allowPrivateHosts ?? false });
      if (probe.username || probe.password) throw new Error("userinfo");
    } catch {
      err("invalid_ticket_url_template", "ticketUrlTemplate");
    }
  }

  // Requests: methods, variables.
  const ticketVars = ["updatedSince", "cursor", "page", "offset", "limit"];
  checkRequest(config.tickets.request, "tickets.request", ticketVars, out);
  checkPagination(config.tickets.pagination, config.tickets.request, "tickets.pagination", out);
  const listVars = ["ticket.id", "cursor", "page", "offset", "limit"];
  if (config.comments?.request) {
    checkRequest(config.comments.request, "comments.request", listVars, out);
    checkPagination(config.comments.pagination, config.comments.request, "comments.pagination", out);
    if (!variablesIn(config.comments.request.path).includes("ticket.id") && !Object.values(config.comments.request.query ?? {}).some((v) => variablesIn(v).includes("ticket.id"))) {
      err("child_request_without_ticket_id", "comments.request");
    }
  }
  if (config.ticketDetail) {
    checkRequest(config.ticketDetail.request, "ticketDetail.request", ["ticket.id"], out);
    if (config.ticketDetail.request.method !== "GET") err("ticket_detail_must_be_get", "ticketDetail.request.method");
  }
  if (config.statusHistory) {
    checkRequest(config.statusHistory.request, "statusHistory.request", listVars, out);
    checkPagination(config.statusHistory.pagination, config.statusHistory.request, "statusHistory.pagination", out);
  }

  // Incremental sync: the placeholder and the configuration must agree.
  const usesUpdatedSince = requestVariables(config.tickets.request).has("updatedSince");
  if (config.tickets.incremental && !usesUpdatedSince) err("incremental_without_placeholder", "tickets.incremental");
  if (!config.tickets.incremental && usesUpdatedSince) err("placeholder_without_incremental", "tickets.request");
  const incrementalCursor = Boolean(config.tickets.incremental);

  // Expression nesting.
  const exprs: [string, Expr | undefined | null][] = [
    ...Object.entries(config.mapping).map(([k, v]) => [`mapping.${k}`, v as Expr | undefined] as [string, Expr | undefined]),
    ...Object.entries(config.commentMapping ?? {}).map(([k, v]) => [`commentMapping.${k}`, v as Expr | undefined] as [string, Expr | undefined]),
  ];
  for (const [path, expr] of exprs) if (expr && exprDepth(expr) > 4) err("expression_too_deep", path);

  // Status values.
  const statusMap = config.valueMaps.status;
  const terminalStatuses = Object.entries(statusMap).filter(([, state]) => TERMINAL.has(state)).map(([raw]) => raw);
  if (Object.keys(statusMap).length === 0) err("status_map_empty", "valueMaps.status");
  if (config.unknownStatus === "open") warn("unknown_status_falls_back_to_open", "unknownStatus");

  // Deletion signal.
  if (config.deletion?.verifyWithDetail && !config.ticketDetail) err("verify_with_detail_needs_ticket_detail", "deletion.verifyWithDetail");

  // ---- SLA verdicts ----------------------------------------------------------
  const full = config.slaMode === "full";
  const limitations: string[] = [];
  const hasHistory = Boolean(config.statusHistory);
  if (!hasHistory) limitations.push("no_status_history");

  // Resolution: needs a source closure timestamp for terminal statuses (U7).
  const resolutionReasons: string[] = [];
  let resolution: MetricSupport = "supported";
  const hasClosure = mappingHasPath(config.mapping.closedAt) || hasHistory;
  if (terminalStatuses.length === 0) {
    resolution = "unsupported";
    resolutionReasons.push("no_terminal_status_mapped");
  } else if (!hasClosure) {
    resolution = "unsupported";
    resolutionReasons.push("no_closure_timestamp");
  } else if (!hasHistory) {
    resolution = "supported_with_limitations";
    resolutionReasons.push("no_status_history_customer_wait_not_applied");
    resolutionReasons.push("reopen_detection_limited");
  }

  // Full SLA: reply data, author role, visibility (Q7), creation actor.
  const fullReasons: string[] = [];
  if (full) {
    if (!config.commentMapping || !config.comments) fullReasons.push("no_comments_source");
    else {
      if (!mappingHasPath(config.commentMapping.authorRole) || !config.valueMaps.authorRole) fullReasons.push("no_author_role_mapping");
      const hasVisibility = mappingHasPath(config.commentMapping.isPublic);
      if (!hasVisibility && !config.commentVisibilityAcknowledged) fullReasons.push("comment_visibility_not_acknowledged");
    }
    if (!config.creationActor) fullReasons.push("no_creation_actor");
    else if (config.creationActor.type === "first_comment_author" && !config.comments) fullReasons.push("no_comments_source");
    else if (config.creationActor.type === "path" && !config.valueMaps.authorRole) fullReasons.push("no_author_role_mapping");
  }
  const replySupport: MetricSupport = !full ? "unsupported" : fullReasons.length > 0 ? "unsupported" : "supported";
  const replyReasons = !full ? ["resolution_only_mode"] : fullReasons;
  for (const reason of fullReasons) out.push({ severity: "error", code: reason, path: "slaMode" });

  // A source can also fail Full SLA in a way that downgrades to Resolution-only by choice; the owner is told, not silently switched.
  const support: SlaSupportSummary = {
    first_response: { state: replySupport, reasons: replyReasons },
    next_reply: { state: replySupport, reasons: replyReasons },
    resolution: { state: resolution, reasons: resolutionReasons },
  };

  // Full SLA that cannot be supported, or Resolution tracking that is blocked, make the document unfit to activate in that mode.
  if (resolution === "unsupported") {
    // Resolution-only with no Resolution leaves nothing to track; in Full SLA the source still tracks replies, and says Resolution is unsupported.
    const code = terminalStatuses.length === 0 ? "no_terminal_status_mapped" : "resolution_blocked_no_closure_timestamp";
    const path = terminalStatuses.length === 0 ? "valueMaps.status" : "mapping.closedAt";
    if (config.slaMode === "resolution_only") err(code, path);
    else warn(code, path);
  }

  if (full && config.creationActor?.type === "assume_customer") warn("creation_actor_asserted_not_derived", "creationActor");

  const unsupportedKinds = (Object.keys(support) as (keyof SlaSupportSummary)[]).filter((kind) => support[kind].state === "unsupported");
  const stored: StoredSlaSupport = { unsupportedKinds, limitations };

  if (!incrementalCursor) warn("no_incremental_cursor_activation_needs_single_run_listing", "tickets.incremental");

  return {
    diagnostics: out,
    ok: !out.some((d) => d.severity === "error"),
    support,
    stored,
    requiredSecrets: secretFieldNames(config.auth),
    terminalStatuses,
  };
}

/** `Integration.slaSupport` value for a validated configuration, or null when nothing is unsupported and nothing is limited. */
export function storedSlaSupport(report: ValidationReport): StoredSlaSupport | null {
  return report.stored.unsupportedKinds.length === 0 && report.stored.limitations.length === 0 ? null : report.stored;
}
