import { SettingsOverview } from "@modules/settings/overview";
import { noIndexMetadata } from "@/lib/seo/metadata";

export const metadata = noIndexMetadata("Settings");

export default function SettingsPage() {
  return <SettingsOverview />;
}
