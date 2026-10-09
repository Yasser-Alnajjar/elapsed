import { ProviderUnavailableError } from "@sla/ingestion";

/**
 * A failure talking to the customer's API, as a fixed code. The message is the
 * code alone: it can reach `lastSyncError`, so it never holds a URL, status
 * body, header or credential.
 */
export class CustomIngestError extends ProviderUnavailableError {
  readonly code: string;
  constructor(code: string) {
    super(`Custom source request failed (${code})`);
    this.name = "CustomIngestError";
    this.code = code;
  }
}

/** The source answered with a status the engine does not treat as data. Carries the status only. */
export class SourceStatusError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`source_status_${status}`);
    this.name = "SourceStatusError";
    this.status = status;
  }
}
