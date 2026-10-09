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
  | "unsafe_id";

export class MappingError extends Error {
  readonly code: MappingErrorCode;
  constructor(code: MappingErrorCode) {
    super(code);
    this.name = "MappingError";
    this.code = code;
  }
}
