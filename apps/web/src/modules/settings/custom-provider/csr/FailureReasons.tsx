import type { RecordFailureDetail } from "@sla/ingestion";
import { MAPPING_ERROR_COPY } from "@/lib/custom-provider/state-copy";

/**
 * Why one ticket failed. With field-level details, each line names the field,
 * the mapping that failed and the cause. Without them (a run recorded before
 * details existed), the plain-language text for the code.
 */
export function FailureReasons({ code, details }: { code: string; details?: RecordFailureDetail[] }) {
  if (!details || details.length === 0) return <span>{MAPPING_ERROR_COPY[code] ?? code}</span>;
  return (
    <ul className="mt-1 flex list-disc flex-col gap-1 ps-4" aria-label="Why this ticket failed">
      {details.map((detail) => (
        <li key={`${detail.mapping}:${detail.reason}`}>
          {detail.message} <span className="text-on-surface-variant font-mono">[{detail.mapping}: {detail.reason}]</span>
        </li>
      ))}
    </ul>
  );
}
