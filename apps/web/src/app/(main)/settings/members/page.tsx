import { Members } from "@modules/settings/members";
import { noIndexMetadata } from "@/lib/seo/metadata";

export const metadata = noIndexMetadata("Members");

export default function MembersPage() {
  return <Members />;
}
