import { SignIn } from "@modules/auth/sign-in";
import { noIndexMetadata } from "@/lib/seo/metadata";

export const metadata = noIndexMetadata("Sign in");

export default function SignInPage() {
  return <SignIn />;
}
