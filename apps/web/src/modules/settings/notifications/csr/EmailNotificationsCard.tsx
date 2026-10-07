"use client";

import {
  AlertCircle,
  History,
  Loader2,
  Mail,
  ShieldCheck,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  EMAIL_SECURITY_OPTIONS,
  type EmailSecurity,
  type EmailSettingsStatus,
} from "@/lib/types/email-settings";
import { useSmtpSettingsForm } from "./useSmtpSettingsForm";

interface EmailNotificationsCardProps {
  status: EmailSettingsStatus;
}

const labelClass =
  "text-outline font-mono text-xxs font-semibold uppercase tracking-wider";

export function EmailNotificationsCard({
  status,
}: EmailNotificationsCardProps) {
  const {
    isEdit,
    fields,
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
    anyPending,
    handleTestConnection,
    handleSendTest,
    handleSave,
  } = useSmtpSettingsForm(status);

  return (
    <Card className="bg-surface-container-low relative gap-0 overflow-hidden rounded-xl border-0 p-6 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between gap-3 p-0">
        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface-container-highest text-primary">
            <Mail className="size-5" />
          </span>
          <div>
            <CardTitle className="text-on-surface text-lg font-medium tracking-tight">
              Email Notifications
            </CardTitle>
            <p className="text-xs text-on-surface-variant">
              SMTP server used to email at-risk and breach alerts to everyone in
              this organization.
            </p>
          </div>
        </div>
        <Badge variant={status.configured ? "success" : "outline"}>
          {status.configured ? "Configured" : "Not configured"}
        </Badge>
      </CardHeader>

      <CardContent className="p-0 pt-5">
        {status.configured && (
          <div className="bg-surface-container text-tertiary mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2.5 font-mono text-xs">
            <span className="flex items-center gap-2">
              <ShieldCheck className="size-4" />
              SMTP relay configured ({status.host}:{status.port})
            </span>
            {status.updatedAt && (
              <span className="text-outline flex items-center gap-1 tabular-nums">
                <History className="size-3" />
                Updated {new Date(status.updatedAt)
                  .toISOString()
                  .slice(11, 19)}{" "}
                UTC
              </span>
            )}
          </div>
        )}
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-1.5 sm:col-span-2">
              <Label className={labelClass} htmlFor="smtp-host">
                SMTP Host
              </Label>
              <Input
                id="smtp-host"
                value={fields.host}
                onChange={(event) => setHost(event.target.value)}
                placeholder="smtp.example.com"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label className={labelClass} htmlFor="smtp-port">
                SMTP Port
              </Label>
              <Input
                id="smtp-port"
                type="number"
                min={1}
                max={65535}
                value={fields.port}
                onChange={(event) => setPort(event.target.value)}
                placeholder="587"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className={labelClass} htmlFor="smtp-security">
                Security
              </Label>
              <Select
                value={fields.security}
                onValueChange={(value) => setSecurity(value as EmailSecurity)}
              >
                <SelectTrigger id="smtp-security" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EMAIL_SECURITY_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className={labelClass} htmlFor="smtp-username">
                Username
              </Label>
              <Input
                id="smtp-username"
                value={fields.username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="smtp username"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className={labelClass} htmlFor="smtp-password">
                Password
              </Label>
              <Input
                id="smtp-password"
                type="password"
                autoComplete="off"
                value={fields.password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={
                  isEdit
                    ? "Leave blank to keep the current password"
                    : "SMTP password"
                }
                required={!isEdit}
              />
            </div>
            <div className="space-y-1.5">
              <Label className={labelClass} htmlFor="smtp-from-email">
                From Email
              </Label>
              <Input
                id="smtp-from-email"
                type="email"
                value={fields.fromEmail}
                onChange={(event) => setFromEmail(event.target.value)}
                placeholder="alerts@example.com"
                required
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className={labelClass} htmlFor="smtp-from-name">
              From Name
            </Label>
            <Input
              id="smtp-from-name"
              value={fields.fromName}
              onChange={(event) => setFromName(event.target.value)}
              placeholder="Elapsed"
            />
          </div>

          {warning && (
            <Alert variant="warning">
              <AlertCircle />
              <AlertDescription>{warning}</AlertDescription>
            </Alert>
          )}

          <div className="bg-surface-container -mx-6 -mb-6 mt-2 flex flex-wrap items-center justify-end gap-2 px-6 py-4">
            <Button
              type="button"
              size="sm"
              variant="surface"
              onClick={handleTestConnection}
              disabled={anyPending}
            >
              {testConnection.pending && <Loader2 className="animate-spin" />}
              {testConnection.pending ? "Testing…" : "Test Connection"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="surface"
              onClick={handleSendTest}
              disabled={anyPending}
            >
              {testSend.pending && <Loader2 className="animate-spin" />}
              {testSend.pending ? "Sending…" : "Send Test Email"}
            </Button>
            <Button type="submit" size="sm" disabled={anyPending}>
              {saving && <Loader2 className="animate-spin" />}
              {saving
                ? "Saving…"
                : isEdit
                  ? "Save changes"
                  : "Save Configuration"}
            </Button>
          </div>

        </form>
      </CardContent>
    </Card>
  );
}
