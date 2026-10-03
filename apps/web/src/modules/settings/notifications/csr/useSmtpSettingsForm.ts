"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { Actions } from "@/actions/client";
import type { EmailSettingsFormInput } from "@/actions/client";
import type {
  EmailSecurity,
  EmailSettingsStatus,
} from "@/lib/types/email-settings";

export interface SmtpActionState {
  pending: boolean;
  result: { ok: boolean; message?: string; error?: string } | null;
}

const IDLE_STATE: SmtpActionState = { pending: false, result: null };

/**
 * Non-blocking heads-up only — a real SMTP server can legitimately run any
 * security mode on any port (roadmap: organization SMTP configuration, item
 * 10), so this never prevents Test Connection/Send Test Email/Save from
 * running.
 */
function unusualCombinationWarning(
  port: number,
  security: EmailSecurity,
): string | null {
  if (security === "ssl_tls" && port === 587) {
    return "Port 587 is normally used with STARTTLS, not SSL/TLS — this combination can still work if your provider supports it.";
  }
  if (security === "starttls" && port === 465) {
    return "Port 465 is normally used with SSL/TLS, not STARTTLS — this combination can still work if your provider supports it.";
  }
  if (security === "none" && (port === 465 || port === 587)) {
    return "Sending unencrypted over a port normally reserved for TLS/STARTTLS — double-check this is intended.";
  }
  return null;
}

/**
 * The SMTP settings form: field values, the port/security heads-up, and the
 * test-connection / send-test / save actions, each tracking its own pending
 * state and result. The password is write-only and cleared after a save.
 */
export function useSmtpSettingsForm(status: EmailSettingsStatus) {
  const router = useRouter();
  const isEdit = status.configured;

  const [host, setHost] = useState(status.host ?? "");
  const [port, setPort] = useState(String(status.port ?? 587));
  const [security, setSecurity] = useState<EmailSecurity>(
    status.security ?? "starttls",
  );
  const [username, setUsername] = useState(status.username ?? "");
  const [password, setPassword] = useState("");
  const [fromEmail, setFromEmail] = useState(status.fromEmail ?? "");
  const [fromName, setFromName] = useState(status.fromName ?? "");

  const [testConnection, setTestConnection] =
    useState<SmtpActionState>(IDLE_STATE);
  const [testSend, setTestSend] = useState<SmtpActionState>(IDLE_STATE);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<SmtpActionState["result"]>(null);

  const portNumber = Number(port);
  const warning = useMemo(
    () =>
      Number.isFinite(portNumber) && portNumber > 0
        ? unusualCombinationWarning(portNumber, security)
        : null,
    [portNumber, security],
  );

  function buildInput(): EmailSettingsFormInput {
    return {
      host: host.trim(),
      port: portNumber,
      security,
      username: username.trim(),
      password: password || undefined,
      fromEmail: fromEmail.trim(),
      fromName: fromName.trim() || undefined,
    };
  }

  async function handleTestConnection() {
    setTestConnection({ pending: true, result: null });
    const result = await Actions.Email.testConnection(buildInput());
    setTestConnection({ pending: false, result });
  }

  async function handleSendTest() {
    setTestSend({ pending: true, result: null });
    const result = await Actions.Email.sendTestEmail(buildInput());
    setTestSend({ pending: false, result });
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setSaveResult(null);

    const { ok, body } = await Actions.Email.saveSettings(buildInput());
    setSaving(false);

    if (!ok) {
      setSaveResult({
        ok: false,
        error: body.error ?? "Failed to save configuration",
      });
      return;
    }

    setPassword("");
    setSaveResult({ ok: true, message: "Configuration saved." });
    router.refresh();
  }

  const anyPending = testConnection.pending || testSend.pending || saving;

  return {
    isEdit,
    fields: { host, port, security, username, password, fromEmail, fromName },
    setHost,
    setPort,
    setSecurity,
    setUsername,
    setPassword,
    setFromEmail,
    setFromName,
    warning,
    testConnection,
    testSend,
    saving,
    saveResult,
    anyPending,
    handleTestConnection,
    handleSendTest,
    handleSave,
  };
}
