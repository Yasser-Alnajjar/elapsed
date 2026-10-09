import { Suspense } from "react";
import { CustomProvider } from "@modules/settings/custom-provider";
import { noIndexMetadata } from "@/lib/seo/metadata";

export const metadata = noIndexMetadata("Custom REST");

export default function CustomProviderPage() {
  return (
    <Suspense>
      <CustomProvider />
    </Suspense>
  );
}
