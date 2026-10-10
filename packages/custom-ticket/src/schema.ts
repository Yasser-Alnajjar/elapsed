import { z } from "zod";
import { isCredentialLookingQueryKey, validateHeaders } from "@sla/safe-http";
import { isValidTimeZone } from "./dates";
import { isValidPath } from "./path";

/**
 * The versioned, closed-schema configuration document (plan 09, 4.1 and
 * Appendix B). Every object is strict: an unknown key is an error. Sizes and
 * counts are bounded. The document never holds a secret; credentials live in
 * the encrypted store and are referred to only by the auth type.
 *
 * The same schema validates when a draft is saved, when a version is
 * activated and when the worker loads it.
 */
export const CONFIG_SCHEMA_VERSION = 1;
export const MAX_CONFIG_BYTES = 64 * 1024;

const FORBIDDEN_RECORD_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const NORMALIZED_STATES = ["new", "open", "pending_customer", "pending_internal", "in_progress", "escalated", "resolved", "closed"] as const;
const PRIORITIES = ["low", "normal", "high", "urgent"] as const;

const shortText = (max: number) => z.string().min(1).max(max);
const pathString = z.string().refine(isValidPath, { message: "invalid_path" });
const safeRecordKey = z.string().min(1).max(128).refine((key) => !FORBIDDEN_RECORD_KEYS.has(key), { message: "forbidden_key" });
const timeZone = z.string().max(64).refine(isValidTimeZone, { message: "invalid_timezone" });

// ---- expressions: a path, or one of the fixed transforms ---------------------
export type Expr =
  | string
  | { transform: "constant"; value: string | number | boolean }
  | { transform: "coalesce"; of: Expr[] }
  | { transform: "template"; template: string; values: Record<string, Expr> }
  | { transform: "trim" | "lowercase" | "stripHtml"; of: Expr }
  | { transform: "epochToIso"; of: Expr; unit: "seconds" | "millis" }
  | { transform: "parseDate"; of: Expr; format: "iso8601" | "epoch_seconds" | "epoch_millis" | "local"; timezone?: string }
  | { transform: "valueMap"; of: Expr; map: Record<string, string>; fallback?: string };

export const MAX_EXPR_DEPTH = 4;

export const exprSchema: z.ZodType<Expr> = z.lazy(() =>
  z.union([
    pathString,
    z.strictObject({ transform: z.literal("constant"), value: z.union([z.string().max(256), z.number().finite(), z.boolean()]) }),
    z.strictObject({ transform: z.literal("coalesce"), of: z.array(exprSchema).min(1).max(8) }),
    z.strictObject({
      transform: z.literal("template"),
      template: z.string().min(1).max(256),
      values: z.record(safeRecordKey, exprSchema).refine((values) => Object.keys(values).length <= 8),
    }),
    z.strictObject({ transform: z.enum(["trim", "lowercase", "stripHtml"]), of: exprSchema }),
    z.strictObject({ transform: z.literal("epochToIso"), of: exprSchema, unit: z.enum(["seconds", "millis"]) }),
    z.strictObject({
      transform: z.literal("parseDate"),
      of: exprSchema,
      format: z.enum(["iso8601", "epoch_seconds", "epoch_millis", "local"]),
      timezone: timeZone.optional(),
    }),
    z.strictObject({
      transform: z.literal("valueMap"),
      of: exprSchema,
      map: z.record(safeRecordKey, z.string().max(256)).refine((map) => Object.keys(map).length <= 200),
      fallback: z.string().max(256).optional(),
    }),
  ]),
) as z.ZodType<Expr>;

// ---- requests and pagination ---------------------------------------------------
const TEMPLATE_VARIABLE = /\{\{\s*([A-Za-z.]+)\s*\}\}/g;
export const TEMPLATE_VARIABLES = ["updatedSince", "cursor", "page", "offset", "limit", "ticket.id"] as const;
export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];

/** Variable names used by a template string (not validated against the allowed list). */
export function variablesIn(template: string): string[] {
  return [...template.matchAll(TEMPLATE_VARIABLE)].map((m) => m[1]!);
}

const templateString = (max: number) =>
  z.string().max(max).refine((s) => variablesIn(s).every((v) => (TEMPLATE_VARIABLES as readonly string[]).includes(v)) && !/\{\{[^}]*$/.test(s.replace(TEMPLATE_VARIABLE, "")), {
    message: "unknown_variable",
  });

const requestPath = templateString(512).refine((p) => p.startsWith("/") && !p.startsWith("//") && !/[?#\\\u0000-\u001f]/.test(p), { message: "invalid_request_path" });

const headersSchema = z
  .record(z.string().min(1).max(64), z.string().max(256))
  .refine((headers) => Object.keys(headers).length <= 10, { message: "too_many_headers" })
  .refine(
    (headers) => {
      try {
        validateHeaders(headers);
      } catch {
        return false;
      }
      return Object.keys(headers).every((name) => !/^(authorization|proxy-authorization|x-api-key|api-key)$/i.test(name));
    },
    { message: "invalid_headers" },
  );

const queryRecord = z
  .record(z.string().min(1).max(64), templateString(256))
  .refine((query) => Object.keys(query).length <= 20, { message: "too_many_query_params" })
  .refine((query) => Object.keys(query).every((key) => !isCredentialLookingQueryKey(key) && !FORBIDDEN_RECORD_KEYS.has(key)), {
    message: "credential_in_query",
  });

type JsonTemplate = string | number | boolean | null | JsonTemplate[] | { [key: string]: JsonTemplate };
function jsonDepthOk(value: unknown, depth = 0): boolean {
  if (depth > 5) return false;
  if (Array.isArray(value)) return value.length <= 50 && value.every((v) => jsonDepthOk(v, depth + 1));
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value);
    return keys.length <= 50 && keys.every((k) => !FORBIDDEN_RECORD_KEYS.has(k)) && Object.values(value).every((v) => jsonDepthOk(v, depth + 1));
  }
  return true;
}
const jsonTemplate: z.ZodType<JsonTemplate> = z
  .json()
  .refine((value) => jsonDepthOk(value) && JSON.stringify(value).length <= 4096, { message: "invalid_body" })
  .refine(
    (value) => {
      const strings: string[] = [];
      const walk = (v: unknown) => {
        if (typeof v === "string") strings.push(v);
        else if (Array.isArray(v)) v.forEach(walk);
        else if (v !== null && typeof v === "object") Object.values(v).forEach(walk);
      };
      walk(value);
      return strings.every((s) => variablesIn(s).every((name) => (TEMPLATE_VARIABLES as readonly string[]).includes(name)));
    },
    { message: "unknown_variable" },
  ) as z.ZodType<JsonTemplate>;

export const requestSchema = z.strictObject({
  method: z.enum(["GET", "POST"]),
  path: requestPath,
  query: queryRecord.optional(),
  headers: headersSchema.optional(),
  /** `POST` only. */
  body: jsonTemplate.optional(),
  /** Set only by the user's explicit confirmation that this `POST` is a read-only search/query. */
  readOnlySearch: z.literal(true).optional(),
});
export type RequestConfig = z.infer<typeof requestSchema>;

const pageSize = z.number().int().min(1).max(1000);
const paramName = z.string().min(1).max(64).regex(/^[A-Za-z0-9_.-]+$/).refine((p) => !FORBIDDEN_RECORD_KEYS.has(p) && !isCredentialLookingQueryKey(p));
const paramLocation = z.enum(["query", "body"]);

export const paginationSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("none") }),
  z.strictObject({
    type: z.literal("page"),
    param: paramName,
    in: paramLocation.default("query"),
    startAt: z.union([z.literal(0), z.literal(1)]).default(1),
    sizeParam: paramName.optional(),
    pageSize,
  }),
  z.strictObject({
    type: z.literal("offset"),
    offsetParam: paramName,
    limitParam: paramName,
    in: paramLocation.default("query"),
    pageSize,
  }),
  z.strictObject({
    type: z.literal("cursor"),
    cursorPath: pathString,
    param: paramName,
    in: paramLocation.default("query"),
    sizeParam: paramName.optional(),
    pageSize: pageSize.optional(),
  }),
  /** A path to a URL string in the response; must be same-origin. */
  z.strictObject({ type: z.literal("next_url"), nextPath: pathString }),
  /** RFC 8288 `Link: <...>; rel="next"`; same-origin. */
  z.strictObject({ type: z.literal("link_header") }),
]);
export type PaginationConfig = z.infer<typeof paginationSchema>;

// ---- authentication ------------------------------------------------------------
const headerName = z.string().min(1).max(64).refine((name) => {
  try {
    validateHeaders({ [name]: "x" });
    return true;
  } catch {
    return false;
  }
}, { message: "invalid_header_name" });

export const authSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("api_key_header"), headerName }),
  z.strictObject({ type: z.literal("bearer") }),
  z.strictObject({ type: z.literal("basic") }),
  /** A custom header whose value is `prefix + secret`. */
  z.strictObject({ type: z.literal("custom_header"), headerName, prefix: z.string().max(32).regex(/^[\x20-\x7e]*$/).optional() }),
]);
export type AuthConfig = z.infer<typeof authSchema>;

/** The write-only secret fields each auth type needs. Names double as the credential field the ciphertext is bound to. */
export function secretFieldNames(auth: AuthConfig): string[] {
  switch (auth.type) {
    case "api_key_header":
      return ["apiKey"];
    case "bearer":
      return ["token"];
    case "basic":
      return ["username", "password"];
    case "custom_header":
      return ["headerValue"];
  }
}

// ---- endpoints -----------------------------------------------------------------
const incrementalSchema = z.strictObject({
  format: z.enum(["iso8601", "epoch_seconds", "epoch_millis"]),
  lookbackSeconds: z.number().int().min(0).max(86_400),
});

const ticketsSchema = z.strictObject({
  request: requestSchema,
  itemsPath: pathString,
  pagination: paginationSchema.default({ type: "none" }),
  incremental: incrementalSchema.optional(),
});

const childEndpointSchema = z.strictObject({
  request: requestSchema,
  itemsPath: pathString,
  pagination: paginationSchema.default({ type: "none" }),
});

const commentsSchema = z.strictObject({
  /** Absent: the replies are embedded in each ticket item and `itemsPath` is relative to it (`$` is the ticket). */
  request: requestSchema.optional(),
  itemsPath: pathString,
  pagination: paginationSchema.default({ type: "none" }),
});

export const dateSourceFormats = ["iso8601", "epoch_seconds", "epoch_millis", "local"] as const;

const mappingSchema = z.strictObject({
  id: exprSchema,
  createdAt: exprSchema,
  status: exprSchema,
  title: exprSchema.optional(),
  priority: exprSchema.optional(),
  updatedAt: exprSchema.optional(),
  customerId: exprSchema.optional(),
  customerName: exprSchema.optional(),
  /** The source's own closure timestamp for a resolved/closed ticket (U7). */
  closedAt: exprSchema.optional(),
  tags: pathString.optional(),
  channel: exprSchema.optional(),
});

const commentMappingSchema = z.strictObject({
  id: exprSchema,
  createdAt: exprSchema,
  authorRole: exprSchema,
  /** Public/private (or internal-note) field. Boolean values map directly; others go through `valueMaps.visibility`. */
  isPublic: exprSchema.optional(),
  body: exprSchema.optional(),
  authorName: exprSchema.optional(),
});

const historySchema = z.strictObject({
  request: requestSchema,
  itemsPath: pathString,
  pagination: paginationSchema.default({ type: "none" }),
  mapping: z.strictObject({
    id: exprSchema.optional(),
    changedAt: exprSchema,
    toStatus: exprSchema,
    fromStatus: exprSchema.optional(),
  }),
});

const stateRecord = z.record(safeRecordKey, z.enum(NORMALIZED_STATES)).refine((m) => Object.keys(m).length >= 1 && Object.keys(m).length <= 200, { message: "invalid_value_map" });

const valueMapsSchema = z.strictObject({
  status: stateRecord,
  priority: z.record(safeRecordKey, z.enum(PRIORITIES)).refine((m) => Object.keys(m).length <= 50).optional(),
  authorRole: z.record(safeRecordKey, z.enum(["customer", "agent", "system"])).refine((m) => Object.keys(m).length <= 50).optional(),
  visibility: z.record(safeRecordKey, z.enum(["public", "private"])).refine((m) => Object.keys(m).length <= 20).optional(),
});

export const creationActorSchema = z.discriminatedUnion("type", [
  /** An explicit creator-role path on the ticket (mapped through `valueMaps.authorRole`). */
  z.strictObject({ type: z.literal("path"), path: exprSchema }),
  /** The author role of the first comment. */
  z.strictObject({ type: z.literal("first_comment_author") }),
  /** The owner asserts that tickets in this source are created by customers. */
  z.strictObject({ type: z.literal("assume_customer") }),
]);

const deletionSchema = z.strictObject({
  /** Raw status values the source uses to mean "deleted". */
  statusValues: z.array(z.string().min(1).max(128)).max(20).optional(),
  /** A boolean (or truthy string) path that marks a deleted ticket. */
  flagPath: pathString.optional(),
  /** A 404 from `ticketDetail` for a ticket the list still held counts as deleted. */
  verifyWithDetail: z.boolean().optional(),
});

export const customConfigSchema = z.strictObject({
  schemaVersion: z.literal(CONFIG_SCHEMA_VERSION),
  displayName: shortText(80),
  connection: z.strictObject({ baseUrl: z.string().min(1).max(512) }),
  auth: authSchema,
  tickets: ticketsSchema,
  comments: commentsSchema.nullish(),
  ticketDetail: z.strictObject({ request: requestSchema }).nullish(),
  statusHistory: historySchema.nullish(),
  mapping: mappingSchema,
  commentMapping: commentMappingSchema.nullish(),
  valueMaps: valueMapsSchema,
  /** `fail`: an unmapped status fails the record. `open`: the owner chose an explicit fallback to `open`. */
  unknownStatus: z.enum(["fail", "open"]).default("fail"),
  /** IANA zone for wall-clock dates that carry no offset; never defaulted. */
  timezone: timeZone.nullish(),
  /** `https://host/path/{id}`; used to recognise and display ticket links only. */
  ticketUrlTemplate: z.string().max(512).nullish(),
  /** First-import window in days. */
  importWindowDays: z.number().int().min(1).max(365).default(90),
  slaMode: z.enum(["full", "resolution_only"]),
  creationActor: creationActorSchema.nullish(),
  /** Recorded when the owner confirms that every returned comment is customer-visible (Q7). */
  commentVisibilityAcknowledged: z.strictObject({ userId: z.string().min(1).max(64), at: z.string().max(40) }).nullish(),
  deletion: deletionSchema.nullish(),
});

export type CustomConfig = z.infer<typeof customConfigSchema>;
export type CustomConfigInput = z.input<typeof customConfigSchema>;

export interface ConfigIssue {
  /** Dotted path into the submitted document, with array indexes. Never contains a value. */
  path: string;
  /** A fixed code: a Zod issue code, or one of this package's own (`invalid_path`, `credential_in_query`, ...). */
  code: string;
}

function issuePath(path: readonly PropertyKey[]): string {
  return path.map((p) => (typeof p === "number" ? `[${p}]` : String(p))).join(".").replace(/\.\[/g, "[");
}

/** Zod issues reduced to path and fixed code. A Zod message can echo a received value, so it is never used. */
export function toConfigIssues(error: z.ZodError): ConfigIssue[] {
  const out: ConfigIssue[] = [];
  const walk = (issues: z.core.$ZodIssue[], prefix: PropertyKey[]) => {
    for (const issue of issues) {
      const path = [...prefix, ...issue.path];
      if (issue.code === "invalid_union" && Array.isArray((issue as { errors?: unknown }).errors)) {
        // Report the branch that went furthest, never every branch.
        const branches = (issue as unknown as { errors: z.core.$ZodIssue[][] }).errors;
        const best = [...branches].sort((a, b) => Math.max(...b.map((i) => i.path.length), 0) - Math.max(...a.map((i) => i.path.length), 0))[0];
        if (best && best.length > 0) {
          walk(best, path);
          continue;
        }
      }
      const custom = issue.code === "custom" ? String((issue as { params?: { code?: unknown } }).params?.code ?? issue.message) : issue.code;
      out.push({ path: issuePath(path), code: issue.code === "custom" && /^[a-z_]+$/.test(custom) ? custom : issue.code });
    }
  };
  walk(error.issues, []);
  return out;
}

export type ParseResult = { ok: true; config: CustomConfig } | { ok: false; issues: ConfigIssue[] };

/** Structural validation only (schema, bounds, strictness). Semantic checks are `validateConfig`. */
export function parseConfig(input: unknown): ParseResult {
  let serialized: string;
  try {
    serialized = JSON.stringify(input) ?? "";
  } catch {
    return { ok: false, issues: [{ path: "", code: "invalid_json" }] };
  }
  if (serialized.length > MAX_CONFIG_BYTES) return { ok: false, issues: [{ path: "", code: "too_large" }] };
  const result = customConfigSchema.safeParse(input);
  if (result.success) return { ok: true, config: result.data };
  return { ok: false, issues: toConfigIssues(result.error) };
}
