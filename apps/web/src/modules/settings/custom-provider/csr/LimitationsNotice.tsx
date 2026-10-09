"use client";

import { Alert } from "@/components/ui/alert";
import { LIMITATION_COPY, UNSUPPORTED_KIND_COPY } from "@/lib/custom-provider/state-copy";

/** What this source cannot support, from `Integration.slaSupport`. Never claims the accuracy of a source with real status history. */
export function LimitationsNotice({ slaSupport }: { slaSupport: unknown }) {
  const support = (slaSupport ?? {}) as { unsupportedKinds?: string[]; limitations?: string[] };
  const unsupported = support.unsupportedKinds ?? [];
  const limitations = support.limitations ?? [];
  if (unsupported.length === 0 && limitations.length === 0) return null;
  return (
    <Alert>
      <div className="flex flex-col gap-1 text-xs">
        {unsupported.map((kind) => (
          <p key={kind}>{UNSUPPORTED_KIND_COPY[kind] ?? kind}</p>
        ))}
        {limitations.map((code) => (
          <p key={code}>{LIMITATION_COPY[code] ?? code}</p>
        ))}
      </div>
    </Alert>
  );
}
