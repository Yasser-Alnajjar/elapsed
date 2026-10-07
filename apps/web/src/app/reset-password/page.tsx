import { ResetPassword } from "@modules/auth/reset-password";
import { noIndexMetadata } from "@/lib/seo/metadata";

export const dynamic = "force-dynamic";

export const metadata = noIndexMetadata("Set a new password");

export default function ResetPasswordPage() {
  return <ResetPassword />;
}
