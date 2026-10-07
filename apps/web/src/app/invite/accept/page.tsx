import { AcceptInvite } from "@modules/auth/accept-invite";
import { noIndexMetadata } from "@/lib/seo/metadata";

export const dynamic = "force-dynamic";

export const metadata = noIndexMetadata("Accept your invitation");

export default function AcceptInvitePage() {
  return <AcceptInvite />;
}
