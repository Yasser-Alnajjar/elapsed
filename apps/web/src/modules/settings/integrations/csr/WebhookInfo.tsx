"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { IntegrationProvider } from "@/lib/types/integrations";

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied outright (e.g. an insecure context) —
      // the value is still selectable in the input, nothing more to do.
    }
  }

  return (
    <div className="min-w-0 space-y-1">
      <Label className="text-xs text-on-surface-variant">{label}</Label>
      <div className="flex min-w-0 items-center gap-2">
        <Input
          readOnly
          value={value}
          title={value}
          onFocus={(event) => event.target.select()}
          className="min-w-0 truncate font-mono text-xs"
        />
        <Button
          type="button"
          size="icon"
          variant="surface"
          className="shrink-0"
          onClick={handleCopy}
          aria-label={`Copy ${label}`}
        >
          {copied ? (
            <Check className="size-3.5" />
          ) : (
            <Copy className="size-3.5" />
          )}
        </Button>
      </div>
    </div>
  );
}

interface WebhookInfoProps {
  provider: IntegrationProvider;
  integrationId: string;
  webhookSecret: string | null;
}

/**
 * Shows the URL and secret the customer pastes
 * into their own provider's webhook admin UI — roadmap step 20's receivers
 * are inbound-only and register nothing on the provider side (no write
 * scope is requested), so this is the entire "setup" surface. Read from
 * `window.location` rather than a server-computed base URL since this
 * already renders client-side and needs no extra env plumbing.
 */
export function WebhookInfo({
  provider,
  integrationId,
  webhookSecret,
}: WebhookInfoProps) {
  const [origin, setOrigin] = useState<string | null>(null);
  useEffect(() => setOrigin(window.location.origin), []);

  if (!webhookSecret) {
    return (
      <p className="text-xs leading-relaxed text-on-surface-variant wrap-break-word">
        Webhooks aren&apos;t available for this connection yet — disconnect and
        reconnect to enable real-time updates.
      </p>
    );
  }

  if (!origin) return null;

  const baseUrl = `${origin}/api/webhooks/${provider}/${integrationId}`;

  if (provider === "zendesk") {
    return (
      <div className="space-y-3">
        <CopyField label="Endpoint URL" value={baseUrl} />
        <CopyField label="Bearer token" value={webhookSecret} />
        <p className="text-xs leading-relaxed text-on-surface-variant wrap-break-word">
          In Zendesk Admin Center, create a webhook with this Endpoint URL
          (Request format: JSON) and Authentication set to{" "}
          <strong>Bearer token</strong> using this token — Zendesk only
          generates its own signing secret after creation, so this is the field
          to use instead. Then add a trigger that calls it with request body{" "}
          <code className="wrap-break-word rounded bg-muted px-1 py-0.5">{`{"ticket_id": "{{ticket.id}}", "timestamp": "{{ticket.updated_at_with_timestamp}}"}`}</code>{" "}
          on ticket status changes. The timestamp field is required, and must use
          that exact placeholder (plain <code>{"{{ticket.updated_at}}"}</code>{" "}
          renders a date without a time) — requests without a recent ISO-8601
          timestamp are rejected as a replay-protection measure.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <CopyField label="Webhook URL" value={baseUrl} />
      <CopyField label="Secret" value={webhookSecret} />
      <p className="text-xs leading-relaxed text-on-surface-variant wrap-break-word">
        In Jira, add a WebHook (Settings → System → WebHooks) with this URL,
        paste this value into its <strong>Secret</strong> field, and subscribe
        it to Issue: created and Issue: updated events. Jira signs every
        delivery with the secret, so it never appears in the URL.
      </p>
      <p className="text-xs leading-relaxed text-on-surface-variant wrap-break-word">
        Set up earlier with a URL ending in <code>?secret=…</code>? It keeps
        working, but that URL can end up in proxy logs. Edit the webhook in
        Jira, remove <code>?secret=…</code> from the URL, and paste the secret
        into the Secret field instead.
      </p>
    </div>
  );
}
