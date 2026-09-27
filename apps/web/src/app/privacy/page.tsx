import type { Metadata } from "next";

import { Privacy } from "@modules/marketing/legal";

export const metadata: Metadata = {
  title: "Privacy Policy",
};

export default function PrivacyPage() {
  return <Privacy />;
}
