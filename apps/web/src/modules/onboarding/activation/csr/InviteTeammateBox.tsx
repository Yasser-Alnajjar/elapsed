"use client";

import { useState } from "react";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  sendInvitation,
  type InviteStatus,
} from "@modules/settings/members/csr/send-invitation";
import { DESCRIPTION_CLASS } from "./constants";

/** Compact invite form — same `sendInvitation` the Settings → Members page uses, styled for this screen instead of duplicating logic. */
export function InviteTeammateBox() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<InviteStatus | undefined>();
  const [submitting, setSubmitting] = useState(false);

  async function handleInvite() {
    const trimmed = email.trim();
    if (!trimmed) return;

    setSubmitting(true);
    setStatus(undefined);

    const result = await sendInvitation(trimmed);

    setSubmitting(false);

    if (result.type === "success") setEmail("");
    setStatus(result);
  }

  return (
    <div className="flex flex-col justify-between gap-4 rounded-xl bg-surface-container-lowest p-6 shadow-elevated">
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-primary">
          <UserPlus className="size-[18px] shrink-0" />
          <span className="font-label-caps text-label-caps uppercase tracking-wider">
            Recommended next step
          </span>
        </div>
        <h4 className="font-headline-sm text-headline-sm text-on-surface">
          Align engineering &amp; support leads
        </h4>
        <p className={DESCRIPTION_CLASS}>
          Invite your engineering and support leads so both teams share the same
          live SLA runway view.
        </p>
      </div>
      <div className="space-y-2">
        <div className="flex gap-2">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleInvite();
            }}
            placeholder="colleague@company.com"
            disabled={submitting}
            className="bg-surface-container-low"
          />
          <Button
            type="button"
            size="sm"
            variant="tonal"
            disabled={submitting || !email.trim()}
            onClick={() => void handleInvite()}
            className="shrink-0"
          >
            {submitting ? "Sending…" : "Invite"}
          </Button>
        </div>
        {status && (
          <p
            className={`font-body-sm text-body-sm ${
              status.type === "success" ? "text-tertiary" : "text-error"
            }`}
          >
            {status.message}
          </p>
        )}
      </div>
    </div>
  );
}
