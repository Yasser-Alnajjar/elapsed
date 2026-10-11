"use client";

import { Check, ChevronRight, Info, ShieldCheck } from "lucide-react";
import { useFormik } from "formik";
import { useMemo, useRef, useState } from "react";
import { Actions } from "@/actions/client";
import { useOrgTimezone } from "@/components/shared/org-timezone-provider";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { formatLongDateTime } from "@/lib/format";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import {
  emptyConfig,
  getIn,
  samplePaths,
  setIn,
} from "@/lib/custom-provider/wizard";
import {
  CONFIRMATION_ERROR_PATHS,
  POST_CONFIRMATION_MESSAGE,
  confirmationErrors,
  customConfigFormSchema,
} from "@/lib/custom-provider/wizard-schema";
import type {
  CustomProviderPageData,
  DraftConfigDocument,
  Sample,
} from "@/lib/types/custom-provider";
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

const STEPS = [
  "Connection",
  "Tickets",
  "Fields",
  "Replies and SLA",
  "Advanced (JSON)",
  "Review",
] as const;

/**
 * The guided configuration (plan 09, 4 and 6.8). The document is the same
 * closed-schema JSON the server validates; the steps edit it and the Advanced
 * tab shows all of it. Saving writes the draft only; nothing changes for the
 * organization until Activate. Secrets are write-only.
 */
export function ConfigWizard({
  initial,
  secretsSet: initialSecretsSet,
  userId,
}: {
  initial: CustomProviderPageData["draft"];
  secretsSet: string[];
  userId: string;
}) {
  const timeZone = useOrgTimezone();
  const [step, setStep] = useState<(typeof STEPS)[number]>("Connection");
  const [secretsSet, setSecretsSet] = useState<string[]>(initialSecretsSet);
  const [issues, setIssues] = useState(initial?.issues ?? []);
  const [sampleTicket, setSampleTicket] = useState<unknown>(null);
  const saved = useRef(false);
  const quiet = useRef(false);
  /** Set once the owner has tried to save or continue with an unconfirmed POST; the inline error shows from then on. */
  const [attempted, setAttempted] = useState(false);

  const formik = useFormik<WizardValues>({
    initialValues: {
      config:
        (initial?.config as DraftConfigDocument | undefined) ?? emptyConfig(),
      secrets: {},
      json: "",
    },
    // Backstop: Formik does not call onSubmit while the configuration has an unconfirmed POST. The server enforces the same rule.
    validationSchema: customConfigFormSchema,
    onSubmit: async (values, { setFieldValue }) => {
      saved.current = false;
      const typed = Object.fromEntries(
        Object.entries(values.secrets).filter(([, v]) => v !== ""),
      );
      const result = await Actions.CustomProvider.saveDraft(
        values.config,
        Object.keys(typed).length ? typed : undefined,
      );
      if (
        !result.ok &&
        result.body.error === "post_requires_read_only_designation"
      ) {
        showConfirmationError();
        return;
      }
      if (!result.ok || !result.body.draft) {
        notify.error(
          result.body.error === "unknown_secret_field"
            ? "A credential does not match the authentication type."
            : "The draft could not be saved.",
        );
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
  const paths = useMemo(
    () => (sampleTicket ? samplePaths(sampleTicket).map((p) => p.path) : []),
    [sampleTicket],
  );

  /** Takes the owner to the ticket request, where the checkbox is, and says why they cannot continue. */
  function showConfirmationError() {
    setAttempted(true);
    setStep("Tickets");
    notify.error(POST_CONFIRMATION_MESSAGE);
  }

  /** True when the configuration may be saved or left behind: no POST without its confirmation. */
  async function confirmationsHold(): Promise<boolean> {
    if (confirmationErrors(await formik.validateForm()).length === 0)
      return true;
    showConfirmationError();
    return false;
  }

  /** `silent` skips the "saved" toast, for the checks on the Review step that save first. */
  async function save(silent = false): Promise<boolean> {
    saved.current = false;
    quiet.current = silent;
    if (!(await confirmationsHold())) return false;
    await formik.submitForm();
    return saved.current;
  }

  /** Moving forward needs every POST confirmed; moving back does not. */
  async function goTo(target: (typeof STEPS)[number]) {
    if (
      STEPS.indexOf(target) > STEPS.indexOf(step) &&
      !(await confirmationsHold())
    )
      return;
    if (target === "Advanced (JSON)")
      void formik.setFieldValue("json", JSON.stringify(config, null, 2));
    setStep(target);
  }

  const ticketsConfirmationError = attempted
    ? (getIn(formik.errors, CONFIRMATION_ERROR_PATHS[0]) as string | undefined)
    : undefined;
  const otherConfirmationErrors = attempted
    ? confirmationErrors(formik.errors).slice(ticketsConfirmationError ? 1 : 0)
    : [];

  const props: StepProps = {
    config,
    set: (path, value) =>
      void formik.setFieldValue("config", setIn(config, path, value)),
    paths,
    secretsSet,
    secrets: formik.values.secrets,
    setSecret: (field, value) =>
      void formik.setFieldValue(`secrets.${field}`, value),
    userId,
    postConfirmationError: ticketsConfirmationError,
  };

  const stepIndex = STEPS.indexOf(step);
  const expires = initial?.expiresAt
    ? formatLongDateTime(new Date(initial.expiresAt), timeZone)
    : null;

  return (
    <div className="flex flex-col gap-6">
      <nav
        aria-label="Configuration steps"
        className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6"
      >
        {STEPS.map((name, index) => {
          const active = name === step;
          const done = index < stepIndex;
          return (
            <button
              key={name}
              type="button"
              aria-current={active ? "step" : undefined}
              onClick={() => void goTo(name)}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-lg p-2.5 text-start font-mono text-xs transition-colors",
                active
                  ? "bg-primary-container text-on-primary-container font-semibold"
                  : "bg-surface-raised text-on-surface-variant hover:bg-surface-hover",
              )}
            >
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
                  active
                    ? "bg-on-primary-container text-primary-container"
                    : done
                      ? "bg-success/20 text-success"
                      : "bg-surface text-on-surface-variant",
                )}
              >
                {done ? <Check className="size-3" /> : index + 1}
              </span>
              <span className="truncate">{name}</span>
            </button>
          );
        })}
      </nav>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-8">
          {otherConfirmationErrors.length > 0 && (
            <Alert variant="warning">
              A POST in the replies, ticket detail or history request is not
              confirmed as a read-only search. Set <code>readOnlySearch</code>{" "}
              to true in the Advanced (JSON) tab only if it is, or change the
              method to GET.
            </Alert>
          )}

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

          <div className="bg-surface-container-low flex flex-col gap-4 rounded-xl p-5">
            {step === "Connection" && <StepConnection {...props} />}
            {step === "Tickets" && <StepTickets {...props} />}
            {step === "Fields" && <StepMapping {...props} />}
            {step === "Replies and SLA" && <StepReplies {...props} />}
            {step === "Review" && (
              <ReviewPanel
                save={() => save(true)}
                onSample={(sample: Sample) =>
                  setSampleTicket(sample.tickets[0] ?? null)
                }
              />
            )}
            {step === "Advanced (JSON)" && (
              <div className="flex flex-col gap-3">
                <TextAreaField
                  id="cp-json"
                  label="Configuration document"
                  rows={22}
                  value={formik.values.json}
                  onChange={(v) => void formik.setFieldValue("json", v)}
                  hint="The same closed schema the server validates. Credentials never appear here. Unknown keys are rejected."
                />
                <Button
                  type="button"
                  size="sm"
                  className="self-start"
                  onClick={() => {
                    try {
                      const parsed = JSON.parse(formik.values.json || "{}");
                      if (
                        parsed === null ||
                        typeof parsed !== "object" ||
                        Array.isArray(parsed)
                      )
                        throw new Error("not an object");
                      void formik.setFieldValue(
                        "config",
                        parsed as DraftConfigDocument,
                      );
                      notify.success(
                        "Configuration applied. Save the draft to keep it.",
                      );
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
            <div className="flex gap-2 pt-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={formik.isSubmitting}
                onClick={() => void save()}
              >
                Save draft
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() =>
                  void goTo(STEPS[Math.min(stepIndex + 1, STEPS.length - 1)]!)
                }
              >
                Next
              </Button>
            </div>
          )}
        </div>

        <aside className="flex min-w-0 flex-col gap-4 lg:col-span-4">
          <div className="bg-surface-raised flex flex-col gap-2 rounded-xl p-4">
            <div className="text-on-surface flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-wider">
              <Info className="text-primary size-4" />
              Draft
            </div>
            <p className="text-on-surface-variant text-xs">
              A draft is kept for 14 days
              {expires ? ` (this one expires ${expires})` : ""}.{" "}
              <strong className="text-on-surface">
                Nothing changes for your organization until you activate.
              </strong>
            </p>
          </div>

          <div className="bg-surface-raised flex flex-col gap-2 rounded-xl p-4">
            <div className="text-on-surface flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-wider">
              <ShieldCheck className="text-primary size-4" />
              Credentials
            </div>
            <p className="text-on-surface-variant text-xs leading-relaxed">
              Credentials are encrypted and write-only. Once saved they are
              never shown again, in this page or in any log.
            </p>
          </div>

          <div className="bg-surface-container flex flex-col gap-1 rounded-xl p-4">
            <span className="text-on-surface-variant mb-1 font-mono text-[10px] font-semibold uppercase tracking-wider">
              Go to step
            </span>
            {STEPS.map((name, index) => (
              <button
                key={name}
                type="button"
                onClick={() => void goTo(name)}
                className={cn(
                  "hover:bg-surface-container-lowest flex cursor-pointer items-center justify-between rounded p-1.5 text-start text-xs transition-colors",
                  name === step
                    ? "text-primary font-semibold"
                    : "text-on-surface-variant hover:text-on-surface",
                )}
              >
                <span>
                  {index + 1}. {name}
                </span>
                <ChevronRight className="size-4" />
              </button>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
