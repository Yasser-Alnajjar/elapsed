import { MappingError, type MappingErrorCode, type MappingProblem, type MappingProblemDraft } from "./errors";
import { evaluatePath } from "./path";
import type { Expr } from "./schema";

/**
 * Field-level diagnostics for mapping failures. The evaluators know why a
 * value failed but not which mapping it belongs to; the caller knows the
 * mapping but not why. `atMapping` joins the two. Everything produced here is
 * built from configuration (paths, templates, variable names) and measured
 * sizes, never from a source value, so it is safe to store and show.
 */

/** What each mapping fills in Elapsed. */
const TARGETS: Record<string, string> = {
  "tickets.itemsPath": "ticket list item",
  "mapping": "stored ticket data",
  "mapping.id": "externalId",
  "mapping.title": "subject",
  "mapping.status": "status",
  "mapping.createdAt": "openedAt",
  "mapping.closedAt": "closedAt",
  "mapping.priority": "priority",
  "mapping.customerId": "customer.externalId",
  "mapping.customerName": "customer.name",
  "mapping.channel": "channel",
  "mapping.tags": "tags",
  "commentMapping.id": "comment.id",
  "commentMapping.createdAt": "comment.createdAt",
  "commentMapping.authorRole": "comment.actor",
  "commentMapping.isPublic": "comment.visibility",
  "creationActor": "ticket creator",
  "statusHistory.mapping.id": "history.id",
  "statusHistory.mapping.changedAt": "history.changedAt",
  "statusHistory.mapping.toStatus": "history.toState",
  "statusHistory.mapping.fromStatus": "history.fromState",
  "comments.request": "comments request",
  "statusHistory.request": "status history request",
};

/** Used when a failure carries only its code. */
const FALLBACK_DETAIL: Record<MappingErrorCode, string> = {
  invalid_path: "the path in this mapping is not valid.",
  missing_required: "a required value is missing from your API's response.",
  invalid_type: "the source value has an unsupported type (an object or list where a single value was expected).",
  invalid_date: "the date could not be read. Check the date format, and that a closing time is not before the opening time.",
  date_format_required: "the date is a number, so the mapping needs an epoch format.",
  timezone_required: "the date has no time zone and none is configured.",
  invalid_timezone: "the configured time zone is not a valid IANA zone.",
  nonexistent_local_time: "the local time does not exist in the configured time zone (daylight-saving gap).",
  ambiguous_local_time: "the local time occurs twice in the configured time zone (daylight-saving overlap).",
  unknown_status: "the value is not in the status mapping.",
  unknown_priority: "the value is not in the priority mapping.",
  unknown_author_role: "the value is not in the author role mapping.",
  payload_too_large: "the stored data for this ticket is over the size limit.",
  duplicate_id: "another ticket in the same sync has this ID.",
  transform_failed: "a transform could not be applied.",
  comments_not_found: "your API answered 404 (not found) for this ticket's comments.",
  history_not_found: "your API answered 404 (not found) for this ticket's status history.",
  unsafe_id: "the ID is too long or contains control characters.",
  creation_actor_unknown: "who created the ticket could not be determined.",
  unknown_visibility: "the value is not in the visibility mapping.",
};

/** A failure that carries only a code (a date that would not parse), placed on the source field it read. */
export function sourceFailureDraft(expr: Expr, code: MappingErrorCode): MappingProblemDraft {
  const source = sourcesOf(expr).slice(0, 5).join(", ") || undefined;
  return { reason: "other", ...(source ? { source } : {}), detail: source ? `source field "${source}": ${FALLBACK_DETAIL[code]}` : FALLBACK_DETAIL[code] };
}

export function targetOf(mapping: string): string {
  return TARGETS[mapping] ?? mapping.split(".").pop() ?? mapping;
}

export function kindOf(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return "list";
  return typeof value === "object" ? "object" : typeof value;
}

/** The source paths an expression reads, in order, without duplicates. */
export function sourcesOf(expr: Expr): string[] {
  const out: string[] = [];
  const walk = (e: Expr): void => {
    if (typeof e === "string") out.push(e);
    else if (e.transform === "coalesce") e.of.forEach(walk);
    else if (e.transform === "template") Object.values(e.values).forEach(walk);
    else if (e.transform !== "constant") walk(e.of);
  };
  walk(expr);
  return [...new Set(out)];
}

type SourceState = "missing" | "null" | "empty" | "present";

function stateOf(path: string, document: unknown): SourceState {
  let matches: unknown[];
  try {
    matches = evaluatePath(path, document);
  } catch {
    return "missing";
  }
  if (matches.length === 0) return "missing";
  const values = matches.flatMap((m) => (Array.isArray(m) ? m : [m]));
  if (values.every((v) => v === null || v === undefined)) return "null";
  if (values.every((v) => v === null || v === undefined || (typeof v === "string" && v.trim() === ""))) return "empty";
  return "present";
}

const STATE_PHRASE: Record<Exclude<SourceState, "present">, string> = {
  missing: "is missing from the response (nothing at that path)",
  null: "is null",
  empty: "is an empty string",
};

/** Why an expression produced no value: which source field is missing, null or empty. */
export function missingDraft(expr: Expr, document: unknown): MappingProblemDraft {
  const sources = sourcesOf(expr).slice(0, 5);
  const states = sources.map((path) => ({ path, state: stateOf(path, document) }));
  const bad = states.filter((s): s is { path: string; state: Exclude<SourceState, "present"> } => s.state !== "present");
  const reason = bad[0]?.state ?? "missing";
  const source = sources.join(", ") || undefined;
  if (typeof expr === "string") {
    return { reason, source, detail: `source field "${expr}" ${STATE_PHRASE[reason]}.` };
  }
  if (bad.length === 0) return { reason, source, detail: "the expression produced no value." };
  return { reason, source, detail: `no value could be built; ${bad.map((s) => `source field "${s.path}" ${STATE_PHRASE[s.state]}`).join("; ")}.` };
}

/** A value of a type the mapping cannot use. */
export function wrongTypeDraft(expr: Expr, value: unknown, expected: string): MappingProblemDraft {
  const actualType = kindOf(value);
  const source = sourcesOf(expr).slice(0, 5).join(", ") || undefined;
  const where = typeof expr === "string" ? `source field "${expr}"` : `the value built from ${source ? `"${source}"` : "this expression"}`;
  const article = /^[aeiou]/.test(actualType) ? "an" : "a";
  return { reason: "unsupported_type", source, actualType, detail: `${where} is ${article} ${actualType}; expected ${expected}.` };
}

export function tooLongDraft(length: number, max: number, source?: string): MappingProblemDraft {
  return { reason: "too_long", length, max, ...(source ? { source } : {}), detail: `value length is ${length} characters; maximum allowed is ${max}.` };
}

export function complete(mapping: string, code: MappingErrorCode, draft: MappingProblemDraft): MappingProblem {
  const { detail, ...rest } = draft;
  const target = targetOf(mapping);
  return { ...rest, mapping, target, code, message: `Field "${target}" (${mapping}) failed: ${detail}` };
}

/** Runs one mapping's evaluation; any `MappingError` leaves tied to that mapping. */
export function atMapping<T>(mapping: string, run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (!(error instanceof MappingError)) throw error;
    if (error.drafts.length === 0 && error.problems.length > 0) throw error;
    const drafts: MappingProblemDraft[] = error.drafts.length > 0 ? error.drafts : [{ reason: "other", detail: FALLBACK_DETAIL[error.code] }];
    throw new MappingError(error.code, [...error.problems, ...drafts.map((d) => complete(mapping, error.code, d))], { cause: error });
  }
}

/** Throws a mapping failure for a value that was required and absent. */
export function missingRequired(mapping: string, expr: Expr, document: unknown): never {
  throw new MappingError("missing_required", [complete(mapping, "missing_required", missingDraft(expr, document))]);
}

/**
 * Collects the failures of every independent field of one ticket instead of
 * stopping at the first, then reports them together.
 */
export class ProblemCollector {
  private readonly byKey = new Map<string, MappingProblem>();
  private firstCode: MappingErrorCode | null = null;
  private firstCause: unknown;

  /** Evaluates one mapping; a mapping failure is recorded and `undefined` returned. */
  attempt<T>(mapping: string, run: () => T): T | undefined {
    try {
      return atMapping(mapping, run);
    } catch (error) {
      if (!(error instanceof MappingError)) throw error;
      this.add(error);
      return undefined;
    }
  }

  /** Like `attempt`, and a `null` result is itself a failure: the required source value is absent. */
  require<T>(mapping: string, expr: Expr, document: unknown, run: () => T | null): T | undefined {
    const value = this.attempt(mapping, run);
    if (value === null) {
      this.add(new MappingError("missing_required", [complete(mapping, "missing_required", missingDraft(expr, document))]));
      return undefined;
    }
    return value;
  }

  add(error: MappingError): void {
    this.firstCode ??= error.code;
    this.firstCause ??= error;
    const problems = error.problems.length > 0 ? error.problems : [complete("ticket", error.code, { reason: "other", detail: FALLBACK_DETAIL[error.code] })];
    for (const problem of problems) {
      const key = `${problem.mapping}|${problem.code}|${problem.reason}`;
      const existing = this.byKey.get(key);
      if (existing) existing.count = (existing.count ?? 1) + 1;
      else this.byKey.set(key, { ...problem });
    }
  }

  get any(): boolean {
    return this.byKey.size > 0;
  }

  throwIfAny(): void {
    if (!this.any || this.firstCode === null) return;
    const problems = [...this.byKey.values()].map((p) => (p.count && p.count > 1 ? { ...p, message: `${p.message} (${p.count} items)` } : p));
    throw new MappingError(this.firstCode, problems, { cause: this.firstCause });
  }
}
