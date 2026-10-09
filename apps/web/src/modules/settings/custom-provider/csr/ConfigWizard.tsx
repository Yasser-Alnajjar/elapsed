"use client";

import { useFormik } from "formik";
import { useMemo, useRef, useState } from "react";
import { Actions } from "@/actions/client";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { notify } from "@/lib/notify";
import { emptyConfig, samplePaths, setIn } from "@/lib/custom-provider/wizard";
import type { CustomProviderPageData, DraftConfigDocument, Sample } from "@/lib/types/custom-provider";
import { ReviewPanel } from "./ReviewPanel";
import { StepConnection } from "./StepConnection";
import { StepMapping } from "./StepMapping";
import { StepReplies } from "./StepReplies";
import { StepTickets } from "./StepTickets";
import { TextAreaField } from "./fields";
import type { StepProps } from "./wizard-types";

interface WizardValues {
  config: DraftConfigDocument;
  /** New secret values typed in this session (write-only). */
  secrets: Record<string, string>;
  /** The Advanced tab's editor text. */
  json: string;
}

const STEPS = ["Connection", "Tickets", "Fields", "Replies and SLA", "Review", "Advanced (JSON)"] as const;

/**
 * The guided configuration (plan 09, 4 and 6.8). The document is the same
 * closed-schema JSON the server validates; the steps edit it and the Advanced
 * tab shows all of it. Saving writes the draft only; nothing changes for the
 * organization until Activate. Secrets are write-only.
 */
export function ConfigWizard({ initial, secretsSet: initialSecretsSet, userId }: { initial: CustomProviderPageData["draft"]; secretsSet: string[]; userId: string }) {
  const [step, setStep] = useState<(typeof STEPS)[number]>("Connection");
  const [secretsSet, setSecretsSet] = useState<string[]>(initialSecretsSet);
  const [issues, setIssues] = useState(initial?.issues ?? []);
  const [sampleTicket, setSampleTicket] = useState<unknown>(null);
  const saved = useRef(false);
  const quiet = useRef(false);

  const formik = useFormik<WizardValues>({
    initialValues: { config: (initial?.config as DraftConfigDocument | undefined) ?? emptyConfig(), secrets: {}, json: "" },
    onSubmit: async (values, { setFieldValue }) => {
      saved.current = false;
      const typed = Object.fromEntries(Object.entries(values.secrets).filter(([, v]) => v !== ""));
      const result = await Actions.CustomProvider.saveDraft(values.config, Object.keys(typed).length ? typed : undefined);
      if (!result.ok || !result.body.draft) {
        notify.error(result.body.error === "unknown_secret_field" ? "A credential does not match the authentication type." : "The draft could not be saved.");
        return;
      }
      setSecretsSet(result.body.draft.secretsSet);
      setIssues(result.body.draft.issues);
      await setFieldValue("secrets", {});
      saved.current = true;
      if (!quiet.current) notify.success("Draft saved.");
    },
  });

  const { config } = formik.values;
  const paths = useMemo(() => (sampleTicket ? samplePaths(sampleTicket).map((p) => p.path) : []), [sampleTicket]);

  /** `silent` skips the "saved" toast, for the checks on the Review step that save first. */
  async function save(silent = false): Promise<boolean> {
    quiet.current = silent;
    await formik.submitForm();
    return saved.current;
  }

  const props: StepProps = {
    config,
    set: (path, value) => void formik.setFieldValue("config", setIn(config, path, value)),
    paths,
    secretsSet,
    secrets: formik.values.secrets,
    setSecret: (field, value) => void formik.setFieldValue(`secrets.${field}`, value),
    userId,
  };

  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="Configuration steps" className="flex flex-wrap gap-1.5">
        {STEPS.map((name) => (
          <Button
            key={name}
            type="button"
            size="sm"
            variant={name === step ? "default" : "surface"}
            aria-current={name === step}
            onClick={() => {
              if (name === "Advanced (JSON)") void formik.setFieldValue("json", JSON.stringify(config, null, 2));
              setStep(name);
            }}
          >
            {name}
          </Button>
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

      <div className="bg-surface-container-low rounded-xl p-5">
        {step === "Connection" && <StepConnection {...props} />}
        {step === "Tickets" && <StepTickets {...props} />}
        {step === "Fields" && <StepMapping {...props} />}
        {step === "Replies and SLA" && <StepReplies {...props} />}
        {step === "Review" && <ReviewPanel save={() => save(true)} onSample={(sample: Sample) => setSampleTicket(sample.tickets[0] ?? null)} />}
        {step === "Advanced (JSON)" && (
          <div className="flex flex-col gap-3">
            <TextAreaField id="cp-json" label="Configuration document" rows={22} value={formik.values.json} onChange={(v) => void formik.setFieldValue("json", v)} hint="The same closed schema the server validates. Credentials never appear here. Unknown keys are rejected." />
            <Button
              type="button"
              size="sm"
              className="self-start"
              onClick={() => {
                try {
                  const parsed = JSON.parse(formik.values.json || "{}");
                  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
                  void formik.setFieldValue("config", parsed as DraftConfigDocument);
                  notify.success("Configuration applied. Save the draft to keep it.");
                } catch {
                  notify.error("That is not valid JSON.");
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
          <Button type="button" size="sm" variant="outline" disabled={formik.isSubmitting} onClick={() => void formik.submitForm()}>
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
