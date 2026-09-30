import type { NormalizedEvent } from "./types";

/**
 * Whether `event` came from a ticket source — an integration that creates
 * Cases and owns their lifecycle, decided by the event's `sourceRole`, never by
 * which provider it is. Shared by every place that reasons about a case's own
 * open/closed/solved state, replies, or first response: `evaluate.ts`
 * (`findCaseCloseEvent`, `findFirstResponseEvent`,
 * `resolveFirstResponseStartedAt`), `reply-cycles.ts` (`deriveNextReplyCycles`)
 * and `clock-rules.ts` (`eventsForPauseFold`). A linked tracker issue is never
 * the anchor for a case's lifecycle, so it's deliberately excluded.
 */
export const isTicketSourceEvent = (e: Pick<NormalizedEvent, "sourceRole">): boolean =>
  e.sourceRole === "ticket_source";
