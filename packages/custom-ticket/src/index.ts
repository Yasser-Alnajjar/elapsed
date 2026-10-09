export { MappingError, type MappingErrorCode } from "./errors";
export { evaluatePath, firstMatch, isValidPath, parsePath, MAX_PATH_LENGTH, MAX_PATH_SEGMENTS, type ParsedPath, type PathSegment } from "./path";
export { isValidTimeZone, localToInstant, parseDateValue, type DateFormat } from "./dates";
export { evaluateDate, evaluateExpr, evaluateText, stripHtml, type EvalEnv, type Value } from "./transforms";
export {
  CONFIG_SCHEMA_VERSION,
  MAX_CONFIG_BYTES,
  MAX_EXPR_DEPTH,
  TEMPLATE_VARIABLES,
  authSchema,
  customConfigSchema,
  exprSchema,
  paginationSchema,
  parseConfig,
  requestSchema,
  secretFieldNames,
  toConfigIssues,
  variablesIn,
  type AuthConfig,
  type ConfigIssue,
  type CustomConfig,
  type CustomConfigInput,
  type Expr,
  type PaginationConfig,
  type ParseResult,
  type RequestConfig,
  type TemplateVariable,
} from "./schema";
export {
  pathsIn,
  storedSlaSupport,
  validateConfig,
  type Diagnostic,
  type MetricSupport,
  type MetricVerdict,
  type Severity,
  type SlaSupportSummary,
  type StoredSlaSupport,
  type ValidationReport,
} from "./validate";
export { MappingError as CustomMappingError } from "./errors";
export { computeSourceHash } from "./hash";
export { MAX_STORED_PAYLOAD_BYTES, commentPaths, composePaths, historyPaths, projectByPaths, ticketPaths } from "./projection";
export { START, buildRequest, itemsFrom, nextPosition, pageSizeOf, parseLinkNext, type Position, type Variables } from "./requests";
export { readCursor, type CustomCursor } from "./cursor";
export { ChildTooLargeError, MAX_CHILD_PAGES, fetchAllItems, fetchPage, type Endpoint, type FetchedPage } from "./fetcher";
export { CustomIngestError, SourceStatusError } from "./source-errors";
export {
  MAX_PAGES_PER_RUN,
  MAX_RECORD_FAILURES_REPORTED,
  MAX_TICKETS_PER_RUN,
  RAW_PREFIX,
  ZERO_PROGRESS_LIMIT,
  authHeaders,
  buildTicketEvents,
  envOf,
  listingHash,
  runCustomIngest,
  sensitiveValues,
  type CustomCredentials,
  type RawEventInput,
  type TicketRawEvents,
} from "./ingest";
