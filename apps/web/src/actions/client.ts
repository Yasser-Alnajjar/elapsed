import { signIn as nextAuthSignIn } from "next-auth/react";
import type { EntitlementWarningPayload } from "@/components/shared/entitlement-alerts";
import type { CommitmentKind } from "@sla/core";
import { interpretCredentialsSignInResult, type SignInOutcome } from "@/lib/auth-rate-limit";
import type { OnboardingStatus } from "@/lib/types/onboarding";
import type {
  ConfigurableIntegrationProvider,
  GithubBackfillResult,
  IntegrationConfigStatus,
  IntegrationProvider,
  IntercomBackfillResult,
  JiraBackfillResult,
  LinearBackfillResult,
  SlackChannel,
  ZendeskSyncResult,
} from "@/lib/types/integrations";
import type { EmailSecurity, EmailSettingsStatus } from "@/lib/types/email-settings";
import type { SignUpInput } from "@/lib/sign-up";
import type { IUser } from "@/lib/types/user";
import type { InvitationPreview } from "@/lib/types/invitations";
import type { UserRole } from "@/lib/types/user";
import { CONCIERGE_INTEGRATION_ID_FIELD } from "@/lib/types/concierge-export";
import type { OrganizationSettingsData } from "@/lib/types/organization";
import type { BillingAccountFormInput, SubscriptionActionInput } from "@/lib/billing-validation";
import type {
  ConciergeExportSelectionRequest,
  ConciergeExportSummary,
  ConciergeIntegrationOption,
  ConciergeSourceProvider,
  JiraConciergeExportRequest,
  ZendeskConciergeExportRequest,
} from "@/lib/types/concierge-export";

interface ActionResult<T> {
  ok: boolean;
  status: number;
  body: T & { error?: string; reauthRequired?: boolean };
}

export interface EmailSettingsFormInput {
  host: string;
  port: number;
  security: EmailSecurity;
  username: string;
  /** Blank means "keep/use the already-saved password" — see the settings form and API routes. */
  password?: string;
  fromEmail: string;
  fromName?: string;
}

interface SmtpActionResult {
  ok: boolean;
  message?: string;
  error?: string;
}

export interface UpdateProfileInput {
  name: string;
  image: string | null;
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

async function postJSON<T>(
  url: string,
  payload?: unknown,
  method: "POST" | "PATCH" = "POST",
): Promise<ActionResult<T>> {
  const response = await fetch(url, {
    method,
    headers:
      payload !== undefined
        ? { "Content-Type": "application/json" }
        : undefined,
    body: payload !== undefined ? JSON.stringify(payload) : undefined,
  });
  const body = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, body };
}

/**
 * Browser-only mutation layer. Every function here is a thin wrapper around
 * a `fetch()` call to an existing `app/api/**` route handler — kept in a
 * separate module from `@/actions` (the server data layer) so client
 * components never transitively import `@sla/db` or next-auth's server APIs.
 */
export const Actions = {
  Auth: {
    async signIn(email: string, password: string): Promise<SignInOutcome> {
      const result = await nextAuthSignIn("credentials", { email, password, redirect: false });
      return interpretCredentialsSignInResult(result);
    },
    async signUp(input: SignUpInput) {
      return postJSON<Record<string, never>>("/api/sign-up", input);
    },
  },

  Onboarding: {
    async getProgress(): Promise<OnboardingStatus | null> {
      const response = await fetch("/api/onboarding/progress");
      if (!response.ok) return null;
      return response.json();
    },
    /** Every guided provider has a backfill route at the same path; the wizard starts whichever is connected and still empty. */
    async startBackfill(provider: IntegrationProvider) {
      return postJSON<Record<string, never>>(`/api/integrations/${provider}/backfill`);
    },
  },

  Integrations: {
    async runZendeskBackfill() {
      return postJSON<ZendeskSyncResult>("/api/integrations/zendesk/backfill");
    },
    async runJiraBackfill() {
      return postJSON<{ backfill: JiraBackfillResult }>(
        "/api/integrations/jira/backfill",
      );
    },
    async runLinearBackfill() {
      return postJSON<{ backfill: LinearBackfillResult }>(
        "/api/integrations/linear/backfill",
      );
    },
    async runIntercomBackfill() {
      return postJSON<{ backfill: IntercomBackfillResult }>(
        "/api/integrations/intercom/backfill",
      );
    },
    async runGithubBackfill() {
      return postJSON<{ backfill: GithubBackfillResult }>(
        "/api/integrations/github/backfill",
      );
    },
    async loadSlackChannels() {
      const response = await fetch("/api/integrations/slack/channels");
      const body = await response.json();
      return {
        ok: response.ok,
        channels: body.channels as SlackChannel[] | undefined,
        error: body.error as string | undefined,
      };
    },
    async saveSlackChannel(channelId: string, channelName: string) {
      return postJSON<Record<string, never>>(
        "/api/integrations/slack/channel",
        { channelId, channelName },
      );
    },
    async saveIntegrationConfig(
      provider: ConfigurableIntegrationProvider,
      input: { clientId: string; clientSecret?: string },
    ) {
      return postJSON<IntegrationConfigStatus>(
        `/api/integrations/${provider}/config`,
        input,
      );
    },
    async deleteIntegrationConfig(provider: ConfigurableIntegrationProvider) {
      const response = await fetch(`/api/integrations/${provider}/config`, {
        method: "DELETE",
      });
      if (response.ok) return { ok: true as const };
      const body = await response.json().catch(() => null);
      return {
        ok: false as const,
        error:
          (body?.error as string | undefined) ??
          "Failed to delete configuration",
      };
    },
    async disconnect(provider: IntegrationProvider | "slack") {
      const response = await fetch(`/api/integrations/${provider}/disconnect`, {
        method: "POST",
      });
      if (response.ok) return { ok: true as const };
      const body = await response.json().catch(() => null);
      return {
        ok: false as const,
        error: (body?.error as string | undefined) ?? "Failed to disconnect",
      };
    },
  },

  Email: {
    async saveSettings(input: EmailSettingsFormInput) {
      return postJSON<EmailSettingsStatus>("/api/settings/email", input);
    },
    async testConnection(input: EmailSettingsFormInput) {
      const { body } = await postJSON<SmtpActionResult>("/api/settings/email/test-connection", input);
      return body;
    },
    async sendTestEmail(input: EmailSettingsFormInput) {
      const { body } = await postJSON<SmtpActionResult>("/api/settings/email/test-send", input);
      return body;
    },
  },

  SlaConfiguration: {
    async setEngineeringTarget(targetMinutes: number) {
      return postJSON<Record<string, never>>(
        "/api/settings/engineering-target",
        { targetMinutes },
      );
    },
    async clearEngineeringTarget() {
      const response = await fetch("/api/settings/engineering-target", {
        method: "DELETE",
      });
      return { ok: response.ok };
    },
    async overridePolicyTargets(
      policyId: string,
      targets: { kind: CommitmentKind; minutes: number }[],
    ) {
      return postJSON<{
        created: boolean;
        version: { id: string; version: number };
      }>("/api/settings/sla-policies/override", { policyId, targets });
    },
    async setCustomerCalendar(customerId: string, calendarId: string | null) {
      return postJSON<{ ok: boolean }>("/api/settings/customer-calendars", {
        customerId,
        calendarId,
      });
    },
    async createPolicy(input: {
      name: string;
      match: { priority?: string[]; customerIds?: string[] };
      targets: { kind: CommitmentKind; minutes: number }[];
      /** Omit to use the organization's default calendar (4i) instead of pinning an explicit one. */
      calendarId?: string;
      warnAtPercent: number[];
    }) {
      return postJSON<{
        policyId: string;
        version: { id: string; version: number };
        entitlementWarning?: EntitlementWarningPayload;
      }>("/api/settings/sla-policies", input);
    },
    async updatePolicy(
      policyId: string,
      input: {
        name?: string;
        match?: { priority?: string[]; customerIds?: string[] };
        targets?: { kind: CommitmentKind; minutes: number }[];
        /** Omit: leave the calendar untouched. A string: pin this calendar. `null`: explicitly switch to "use the organization's default calendar" (4i). */
        calendarId?: string | null;
        warnAtPercent?: number[];
      },
    ) {
      return postJSON<{
        created: boolean;
        policyId: string;
        version: { id: string; version: number };
      }>(`/api/settings/sla-policies/${policyId}`, input, "PATCH");
    },
    async setPolicyActive(policyId: string, active: boolean) {
      const response = await fetch(
        `/api/settings/sla-policies/${policyId}/${active ? "activate" : "deactivate"}`,
        { method: "POST" },
      );
      return { ok: response.ok };
    },
    async setDefaultCalendar(calendarId: string | null) {
      return postJSON<{ ok: boolean }>("/api/settings/calendars/default", {
        calendarId,
      });
    },
    async createCalendar(input: {
      name: string;
      timezone: string;
      weekly: { day: number; openMinute: number; closeMinute: number }[];
      holidays: { date: string; name: string; recurring: boolean }[];
    }) {
      return postJSON<{
        calendarId: string;
        version: { id: string; version: number };
      }>("/api/settings/calendars", input);
    },
    async updateCalendar(
      calendarId: string,
      input: {
        name?: string;
        timezone?: string;
        weekly?: { day: number; openMinute: number; closeMinute: number }[];
        holidays?: { date: string; name: string; recurring: boolean }[];
      },
    ) {
      return postJSON<{
        created: boolean;
        calendarId: string;
        version: { id: string; version: number };
      }>(`/api/settings/calendars/${calendarId}`, input, "PATCH");
    },
  },

  Concierge: {
    async listIntegrations(provider: ConciergeSourceProvider, organizationId: string) {
      const response = await fetch(
        `/api/concierge/${provider}/integrations?${new URLSearchParams({ organizationId })}`,
      );
      const body = await response.json().catch(() => ({}));
      return {
        ok: response.ok,
        integrations: body.integrations as ConciergeIntegrationOption[] | undefined,
        error: body.error as string | undefined,
      };
    },
    async exportData(
      provider: ConciergeSourceProvider,
      { organizationId, integrationId }: ConciergeExportSelectionRequest,
    ): Promise<
      | { ok: true; zip: Blob; summary: ConciergeExportSummary }
      | { ok: false; error: string }
    > {
      const payload: JiraConciergeExportRequest | ZendeskConciergeExportRequest = {
        organizationId,
        [CONCIERGE_INTEGRATION_ID_FIELD[provider]]: integrationId,
      } as unknown as JiraConciergeExportRequest | ZendeskConciergeExportRequest;
      const response = await fetch(`/api/concierge/${provider}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        return { ok: false, error: (body?.error as string | undefined) ?? "Export failed" };
      }
      const fileName =
        response.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ??
        `${provider}-concierge-export.zip`;
      return {
        ok: true,
        zip: await response.blob(),
        summary: {
          recordCount: Number(response.headers.get("X-Export-Record-Count") ?? 0),
          historyCount: Number(response.headers.get("X-Export-History-Count") ?? 0),
          fileName,
        },
      };
    },
  },

  Profile: {
    async update(input: UpdateProfileInput) {
      return postJSON<IUser>("/api/me", input);
    },
    async changePassword(input: ChangePasswordInput) {
      return postJSON<Record<string, never>>("/api/me/password", input);
    },
    async requestEmailChange(input: { newEmail: string; currentPassword: string }) {
      return postJSON<{ ok: boolean }>("/api/me/email", input);
    },
    async resendVerification() {
      return postJSON<{ ok: boolean }>("/api/me/resend-verification");
    },
  },

  Invitations: {
    async invite(email: string) {
      return postJSON<{ ok: boolean; resent: boolean; entitlementWarning?: EntitlementWarningPayload }>("/api/settings/invitations", { email });
    },
    async revoke(invitationId: string) {
      const response = await fetch(`/api/settings/invitations/${invitationId}`, { method: "DELETE" });
      return { ok: response.ok };
    },
    /** Public — no session required (the token is the credential). */
    async previewInvite(token: string) {
      const response = await fetch(`/api/invitations/accept?token=${encodeURIComponent(token)}`);
      const body = await response.json().catch(() => ({}));
      return { ok: response.ok, status: response.status, body } as ActionResult<InvitationPreview>;
    },
    /** Public — no session required. */
    async acceptInvite(input: { token: string; name: string; password: string }) {
      return postJSON<{ ok: boolean; email: string }>("/api/invitations/accept", input);
    },
  },

  PasswordReset: {
    /** Public — no session required. Always resolves `ok: true`; see `/api/password-reset`'s doc comment for why. */
    async request(email: string) {
      return postJSON<{ ok: boolean }>("/api/password-reset", { email });
    },
    /** Public — no session required (the token is the credential). */
    async confirm(input: { token: string; password: string }) {
      return postJSON<{ ok: boolean }>("/api/password-reset/confirm", input);
    },
  },

  EmailVerification: {
    /** Public — no session required (the token is the credential). */
    async confirm(token: string) {
      return postJSON<{ ok: boolean; email: string }>("/api/email-verification/confirm", { token });
    },
  },

  Members: {
    async updateRole(memberId: string, role: UserRole) {
      return postJSON<Record<string, never>>(`/api/settings/members/${memberId}`, { role }, "PATCH");
    },
    async remove(memberId: string) {
      const response = await fetch(`/api/settings/members/${memberId}`, { method: "DELETE" });
      const body = await response.json().catch(() => ({}));
      return { ok: response.ok, error: body.error as string | undefined };
    },
  },

  Organization: {
    async update(input: { name: string; timezone: string }) {
      return postJSON<OrganizationSettingsData>("/api/settings/organization", input, "PATCH");
    },
  },
  Billing: {
    /** Start, change plan or seats, cancel or resume. Errors carry `{ error, code }`. */
    async subscription(input: SubscriptionActionInput) {
      return postJSON<{ subscription?: unknown; code?: string }>("/api/billing/subscription", input);
    },
    async updateAccount(input: BillingAccountFormInput) {
      return postJSON<{ code?: string }>("/api/billing/account", input, "PATCH");
    },
    /** A hosted provider page; `501 provider_unavailable` while none is connected. */
    async providerSession(kind: "portal" | "payment_method") {
      return postJSON<{ url?: string; code?: string }>("/api/billing/provider-session", { kind });
    },
  },
};
