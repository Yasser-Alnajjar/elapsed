/**
 * Mapping failures carry a fixed code and never the offending value: a code is
 * safe to store on a sync run, show to the owner and log (plan 09, 8.4).
 */
export type MappingErrorCode =
  | "invalid_path"
  | "missing_required"
  | "invalid_type"
  | "invalid_date"
  | "date_format_required"
  | "timezone_required"
  | "invalid_timezone"
  | "nonexistent_local_time"
  | "ambiguous_local_time"
  | "unknown_status"
  | "unknown_priority"
  | "unknown_author_role"
  | "payload_too_large"
  | "duplicate_id"
  | "transform_failed"
  | "comments_not_found"
  | "history_not_found"
  | "unsafe_id"
  | "creation_actor_unknown"
  | "unknown_visibility";

/** Why a field failed, in terms the owner can act on. */
export type MappingProblemReason =
  | "missing" // the source path matched nothing
  | "null" // the source field is present but null
  | "empty" // the source field is an empty string
  | "unsupported_type" // an object, list or boolean where text or a date was expected
  | "undefined_variable" // a template names a variable it does not define
  | "too_long" // a text value is over the length limit
  | "not_in_map" // a value is not in the configured value map
  | "other";

/**
 * One field-level failure. It names the mapping and its target, says why, and
 * carries only configuration (paths, templates, variable names) and measured
 * sizes. It never holds a source value, a credential or a payload, so it is
 * safe to store on a sync run and show to the owner.
 */
export interface MappingProblem {
  /** The mapping that failed, as it appears in the configuration: `mapping.title`. */
  mapping: string;
  /** What the mapping fills in Elapsed: `subject`. */
  target: string;
  code: MappingErrorCode;
  reason: MappingProblemReason;
  /** A complete sentence: `Field "subject" (mapping.title) failed: ...`. */
  message: string;
  /** The source path(s) read. */
  source?: string;
  template?: string;
  variable?: string;
  available?: string[];
  length?: number;
  max?: number;
  actualType?: string;
  /** How many items (comments, history entries) had this same problem. */
  count?: number;
}

/** What the evaluators know when they fail; the caller adds `mapping`, `target` and `message`. */
export type MappingProblemDraft = Omit<MappingProblem, "mapping" | "target" | "message" | "code"> & { detail: string };

export class MappingError extends Error {
  readonly code: MappingErrorCode;
  /** Field-level failures; empty when the failure carries no more than its code. */
  readonly problems: MappingProblem[];
  /** Failures not yet tied to a mapping: `atMapping` completes them. */
  readonly drafts: MappingProblemDraft[];
  constructor(code: MappingErrorCode, detail?: MappingProblemDraft | MappingProblem[], options?: { cause?: unknown }) {
    super(code, options);
    this.name = "MappingError";
    this.code = code;
    this.problems = Array.isArray(detail) ? detail : [];
    this.drafts = detail && !Array.isArray(detail) ? [detail] : [];
  }
}
