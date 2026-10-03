"use client";

import { AtSign, Building2, Check, IdCard, Mail, Plus, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { BillingCaption, BillingCard, BillingPill } from "@/components/billing/billing-ui";
import type { BillingProfile } from "@/lib/types/billing";
import { OWNER_ONLY_HINT, useBillingActions } from "../billing-actions-context";

const LINK = "text-primary font-mono text-[10px] font-semibold tracking-[0.04em] hover:underline disabled:pointer-events-none disabled:opacity-50";

function ProfileCard({ icon: Icon, caption, action, children, footer }: { icon: LucideIcon; caption: string; action: ReactNode; children: ReactNode; footer: ReactNode }) {
  return (
    <BillingCard className="flex flex-col justify-between gap-4 p-4">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <Icon aria-hidden className="text-primary size-4.5" />
            <BillingCaption>{caption}</BillingCaption>
          </span>
          {action}
        </div>
        {children}
      </div>
      <div className="border-border/60 text-foreground-subtle flex items-center justify-between gap-2 border-t pt-2 font-mono text-[10px]">{footer}</div>
    </BillingCard>
  );
}

function Missing({ children }: { children: ReactNode }) {
  return <p className="text-foreground-subtle text-sm italic">{children}</p>;
}

/** Legal entity, tax identification and invoice recipients: who invoices are addressed to and sent to. Each "Edit" opens the billing details form. */
export function BillingProfileCards({ profile, onEdit }: { profile: BillingProfile; onEdit: () => void }) {
  const { canManage } = useBillingActions();
  const hint = canManage ? undefined : OWNER_ONLY_HINT;
  const recipients = [...(profile.billingEmail ? [{ email: profile.billingEmail, label: "Primary" }] : []), ...profile.ccEmails.map((email) => ({ email, label: "CC" }))];
  const edit = (label: string, icon?: ReactNode) => (
    <button type="button" className={`${LINK} flex items-center gap-0.5`} disabled={!canManage} title={hint} onClick={onEdit}>
      {icon}
      {label}
    </button>
  );

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <ProfileCard
        icon={Building2}
        caption="Legal entity"
        action={edit("Edit")}
        footer={
          <>
            <span>Jurisdiction: {profile.country ?? "—"}</span>
            {profile.legalName && profile.addressLines.length > 0 && (
              <span className="text-success flex items-center gap-1 font-semibold">
                <Check aria-hidden className="size-3.5" />
                On file
              </span>
            )}
          </>
        }
      >
        {profile.legalName || profile.addressLines.length > 0 ? (
          <address className="flex flex-col not-italic">
            <span className="text-foreground font-mono text-sm font-bold">{profile.legalName ?? "Legal name not set"}</span>
            <span className="text-muted-foreground mt-1 text-sm leading-relaxed">
              {profile.addressLines.map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
            </span>
          </address>
        ) : (
          <Missing>No legal entity yet. Invoices use the organization name.</Missing>
        )}
      </ProfileCard>

      <ProfileCard
        icon={IdCard}
        caption="Tax ID & EIN"
        action={edit("Manage")}
        footer={<span>Printed on every invoice</span>}
      >
        {profile.taxId ? (
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-foreground font-mono text-sm font-bold tracking-wide">{profile.taxId}</span>
            <BillingPill tone="neutral">On file</BillingPill>
          </div>
        ) : (
          <Missing>No tax ID on file.</Missing>
        )}
      </ProfileCard>

      <ProfileCard
        icon={Mail}
        caption="Invoice dispatch"
        action={edit("Add recipient", <Plus aria-hidden className="size-3" />)}
        footer={
          <>
            <span>Delivery: email</span>
            <span className={recipients.length > 0 ? "text-success font-semibold" : undefined}>{recipients.length} ACTIVE</span>
          </>
        }
      >
        {recipients.length > 0 ? (
          <ul className="flex flex-col gap-1.5">
            {recipients.map((recipient) => (
              <li key={recipient.email} className="bg-surface-raised flex items-center justify-between gap-2 rounded px-2.5 py-1.5">
                <span className="text-foreground flex min-w-0 items-center gap-2 font-mono text-xs">
                  <AtSign aria-hidden className="text-foreground-subtle size-3.5 shrink-0" />
                  <span className="truncate">{recipient.email}</span>
                </span>
                <span className="bg-card text-foreground-subtle shrink-0 rounded px-1 font-mono text-[10px]">{recipient.label}</span>
              </li>
            ))}
          </ul>
        ) : (
          <Missing>No invoice recipients yet.</Missing>
        )}
      </ProfileCard>
    </div>
  );
}
