"use client";

import { SettingsSectionHeader } from "@/components/settings/section-header";
import { Building2, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Actions } from "@/actions/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Reveal } from "@/components/shared/reveal";
import { TimezoneCombobox } from "@/components/shared/timezone-combobox";
import { notify } from "@/lib/notify";
import type { OrganizationSettingsData } from "@/lib/types/organization";

interface OrganizationViewProps {
  data: OrganizationSettingsData;
}

/**
 * Organization settings (roadmap 5.8): name and a display timezone, used
 * only to group days on the dashboard (roadmap 6.5) — never read by SLA
 * calculations, which stay pinned to each calendar's own timezone. Editing
 * is owner-only (`data.canEdit`); every other signed-in member gets a
 * read-only view, matching Monitoring's convention.
 */
export function OrganizationView({ data }: OrganizationViewProps) {
  const router = useRouter();
  const [name, setName] = useState(data.name);
  const [timezone, setTimezone] = useState(data.timezone);
  const [saving, setSaving] = useState(false);

  const trimmedName = name.trim();
  const dirty = trimmedName !== data.name || timezone !== data.timezone;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!trimmedName) return;

    setSaving(true);

    const { ok, body } = await Actions.Organization.update({ name: trimmedName, timezone });

    setSaving(false);

    if (!ok) {
      notify.error(body.error ?? "Failed to update organization.");
      return;
    }

    setName(body.name);
    setTimezone(body.timezone);
    notify.success("Organization updated.");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <SettingsSectionHeader
        eyebrow="Workspace"
        title="Organization"
        description="Manage this organization's name and display timezone."
      />

      <Reveal delay={0}>
        <Card className="bg-surface-container-low rounded-xl border-0 shadow-sm overflow-hidden">
          <CardHeader className="p-6 pb-0">
            <div className="flex items-center gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded bg-surface-container-highest text-primary">
                <Building2 className="size-4" />
              </span>
              <div>
                <CardTitle className="text-on-surface text-xl font-semibold tracking-tight">
                  Organization details
                </CardTitle>
                <p className="mt-1 text-xs text-on-surface-variant">
                  {data.canEdit
                    ? "The timezone only groups days on the dashboard — it's never used in SLA calculations."
                    : "View only — ask an organization owner to change these."}
                </p>
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-6 pt-4">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="organization-name">Name</Label>
                <Input
                  id="organization-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Organization name"
                  required
                  maxLength={200}
                  disabled={!data.canEdit || saving}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="organization-timezone">Display timezone</Label>
                <TimezoneCombobox
                  id="organization-timezone"
                  value={timezone}
                  onChange={setTimezone}
                  disabled={!data.canEdit || saving}
                />
              </div>

              {data.canEdit && (
                <div className="flex justify-end">
                  <Button type="submit" size="sm" disabled={!dirty || saving || !trimmedName}>
                    {saving && <Loader2 className="animate-spin" />}
                    {saving ? "Saving…" : "Save changes"}
                  </Button>
                </div>
              )}
            </form>
          </CardContent>
        </Card>
      </Reveal>
    </div>
  );
}
