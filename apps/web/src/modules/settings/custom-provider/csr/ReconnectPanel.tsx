"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Actions } from "@/actions/client";
import { Button } from "@/components/ui/button";
import { notify } from "@/lib/notify";
import { TextField } from "./fields";

const LABELS: Record<string, string> = {
  apiKey: "API key",
  token: "Bearer token",
  username: "Username",
  password: "Password",
  headerValue: "Header value",
};

/**
 * Reconnects a disconnected source on its last activated configuration. Only
 * the credentials are entered again (Disconnect cleared them); nothing is
 * activated and no version is created.
 */
export function ReconnectPanel({ version, secretFields }: { version: number; secretFields: string[] }) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const ready = secretFields.every((field) => (values[field] ?? "") !== "");

  async function reconnect() {
    setBusy(true);
    const result = await Actions.CustomProvider.reconnect(values);
    setBusy(false);
    if (!result.ok) {
      notify.error(
        result.body.code === "invalid_secrets"
          ? "Enter every credential."
          : result.body.code === "trial_expired"
            ? "Your trial has ended. Upgrade to reconnect integrations."
            : "Custom REST could not be reconnected.",
      );
      return;
    }
    notify.success(`Custom REST reconnected on version ${version}.`);
    router.refresh();
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready && !busy) void reconnect();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {secretFields.map((field) => (
          <TextField
            key={field}
            id={`cp-reconnect-${field}`}
            type="password"
            label={LABELS[field] ?? field}
            value={values[field] ?? ""}
            onChange={(value) => setValues((current) => ({ ...current, [field]: value }))}
            placeholder="Required"
            hint="Encrypted at rest and never shown again."
          />
        ))}
      </div>
      <Button type="submit" size="sm" className="self-start" disabled={!ready || busy}>
        {busy && <Loader2 className="animate-spin" />}
        {busy ? "Reconnecting..." : `Reconnect on version ${version}`}
      </Button>
    </form>
  );
}
