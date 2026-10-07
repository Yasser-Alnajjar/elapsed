import type { ReactNode } from "react";
import { noIndexMetadata } from "@/lib/seo/metadata";

// Signed-in onboarding: every page below inherits `noindex`, so a page added later cannot be indexable by accident.
export const metadata = noIndexMetadata("Set up Elapsed");

export default function OnboardingLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
