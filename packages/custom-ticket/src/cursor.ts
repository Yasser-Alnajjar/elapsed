import type { Position } from "./requests";

/**
 * The `Integration.cursor` JSON for a `custom` integration. Written only by
 * ingest, together with the raw events of a completed page, in one
 * transaction (plan 09, 6.12).
 */
export interface CustomCursor {
  v: 1;
  /** Hash of the listing-relevant configuration; a change restarts an in-progress pass but keeps the watermark. */
  listingHash?: string;
  /** The pass in progress, or null/absent when none is. */
  listing?: {
    /** When this pass started; the window anchor persisted with the position so resuming never shifts the window. */
    anchor: string;
    /** The updated-since lower bound this pass uses (ISO), or null for a source without an incremental parameter. */
    updatedSince: string | null;
    position: Position;
    pages: number;
    tickets: number;
    /** Ids seen so far, kept only when a verified-404 deletion check will need them. */
    seenIds?: string[];
  } | null;
  /** The updated-since value the NEXT pass starts from (anchor of the last completed pass less the look-back). */
  watermark?: string | null;
  /** Set when the whole initial window has been read. */
  backfillCompletedAt?: string | null;
  lastPassCompletedAt?: string | null;
  /** Consecutive runs that completed no page; at three the next such run fails as `no_progress`. */
  zeroProgressRuns?: number;
  /** Ticket ids whose absence from a completed full listing is waiting for a verified-404 check. */
  pendingVerification?: string[];
}

export function readCursor(value: unknown): CustomCursor {
  if (value !== null && typeof value === "object" && !Array.isArray(value) && (value as { v?: unknown }).v === 1) {
    return value as CustomCursor;
  }
  return { v: 1 };
}
