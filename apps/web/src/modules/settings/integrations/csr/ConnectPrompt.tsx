"use client";

import type { ReactNode } from "react";
import { useOrgTimezone } from "@/components/shared/org-timezone-provider";
import { formatDateTime } from "@/lib/format";
import { descriptionClass } from "./card-format";

/** A not-yet-connected card body: what connecting grants, then the connect control pinned to the bottom. */
export function ConnectPrompt({
  description,
  disconnectedAt,
  children,
}: {
  description: string;
  /** Set when the provider was connected before — appended to the description. */
  disconnectedAt?: Date | null;
  /** The provider's connect button or form. */
  children: ReactNode;
}) {
  const timeZone = useOrgTimezone();
  return (
    <div className="flex flex-1 flex-col">
      <p className={descriptionClass}>
        {description}
        {disconnectedAt && ` Disconnected ${formatDateTime(disconnectedAt, timeZone)}.`}
      </p>

      <div className="mt-auto pt-6">{children}</div>
    </div>
  );
}
