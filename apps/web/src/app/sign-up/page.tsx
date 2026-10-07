import { SignUp } from "@modules/auth/sign-up";
import { noIndexMetadata } from "@/lib/seo/metadata";

export const metadata = noIndexMetadata("Create your account");

export default function SignUpPage() {
  return <SignUp />;
}
