import { ForgotPassword } from "@modules/auth/forgot-password";
import { noIndexMetadata } from "@/lib/seo/metadata";

export const metadata = noIndexMetadata("Reset your password");

export default function ForgotPasswordPage() {
  return <ForgotPassword />;
}
