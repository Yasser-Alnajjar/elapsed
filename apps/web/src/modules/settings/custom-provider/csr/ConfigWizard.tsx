"use client";

import { useMemo, useState } from "react";
import { Actions } from "@/actions/client";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { emptyConfig, samplePaths, setIn } from "@/lib/custom-provider/wizard";
import type { CustomProviderPageData, DraftConfigDocument, Sample } from "@/lib/types/custom-provider";
import { ReviewPanel } from "./ReviewPanel";
import { StepConnection } from "./StepConnection";
import { StepMapping } from "./StepMapping";
import { StepReplies } from "./StepReplies";
import { StepTickets } from "./StepTickets";
import { TextAreaField } from "./fields";
import type { StepProps } from "./wizard-types";

const STEPS = ["Connection", "Tickets", "Fields", "Replies and SLA", "Review", "Advanced (JSON)"] as const;

/**
 * The guided configuration (plan 09, 4 and 6.8). The document is the same
 * closed-schema JSON the server validates; the steps edit it and the Advanced
 * tab shows all of it. Saving writes the draft only; nothing changes for the
 * organization until Activate. Secrets are write-only.
 */
export function ConfigWizard({ initial, secretsSet: initialSecretsSet, userId }: { initial: CustomProviderPageData["draft"]; secretsSet: string[]; userId: string }) {
  const [step, setStep] = useState<(typeof STEPS)[number]>("Connection");
  const [config, setConfig] = useState<DraftConfigDocument>((initial?.config as DraftConfigDocument | undefined) ?? emptyConfig());
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [secretsSet, setSecretsSet] = useState<string[]>(initialSecretsSet);
  const [issues, setIssues] = useState(initial?.issues ?? []);
  const [sampleTicket, setSampleTicket] = useState<unknown>(null);
  const [json, setJson] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const paths = useMemo(() => (sampleTicket ? samplePaths(sampleTicket).map((p) => p.path) : []), [sampleTicket]);

  async function save(): Promise<boolean> {
    setError(null);
    const typed = Object.fromEntries(Object.entries(secrets).filter(([, v]) => v !== ""));
    const result = await Actions.CustomProvider.saveDraft(config, Object.keys(typed).length ? typed : undefined);
    if (!result.ok || !result.body.draft) {
      setError(result.body.error === "unknown_secret_field" ? "A credential does not match the authentication type." : "The draft could not be saved.");
      return false;
    }
    setSecretsSet(result.body.draft.secretsSet);
    setIssues(result.body.draft.issues);
    setSecrets({});
    return true;
  }

  const props: StepProps = {
    config,
    set: (path, value) => setConfig((current) => setIn(current, path, value)),
    paths,
    secretsSet,
    secrets,
    setSecret: (field, value) => setSecrets((current) => ({ ...current, [field]: value })),
    userId,
  };

  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="Configuration steps" className="flex flex-wrap gap-1.5">
        {STEPS.map((name) => (
          <button
            key={name}
            type="button"
            aria-current={name === step}
            onClick={() => {
              if (name === "Advanced (JSON)") setJson(JSON.stringify(config, null, 2));
              setStep(name);
            }}
            className={`rounded px-3 py-1.5 text-xs font-medium ${name === step ? "bg-primary text-primary-foreground" : "bg-surface-container-high text-on-surface hover:bg-surface-active"}`}
          >
            {name}
          </button>
        ))}
      </nav>

      {issues.length > 0 && step !== "Review" && (
        <Alert variant="warning">
          <div>
            <p className="font-medium">Not valid yet:</p>
            <ul className="mt-1 list-disc ps-4">
              {issues.slice(0, 6).map((issue, index) => (
                <li key={index}>
                  {issue.path || "configuration"}: {issue.code}
                </li>
              ))}
            </ul>
          </div>
        </Alert>
      )}
      {error && <Alert variant="destructive">{error}</Alert>}

      <div className="bg-surface-container-low rounded-xl p-5">
        {step === "Connection" && <StepConnection {...props} />}
        {step === "Tickets" && <StepTickets {...props} />}
        {step === "Fields" && <StepMapping {...props} />}
        {step === "Replies and SLA" && <StepReplies {...props} />}
        {step === "Review" && <ReviewPanel save={save} onSample={(sample: Sample) => setSampleTicket(sample.tickets[0] ?? null)} />}
        {step === "Advanced (JSON)" && (
          <div className="flex flex-col gap-3">
            <TextAreaField id="cp-json" label="Configuration document" rows={22} value={json ?? ""} onChange={setJson} hint="The same closed schema the server validates. Credentials never appear here. Unknown keys are rejected." />
            <Button
              type="button"
              size="sm"
              className="self-start"
              onClick={() => {
                try {
                  const parsed = JSON.parse(json ?? "{}");
                  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
                  setConfig(parsed as DraftConfigDocument);
                  setError(null);
                } catch {
                  setError("That is not valid JSON.");
                }
              }}
            >
              Apply
            </Button>
          </div>
        )}
      </div>

      {step !== "Review" && (
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => void save()}>
            Save draft
          </Button>
          <Button type="button" size="sm" onClick={() => setStep(STEPS[Math.min(STEPS.indexOf(step) + 1, 4)]!)}>
            Next
          </Button>
        </div>
      )}
      <p className="text-on-surface-variant text-xs">A draft is kept for 14 days. Nothing changes for your organization until you activate.</p>
    </div>
  );
}
