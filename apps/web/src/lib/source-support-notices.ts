import { LIMITATION_COPY, UNSUPPORTED_KIND_COPY } from "@/lib/custom-provider/state-copy";

/**
 * Plain-language notices for what a ticket source cannot support, from the
 * provider-blind `Integration.slaSupport` (N9, plan 09 5.4). Empty for every
 * source with full support (`null`). Never claims the accuracy of a source with
 * real status history.
 */
export function sourceSupportNotices(slaSupport: unknown): string[] {
  if (slaSupport === null || typeof slaSupport !== "object") return [];
  const { unsupportedKinds, limitations } = slaSupport as { unsupportedKinds?: unknown; limitations?: unknown };
  const kinds = Array.isArray(unsupportedKinds) ? unsupportedKinds : [];
  const limits = Array.isArray(limitations) ? limitations : [];
  return [
    ...kinds.map((kind) => UNSUPPORTED_KIND_COPY[String(kind)]).filter((text): text is string => typeof text === "string"),
    ...limits.map((code) => LIMITATION_COPY[String(code)]).filter((text): text is string => typeof text === "string"),
  ];
}
