import { Profile } from "@modules/settings/profile";
import { noIndexMetadata } from "@/lib/seo/metadata";

export const metadata = noIndexMetadata("Profile");

export default function ProfilePage() {
  return <Profile />;
}
