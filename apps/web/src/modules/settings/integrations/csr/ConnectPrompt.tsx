import type { ReactNode } from "react";
import Link from "next/link";
import { descriptionClass, formatDateTime } from "./card-format";

/** A not-yet-connected card body: what connecting grants, then the connect control pinned to the bottom. */
export function ConnectPrompt({
  description,
  disconnectedAt,
  detailsHref,
  children,
}: {
  description: string;
  /** Set when the provider was connected before — appended to the description. */
  disconnectedAt?: Date | null;
  /** The integration's details page — a disconnected integration keeps its imported data, so it stays reachable. */
  detailsHref?: string;
  /** The provider's connect button or form. */
  children: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col">
      <p className={descriptionClass}>
        {description}
        {disconnectedAt && ` Disconnected ${formatDateTime(disconnectedAt)}.`}
        {detailsHref && (
          <>
            {" "}
            <Link
              href={detailsHref}
              className="text-primary underline-offset-2 hover:underline"
            >
              View details
            </Link>
          </>
        )}
      </p>

      <div className="mt-auto pt-6">{children}</div>
    </div>
  );
}
