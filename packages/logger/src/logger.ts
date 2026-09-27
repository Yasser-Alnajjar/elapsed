export type LogFields = Record<string, unknown>;

export interface Logger {
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  /** Returns a new logger whose every line also carries `fields` — used to attach organization/integration/cycle/stage once per scope (roadmap 7.4) instead of repeating them at every call site. */
  child(fields: LogFields): Logger;
}

/**
 * Structured JSON logging (roadmap 7.4): one JSON object per line to
 * stdout/stderr, matching the shape `apps/worker/src/index.ts` already
 * hand-rolled with `console.log(JSON.stringify(...))` for cycle-level
 * events. `child()` is the mechanism for threading organization/integration/
 * cycle/stage context down through a pipeline without every call site
 * having to know or repeat it — see `apps/worker/src/cycle.ts`.
 */
function makeLogger(base: LogFields): Logger {
  function write(sink: (line: string) => void, level: "info" | "warn" | "error", event: string, fields?: LogFields): void {
    sink(
      JSON.stringify({
        level,
        event,
        time: new Date().toISOString(),
        ...base,
        ...fields,
      }),
    );
  }

  return {
    info: (event, fields) => write(console.log, "info", event, fields),
    warn: (event, fields) => write(console.warn, "warn", event, fields),
    error: (event, fields) => write(console.error, "error", event, fields),
    child: (fields) => makeLogger({ ...base, ...fields }),
  };
}

export function createLogger(base: LogFields = {}): Logger {
  return makeLogger(base);
}
