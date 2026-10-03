import {
  AlarmClockCheck,
  Headset,
  Megaphone,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import type { OnboardingStatus } from "@/lib/types/onboarding";
import { DESCRIPTION_CLASS } from "./constants";

interface HealthCardProps {
  icon: LucideIcon;
  label: string;
  status: string;
  statusTone: "good" | "warn";
  value: string;
  valueUnit?: string;
  description: string;
  footer: { label: string; value: string }[];
}

/** One tile of the pre-flight health matrix — real per-channel status, no invented precision. */
function HealthCard({
  icon: Icon,
  label,
  status,
  statusTone,
  value,
  valueUnit,
  description,
  footer,
}: HealthCardProps) {
  return (
    <div className="flex flex-col justify-between gap-3 rounded-xl bg-surface-container p-5 shadow-sm">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-on-surface-variant">
            <Icon className="size-[18px] text-primary shrink-0" />
            <span className="font-label-caps text-label-caps uppercase tracking-wider">
              {label}
            </span>
          </div>
          <span
            className={`font-label-caps text-label-caps rounded px-2 py-0.5 uppercase ${
              statusTone === "good"
                ? "bg-tertiary/10 text-tertiary"
                : "bg-primary/10 text-primary"
            }`}
          >
            {status}
          </span>
        </div>
        <div className="space-y-1">
          <div className="font-mono-metric-lg text-mono-metric-lg text-on-surface">
            {value}{" "}
            {valueUnit && (
              <span className="font-body-sm text-body-sm text-on-surface-variant">
                {valueUnit}
              </span>
            )}
          </div>
          <p className={DESCRIPTION_CLASS}>{description}</p>
        </div>
      </div>
      <div className="-mx-5 -mb-5 space-y-1.5 rounded-b-xl bg-surface-container-lowest/60 p-4">
        {footer.map((row) => (
          <div
            key={row.label}
            className="font-code-audit text-code-audit flex justify-between"
          >
            <span className="text-on-surface-variant">{row.label}</span>
            <span className="text-on-surface">{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The four pre-flight tiles: ticket feed, work tracker, clock daemon and alert channels. */
export function HealthMatrix({
  status,
  sourceLabel,
  trackerLabel,
  ticketNoun,
  importedPolicyCount,
  slackConnected,
  emailConfigured,
}: {
  status: OnboardingStatus;
  sourceLabel: string;
  trackerLabel: string | null;
  ticketNoun: string;
  importedPolicyCount: number;
  slackConnected: boolean;
  emailConfigured: boolean;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      <HealthCard
        icon={Headset}
        label={`${sourceLabel} feed`}
        status="Healthy"
        statusTone="good"
        value={status.ticketsFetched.toLocaleString()}
        valueUnit={ticketNoun}
        description={`Historical ${ticketNoun} indexed`}
        footer={[{ label: "Sync mode", value: "Read-only, incremental" }]}
      />

      {trackerLabel !== null ? (
        <HealthCard
          icon={Workflow}
          label={`${trackerLabel} tracker`}
          status="Active"
          statusTone="good"
          value={status.linkedIssues.toLocaleString()}
          valueUnit="issues linked"
          description={
            status.escalatedCases > 0
              ? `${status.escalatedCases.toLocaleString()} escalated case${status.escalatedCases === 1 ? "" : "s"} linked`
              : `No cases escalated to ${trackerLabel} yet`
          }
          footer={[
            {
              label: "Escalated cases",
              value: status.escalatedCases.toLocaleString(),
            },
          ]}
        />
      ) : (
        <HealthCard
          icon={Workflow}
          label="Work tracker"
          status="Not connected"
          statusTone="warn"
          value="—"
          description="Engineering time appears once a tracker is connected"
          footer={[{ label: "Escalated cases", value: "Not measured" }]}
        />
      )}

      <HealthCard
        icon={AlarmClockCheck}
        label="Clock daemon"
        status="Synchronized"
        statusTone="good"
        value="Continuous"
        description="Wall-clock SLA tracking across support and engineering handoffs"
        footer={[
          {
            label: "SLA policies imported",
            value: importedPolicyCount.toLocaleString(),
          },
        ]}
      />

      <HealthCard
        icon={Megaphone}
        label="Escalation channels"
        status={slackConnected || emailConfigured ? "Configured" : "Not set up"}
        statusTone={slackConnected || emailConfigured ? "good" : "warn"}
        value={[slackConnected, emailConfigured]
          .filter(Boolean)
          .length.toString()}
        valueUnit="of 2 wired"
        description="Slack and email alerts fire on warning/breach"
        footer={[
          {
            label: "Slack",
            value: slackConnected ? "Connected" : "Not connected",
          },
          {
            label: "Email (SMTP)",
            value: emailConfigured ? "Configured" : "Not configured",
          },
        ]}
      />
    </div>
  );
}
