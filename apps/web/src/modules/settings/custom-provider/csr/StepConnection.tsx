"use client";

import { getIn } from "@/lib/custom-provider/wizard";
import { SelectField, TextField } from "./fields";
import type { StepProps } from "./wizard-types";

const SECRET_FIELDS: Record<string, { field: string; label: string }[]> = {
  api_key_header: [{ field: "apiKey", label: "API key" }],
  bearer: [{ field: "token", label: "Bearer token" }],
  basic: [
    { field: "username", label: "Username" },
    { field: "password", label: "Password" },
  ],
  custom_header: [{ field: "headerValue", label: "Header value" }],
};

/** Step 1: where the API is and how Elapsed authenticates. Secrets are write-only: once saved they are never shown again. */
export function StepConnection({ config, set, secretsSet, secrets, setSecret }: StepProps) {
  const type = String(getIn(config, ["auth", "type"]) ?? "api_key_header");
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <TextField id="cp-name" label="Name" value={String(config.displayName ?? "")} onChange={(v) => set(["displayName"], v)} placeholder="Acme Helpdesk" />
      <TextField
        id="cp-base"
        label="API address"
        mono
        value={String(getIn(config, ["connection", "baseUrl"]) ?? "")}
        onChange={(v) => set(["connection", "baseUrl"], v)}
        placeholder="https://api.helpdesk.example.com"
        hint="HTTPS only, on port 443, a public host name. Elapsed never sends requests anywhere else."
      />
      <SelectField
        id="cp-auth"
        label="Authentication"
        value={type}
        onChange={(v) => set(["auth"], v === "bearer" || v === "basic" ? { type: v } : { type: v, headerName: v === "api_key_header" ? "X-Api-Key" : "Authorization" })}
        options={[
          { value: "api_key_header", label: "API key in a header" },
          { value: "bearer", label: "Bearer token" },
          { value: "basic", label: "Basic (username and password)" },
          { value: "custom_header", label: "Custom header" },
        ]}
        hint="Keys in the query string are not allowed. OAuth is not supported."
      />
      {(type === "api_key_header" || type === "custom_header") && (
        <TextField id="cp-header" label="Header name" mono value={String(getIn(config, ["auth", "headerName"]) ?? "")} onChange={(v) => set(["auth", "headerName"], v)} />
      )}
      {type === "custom_header" && (
        <TextField id="cp-prefix" label="Value prefix (optional)" mono value={String(getIn(config, ["auth", "prefix"]) ?? "")} onChange={(v) => set(["auth", "prefix"], v)} placeholder="Token " />
      )}
      {SECRET_FIELDS[type]?.map(({ field, label }) => (
        <TextField
          key={field}
          id={`cp-secret-${field}`}
          type="password"
          label={label}
          value={secrets[field] ?? ""}
          onChange={(v) => setSecret(field, v)}
          placeholder={secretsSet.includes(field) ? "Saved. Leave blank to keep it." : "Required"}
          hint={secretsSet.includes(field) ? "Stored encrypted and never shown again." : "Encrypted at rest and never shown again."}
        />
      ))}
    </div>
  );
}
