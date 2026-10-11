"use client";

import {
  Activity,
  BadgeCheck,
  Braces,
  GitCompare,
  LineChart,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Actions } from "@/actions/client";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { notify } from "@/lib/notify";
import {
  REASON_COPY,
  UNSUPPORTED_KIND_COPY,
} from "@/lib/custom-provider/state-copy";
import type {
  ActivateOutcome,
  ConfigDiff,
  ConnectionTest,
  Preview,
  Sample,
  ValidateResponse,
} from "@/lib/types/custom-provider";
import { ConfigDiffPanel } from "./ConfigDiffPanel";
import { FailureReasons } from "./FailureReasons";
import { ImpactPanel } from "./ImpactPanel";

const CLASSIFICATION_COPY: Record<string, string> = {
  ok: "The connection works.",
  blocked_destination:
    "That address is not allowed. Use a public HTTPS address.",
  unreachable: "The address could not be reached.",
  timeout: "The request timed out.",
  tls_error: "The certificate could not be verified for that address.",
  auth_failed: "The credentials were rejected.",
  forbidden: "The credentials were accepted but access was denied.",
  rate_limited: "Your API is rate limiting requests.",
  bad_response: "The response was not valid JSON in the expected shape.",
};

const VERDICT_LABEL = {
  supported: "Supported",
  supported_with_limitations: "Supported, with limits",
  unsupported: "Not supported",
} as const;
const VERDICT_BADGE = {
  supported: "success",
  supported_with_limitations: "warning",
  unsupported: "destructive",
} as const;
const VERDICT_MARK = {
  supported: "●",
  supported_with_limitations: "▲",
  unsupported: "✕",
} as const;
const METRIC_LABEL = {
  first_response: "First response",
  next_reply: "Next reply",
  resolution: "Resolution",
} as const;

function reportTest(test: ConnectionTest) {
  const message =
    CLASSIFICATION_COPY[test.classification] ?? test.classification;
  if (test.classification === "ok") notify.success(message);
  else notify.error(message);
}

function reportValidation(validation: ValidateResponse) {
  if (!validation.ok) {
    const lines = [
      ...validation.issues.map(
        (i) => `${i.path || "configuration"}: ${i.code}`,
      ),
      ...validation.diagnostics
        .filter((d) => d.severity === "error")
        .map((d) => `${d.path}: ${REASON_COPY[d.code] ?? d.code}`),
    ];
    notify.error("This configuration has problems.", {
      description: lines.slice(0, 6).join("; "),
    });
  }
  if (
    validation.requiredSecrets?.some((f) => !validation.secretsSet?.includes(f))
  ) {
    notify.warning(
      "Enter your credentials in the Connection step before activating.",
    );
  }
}

/** Activation results that did not activate and need no panel of their own. */
function reportOutcome(outcome: ActivateOutcome) {
  if (outcome.kind === "listing_too_large") {
    const m = outcome.measurement;
    notify.error("Your API has no way to ask for only recent changes.", {
      description: `A full listing did not finish in one sync (${m.pages} pages, ${m.tickets} tickets, ${m.requests} requests, ${m.seconds} s; stopped by ${m.stoppedBy}). Add an updated-since parameter in the Tickets step.`,
    });
  } else if (outcome.kind === "invalid") {
    const lines = [
      ...outcome.issues.map((i) => `${i.path || "configuration"} (${i.code})`),
      ...outcome.diagnostics
        .filter((d) => d.severity === "error")
        .map((d) => REASON_COPY[d.code] ?? d.code),
    ];
    notify.error("This configuration cannot be activated yet.", {
      description: lines.slice(0, 6).join("; "),
    });
  } else if (outcome.kind === "error") {
    notify.error(
      outcome.code === "secrets_missing"
        ? `Enter these credentials first: ${(outcome.missing ?? []).join(", ")}.`
        : outcome.code === "next_reply_restore_blocked"
          ? "This configuration would support Next reply again while earlier Next reply commitments are cancelled. That is not allowed yet."
          : `Activation did not complete (${outcome.code}).`,
    );
  }
}

/** Step 5: save, check the connection, look at a sample, preview what Elapsed would derive, validate, activate. */
export function ReviewPanel({
  save,
  onSample,
}: {
  save: () => Promise<boolean>;
  onSample: (sample: Sample) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [sample, setSample] = useState<Sample | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [validation, setValidation] = useState<ValidateResponse | null>(null);
  const [diff, setDiff] = useState<ConfigDiff | null>(null);
  const [outcome, setOutcome] = useState<ActivateOutcome | null>(null);
  // The dry-run diff the owner confirmed (plan 09, 6.8); kept for the commitment confirmation that may follow.
  const [confirmedDiffHash, setConfirmedDiffHash] = useState<
    string | undefined
  >(undefined);

  async function run<T>(
    name: string,
    action: () => Promise<{
      ok: boolean;
      status: number;
      body: T & { error?: string };
    }>,
    apply: (body: T) => void,
  ) {
    setBusy(name);
    if (!(await save())) {
      setBusy(null);
      return;
    }
    const result = await action();
    setBusy(null);
    if (!result.ok) {
      notify.error(
        result.status === 429
          ? "Too many checks. Try again in a minute."
          : `That check could not run (${result.body.error ?? "error"}).`,
      );
      return;
    }
    apply(result.body);
  }

  async function activate(
    confirmPreviewHash?: string,
    confirmDiffHash = confirmedDiffHash,
  ) {
    setBusy("activate");
    if (!(await save())) {
      setBusy(null);
      return;
    }
    setConfirmedDiffHash(confirmDiffHash);
    const result = await Actions.CustomProvider.activate({
      confirmPreviewHash,
      confirmDiffHash,
    });
    setBusy(null);
    setOutcome(result);
    if (result.kind === "activated") {
      notify.success(
        `Activated as version ${result.version}.${result.cancelled > 0 ? ` ${result.cancelled} commitments were cancelled.` : ""}`,
      );
      router.refresh();
    } else {
      reportOutcome(result);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <span className="text-on-surface-variant font-mono text-[10px] font-semibold uppercase tracking-wider">
          Checks before you activate
        </span>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="surface"
            disabled={busy !== null}
            onClick={() =>
              run("test", Actions.CustomProvider.testConnection, reportTest)
            }
          >
            <Activity className="size-4" />
            Test connection
          </Button>
          <Button
            type="button"
            size="sm"
            variant="surface"
            disabled={busy !== null}
            onClick={() =>
              run("sample", Actions.CustomProvider.sample, (body) => {
                setSample(body);
                onSample(body);
              })
            }
          >
            <Braces className="size-4" />
            Show a sample
          </Button>
          <Button
            type="button"
            size="sm"
            variant="surface"
            disabled={busy !== null}
            onClick={() =>
              run("preview", Actions.CustomProvider.preview, setPreview)
            }
          >
            <LineChart className="size-4" />
            Preview what Elapsed derives
          </Button>
          <Button
            type="button"
            size="sm"
            variant="surface"
            disabled={busy !== null}
            onClick={() =>
              run("validate", Actions.CustomProvider.validate, (body) => {
                setValidation(body);
                reportValidation(body);
              })
            }
          >
            <BadgeCheck className="size-4" />
            Check support
          </Button>
          <Button
            type="button"
            size="sm"
            variant="surface"
            disabled={busy !== null}
            onClick={() =>
              run("compare", Actions.CustomProvider.dryRun, setDiff)
            }
          >
            <GitCompare className="size-4" />
            Compare with stored data
          </Button>
        </div>
      </div>
      {busy && (
        <p className="text-on-surface-variant text-xs">Working: {busy}…</p>
      )}

      {sample && (
        <Accordion
          type="single"
          collapsible
          defaultValue="sample"
          className="bg-surface-container-low rounded-lg px-3 text-xs"
        >
          <AccordionItem value="sample" className="border-0">
            <AccordionTrigger className="text-xs">
              Sample from your API ({sample.itemCount} tickets on the first page
              {sample.hasNextPage ? ", more pages" : ""})
            </AccordionTrigger>
            <AccordionContent className="text-xs">
              <p className="text-on-surface-variant mb-2">
                Shown only to you. It is not stored.
              </p>
              <pre className="max-h-72 overflow-auto font-mono">
                {JSON.stringify(sample.tickets[0] ?? null, null, 2)}
              </pre>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      )}

      {preview && (
        <div className="bg-surface-container-low rounded-lg p-3 text-xs">
          <p className="font-medium">
            Preview: {preview.ticketsRead} tickets read,{" "}
            {preview.tickets.length} would be created, {preview.failures.length}{" "}
            would fail.
          </p>
          {preview.failures.length > 0 && (
            <ul className="text-warning mt-2">
              {preview.failures.slice(0, 10).map((f) => (
                <li key={f.id}>
                  Ticket {f.id}:{" "}
                  <FailureReasons code={f.code} details={f.details} />
                </li>
              ))}
            </ul>
          )}
          <ul className="mt-2 flex flex-col gap-1">
            {preview.tickets.slice(0, 8).map((t) => (
              <li key={t.externalId}>
                <span className="font-mono">{t.externalId}</span>{" "}
                {t.subject ?? ""} — {t.events.map((e) => e.type).join(" → ")}
                {t.closedAt ? ` (closed ${t.closedAt.slice(0, 10)})` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      {validation && (
        <div className="bg-surface-container-low flex flex-col gap-2 rounded-lg p-3 text-xs">
          {validation.support && (
            <div className="flex flex-col gap-2">
              <span className="text-on-surface font-mono text-xs font-bold uppercase tracking-wider">
                What Elapsed can measure
              </span>
              {(
                Object.keys(validation.support) as (keyof typeof METRIC_LABEL)[]
              ).map((metric) => {
                const verdict = validation.support![metric];
                return (
                  <div
                    key={metric}
                    className="bg-surface-container-lowest flex items-center justify-between gap-1 rounded-lg p-3"
                  >
                    <span className="text-on-surface text-sm font-semibold">
                      {METRIC_LABEL[metric]}
                    </span>
                    <Badge
                      variant={VERDICT_BADGE[verdict.state]}
                      className="font-mono text-[10px] uppercase"
                    >
                      {VERDICT_MARK[verdict.state]}{" "}
                      {VERDICT_LABEL[verdict.state]}
                    </Badge>
                    {verdict.reasons.length > 0 && (
                      <p className="text-on-surface-variant">
                        {verdict.reasons
                          .map((r) => REASON_COPY[r] ?? r)
                          .join(" ")}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {diff && outcome?.kind !== "needs_diff_review" && (
        <ConfigDiffPanel diff={diff} busy={busy !== null} />
      )}

      <div className="border-outline-variant/20 flex flex-col gap-3 border-t pt-4">
        {outcome?.kind === "needs_diff_review" ? (
          <ConfigDiffPanel
            diff={outcome.diff}
            busy={busy !== null}
            onConfirm={() =>
              activate(undefined, outcome.diff.hash ?? undefined)
            }
            onCancel={() => setOutcome(null)}
          />
        ) : outcome?.kind === "needs_confirmation" ? (
          <ImpactPanel
            impact={outcome.impact}
            busy={busy !== null}
            onConfirm={() => activate(outcome.impact.cancellation?.previewHash)}
            onCancel={() => setOutcome(null)}
          />
        ) : (
          <Button
            type="button"
            disabled={busy !== null}
            onClick={() => activate()}
            className="self-start"
          >
            Activate this configuration
          </Button>
        )}
      </div>
    </div>
  );
}
