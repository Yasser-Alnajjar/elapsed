import type { ReactNode } from "react";
import { noIndexMetadata } from "@/lib/seo/metadata";

// Customer-facing connect links carry a secret token in the URL. Pages below keep their own titles.
export const metadata = noIndexMetadata();

export default function ConnectLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
