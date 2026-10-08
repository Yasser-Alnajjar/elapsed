/** Mirrors `GET/PATCH /api/settings/organization`'s response shape (roadmap 5.8). */
export interface OrganizationSettingsData {
  name: string;
  /** IANA time zone id — the organization's display timezone: dates are shown in it, pickers default to it, dashboard days and monthly report periods follow it. Never used for SLA arithmetic (a business calendar's own timezone does that). See `@/lib/organization-settings`. */
  timezone: string;
  /** Whether the signed-in user can change these settings (organization owner) — view-only for everyone else. */
  canEdit: boolean;
}
