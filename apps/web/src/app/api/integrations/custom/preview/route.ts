import { previewMapping } from "@sla/custom-ticket";
import { withOutboundSession } from "@/lib/custom-provider/outbound-route";

/**
 * Owner-only, rate-limited, one at a time per organization. Makes read-only
 * requests to the draft's API and returns only a safe classification (plus,
 * for a sample or preview, data that goes to this browser alone and is never stored).
 */
export const maxDuration = 90;

export const POST = () => withOutboundSession((session) => previewMapping(session));
