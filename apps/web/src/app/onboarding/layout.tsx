import type { ReactNode } from "react";
import { OrgTimezoneProvider } from "@/components/shared/org-timezone-provider";
import { getOrganizationTimezone } from "@/lib/organization-timezone";
import { noIndexMetadata } from "@/lib/seo/metadata";

// Signed-in onboarding: every page below inherits `noindex`, so a page added later cannot be indexable by accident.
export const metadata = noIndexMetadata("Set up Elapsed");

export default async function OnboardingLayout({ children }: { children: ReactNode }) {
  return <OrgTimezoneProvider timezone={await getOrganizationTimezone()}>{children}</OrgTimezoneProvider>;
}
