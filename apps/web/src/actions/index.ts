import "server-only";
import { DashboardActions } from "./dashboard";
import { DataActions } from "./data";
import { CasesActions } from "./cases";
import { OnboardingActions } from "./onboarding";
import { IntegrationsActions } from "./integrations";
import { SlaConfigurationActions } from "./sla-configuration";
import { NotificationsActions } from "./notifications";
import { WorkerSettingsActions } from "./worker-settings";
import { ConciergeActions } from "./concierge";
import { ProfileActions } from "./profile";
import { AtRiskActions } from "./at-risk";
import { InvitationsActions } from "./invitations";
import { MembersActions } from "./members";
import { OrganizationActions } from "./organization";
import { BillingActions } from "./billing";

/**
 * Server-only data layer, imported exclusively by `ssr/` (async server)
 * components. Mutations called from `csr/` (client) components go through
 * `@/actions/client` instead — that module stays free of `@sla/db`/next-auth
 * imports so it never gets pulled into the browser bundle.
 *
 * Platform-admin reads (`./admin`) are deliberately not in this barrel: tenant
 * pages import it, and admin code must be unreachable from tenant code (N4.6).
 */
export const Actions = {
  AtRisk: AtRiskActions,
  Dashboard: DashboardActions,
  Data: DataActions,
  Cases: CasesActions,
  Onboarding: OnboardingActions,
  Integrations: IntegrationsActions,
  SlaConfiguration: SlaConfigurationActions,
  Notifications: NotificationsActions,
  WorkerSettings: WorkerSettingsActions,
  Concierge: ConciergeActions,
  Profile: ProfileActions,
  Invitations: InvitationsActions,
  Members: MembersActions,
  Organization: OrganizationActions,
  Billing: BillingActions,
};
