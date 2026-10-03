"use client";

import { AlertCircle, Loader2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Actions } from "@/actions/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ConfigurableIntegrationProvider } from "@/lib/types/integrations";

interface IntegrationConfigFormProps {
  provider: ConfigurableIntegrationProvider;
  providerLabel: string;
  /** Present once the integration already has a saved configuration — prefills Client ID, and makes Client Secret optional (blank keeps the existing secret). */
  initialClientId?: string | null;
  onSaved: () => void;
  onCancel?: () => void;
}

/**
 * The client id/secret form shared by zendesk/jira/slack — all three
 * configurable integrations need exactly these two fields (roadmap:
 * integration config refactor). The secret is never prefilled or echoed
 * back by the API, only ever written.
 */
export function IntegrationConfigForm({
  provider,
  providerLabel,
  initialClientId,
  onSaved,
  onCancel,
}: IntegrationConfigFormProps) {
  const isEdit = Boolean(initialClientId);
  const [clientId, setClientId] = useState(initialClientId ?? "");
  const [clientSecret, setClientSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);

    const { ok, body } =
      await Actions.Integrations.saveIntegrationConfig(provider, {
        clientId,
        clientSecret: clientSecret || undefined,
      });

    setSaving(false);

    if (!ok) {
      setError(body.error ?? "Failed to save configuration");
      return;
    }

    setClientSecret("");
    onSaved();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="space-y-1.5">
        <Label htmlFor={`${provider}-client-id`}>Client ID</Label>
        <Input
          id={`${provider}-client-id`}
          value={clientId}
          onChange={(event) => setClientId(event.target.value)}
          placeholder={`${providerLabel} OAuth app client ID`}
          required
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${provider}-client-secret`}>Client Secret</Label>
        <Input
          id={`${provider}-client-secret`}
          type="password"
          autoComplete="off"
          value={clientSecret}
          onChange={(event) => setClientSecret(event.target.value)}
          placeholder={
            isEdit
              ? "Leave blank to keep the current secret"
              : `${providerLabel} OAuth app client secret`
          }
          required={!isEdit}
        />
      </div>

      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={saving}>
          {saving && <Loader2 className="animate-spin" />}
          {saving ? "Saving…" : isEdit ? "Save changes" : "Save configuration"}
        </Button>
        {onCancel && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onCancel}
            disabled={saving}
          >
            Cancel
          </Button>
        )}
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </form>
  );
}
