import { Notifications } from "@modules/settings/notifications";
import { noIndexMetadata } from "@/lib/seo/metadata";

export const metadata = noIndexMetadata("Notifications");

export default function NotificationsPage() {
  return <Notifications />;
}
