"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Actions } from "@/actions/client";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { REASON_COPY, UNSUPPORTED_KIND_COPY } from "@/lib/custom-provider/state-copy";
import type { ActivateOutcome, ConnectionTest, Preview, Sample, ValidateResponse } from "@/lib/types/custom-provider";
import { ImpactPanel } from "./ImpactPanel";

const CLASSIFICATION_COPY: Record<string, string> = {
  ok: "The connection works.",
  blocked_destination: "That address is not allowed. Use a public HTTPS address.",
  unreachable: "The address could not be reached.",
  timeout: "The request timed out.",
  tls_error: "The certificate could not be verified for that address.",
  auth_failed: "The credentials were rejected.",
  forbidden: "The credentials were accepted but access was denied.",
  rate_limited: "Your API is rate limiting requests.",
  bad_response: "The response was not valid JSON in the expected shape.",
};

const VERDICT_LABEL = { supported: "Supported", supported_with_limitations: "Supported, with limits", unsupported: "Not supported" } as const;
const METRIC_LABEL = { first_response: "First response", next_reply: "Next reply", resolution: "Resolution" } as const;

/** Step 5: save, check the connection, look at a sample, preview what Elapsed would derive, validate, activate. */
export function ReviewPanel({ save, onSample }: { save: () => Promise<boolean>; onSample: (sample: Sample) => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [test, setTest] = useState<ConnectionTest | null>(null);
  const [sample, setSample] = useState<Sample | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [validation, setValidation] = useState<ValidateResponse | null>(null);
  const [outcome, setOutcome] = useState<ActivateOutcome | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function run<T>(name: string, action: () => Promise<{ ok: boolean; status: number; body: T & { error?: string } }>, apply: (body: T) => void) {
    setBusy(name);
    setMessage(null);
    if (!(await save())) {
      setBusy(null);
      setMessage("The draft could not be saved.");
      return;
    }
    const result = await action();
    setBusy(null);
    if (!result.ok) {
      setMessage(result.status === 429 ? "Too many checks. Try again in a minute." : `That check could not run (${result.body.error ?? "error"}).`);
      return;
    }
    apply(result.body);
  }

  async function activate(confirmPreviewHash?: string) {
    setBusy("activate");
    setMessage(null);
    if (!(await save())) {
      setBusy(null);
      setMessage("The draft could not be saved.");
      return;
    }
    const result = await Actions.CustomProvider.activate({ confirmPreviewHash });
    setBusy(null);
    setOutcome(result);
    if (result.kind === "activated") router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => run("test", Actions.CustomProvider.testConnection, setTest)}>
          Test connection
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy !== null}
          onClick={() =>
            run("sample", Actions.CustomProvider.sample, (body) => {
              setSample(body);
              onSample(body);
            })
          }
        >
          Show a sample
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => run("preview", Actions.CustomProvider.preview, setPreview)}>
          Preview what Elapsed derives
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => run("validate", Actions.CustomProvider.validate, setValidation)}>
          Check support
        </Button>
      </div>
      {busy && <p className="text-on-surface-variant text-xs">Working: {busy}…</p>}
      {message && <Alert variant="destructive">{message}</Alert>}

      {test && <Alert variant={test.classification === "ok" ? "success" : "destructive"}>{CLASSIFICATION_COPY[test.classification] ?? test.classification}</Alert>}

      {sample && (
        <details open className="bg-surface-container-low rounded-lg p-3 text-xs">
          <summary className="cursor-pointer font-medium">Sample from your API ({sample.itemCount} tickets on the first page{sample.hasNextPage ? ", more pages" : ""})</summary>
          <p className="text-on-surface-variant my-2">Shown only to you. It is not stored.</p>
          <pre className="max-h-72 overflow-auto font-mono">{JSON.stringify(sample.tickets[0] ?? null, null, 2)}</pre>
        </details>
      )}

      {preview && (
        <div className="bg-surface-container-low rounded-lg p-3 text-xs">
          <p className="font-medium">
            Preview: {preview.ticketsRead} tickets read, {preview.tickets.length} would be created, {preview.failures.length} would fail.
          </p>
          {preview.failures.length > 0 && (
            <ul className="text-warning mt-2">
              {preview.failures.slice(0, 10).map((f) => (
                <li key={f.id}>
                  Ticket {f.id}: {f.code}
                </li>
              ))}
            </ul>
          )}
          <ul className="mt-2 flex flex-col gap-1">
            {preview.tickets.slice(0, 8).map((t) => (
              <li key={t.externalId}>
                <span className="font-mono">{t.externalId}</span> {t.subject ?? ""} — {t.events.map((e) => e.type).join(" → ")}
                {t.closedAt ? ` (closed ${t.closedAt.slice(0, 10)})` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      {validation && (
        <div className="bg-surface-container-low flex flex-col gap-2 rounded-lg p-3 text-xs">
          {!validation.ok && (
            <Alert variant="destructive">
              <ul>
                {validation.issues.map((i, index) => (
                  <li key={`i${index}`}>
                    {i.path || "configuration"}: {i.code}
                  </li>
                ))}
                {validation.diagnostics
                  .filter((d) => d.severity === "error")
                  .map((d, index) => (
                    <li key={`d${index}`}>
                      {d.path}: {REASON_COPY[d.code] ?? d.code}
                    </li>
                  ))}
              </ul>
            </Alert>
          )}
          {validation.support && (
            <table>
              <tbody>
                {(Object.keys(validation.support) as (keyof typeof METRIC_LABEL)[]).map((metric) => (
                  <tr key={metric} className="align-top">
                    <td className="pe-4 font-medium">{METRIC_LABEL[metric]}</td>
                    <td className="pe-4">{VERDICT_LABEL[validation.support![metric].state]}</td>
                    <td className="text-on-surface-variant">{validation.support![metric].reasons.map((r) => REASON_COPY[r] ?? r).join(" ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {validation.requiredSecrets && validation.requiredSecrets.some((f) => !validation.secretsSet?.includes(f)) && (
            <Alert variant="warning">Enter your credentials in the Connection step before activating.</Alert>
          )}
        </div>
      )}

      <div className="border-outline-variant/20 flex flex-col gap-3 border-t pt-4">
        {outcome?.kind === "needs_confirmation" ? (
          <ImpactPanel impact={outcome.impact} busy={busy !== null} onConfirm={() => activate(outcome.impact.cancellation?.previewHash)} onCancel={() => setOutcome(null)} />
        ) : (
          <Button type="button" disabled={busy !== null} onClick={() => activate()} className="self-start">
            Activate this configuration
          </Button>
        )}
        {outcome?.kind === "activated" && <Alert variant="success">Activated as version {outcome.version}.{outcome.cancelled > 0 ? ` ${outcome.cancelled} commitments were cancelled.` : ""}</Alert>}
        {outcome?.kind === "listing_too_large" && (
          <Alert variant="destructive">
            Your API has no way to ask for only recent changes, and a full listing did not finish in one sync ({outcome.measurement.pages} pages, {outcome.measurement.tickets} tickets, {outcome.measurement.requests} requests, {outcome.measurement.seconds} s;
            stopped by {outcome.measurement.stoppedBy}). Add an updated-since parameter in the Tickets step.
          </Alert>
        )}
        {outcome?.kind === "invalid" && (
          <Alert variant="destructive">
            This configuration cannot be activated yet:{" "}
            {[...outcome.issues.map((i) => `${i.path || "configuration"} (${i.code})`), ...outcome.diagnostics.filter((d) => d.severity === "error").map((d) => REASON_COPY[d.code] ?? d.code)].join("; ")}
          </Alert>
        )}
        {outcome?.kind === "error" && (
          <Alert variant="destructive">
            {outcome.code === "secrets_missing"
              ? `Enter these credentials first: ${(outcome.missing ?? []).join(", ")}.`
              : outcome.code === "next_reply_restore_blocked"
                ? "This configuration would support Next reply again while earlier Next reply commitments are cancelled. That is not allowed yet."
                : `Activation did not complete (${outcome.code}).`}
          </Alert>
        )}
      </div>
    </div>
  );
}
