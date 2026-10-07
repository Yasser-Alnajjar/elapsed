import { VerifyEmail } from "@modules/auth/verify-email";
import { noIndexMetadata } from "@/lib/seo/metadata";

export const dynamic = "force-dynamic";

export const metadata = noIndexMetadata("Verify your email");

export default function VerifyEmailPage() {
  return <VerifyEmail />;
}
