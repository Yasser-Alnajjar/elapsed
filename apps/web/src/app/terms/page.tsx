import type { Metadata } from "next";

import { Terms } from "@modules/marketing/legal";

export const metadata: Metadata = {
  title: "Terms of Service",
};

export default function TermsPage() {
  return <Terms />;
}
