"use client";

import { SettingsSectionHeader } from "@/components/settings/section-header";
import type { DataPageData } from "@/lib/types/data";
import { DataActivitySection } from "./DataActivitySection";
import { DataCapabilities } from "./DataCapabilities";
import { IntegrationDataSection } from "./IntegrationDataSection";

/**
 * Settings → Data: the organization's data-management area. Each capability
 * is its own section below the overview, so adding one means adding a section
 * here, not reshaping the page.
 */
export function DataView({ data }: { data: DataPageData }) {
  return (
    <div className="space-y-8">
      <SettingsSectionHeader
        eyebrow="Workspace data"
        title="Data"
        description="Back up and clean up the data stored for your organization."
      />

      <DataCapabilities />

      <IntegrationDataSection integrations={data.integrations} canManage={data.canManage} />

      <DataActivitySection operations={data.operations} />
    </div>
  );
}
