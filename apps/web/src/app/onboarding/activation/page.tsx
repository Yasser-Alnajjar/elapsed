import { Activation } from "@modules/onboarding/activation";
import { noIndexMetadata } from "@/lib/seo/metadata";

export const dynamic = "force-dynamic";

export const metadata = noIndexMetadata("Activation");

export default function ActivationPage() {
  return <Activation />;
}
