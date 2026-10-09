"use client";

import { Plug } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Actions } from "@/actions/client";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { CustomProviderPageData, DraftView } from "@/lib/types/custom-provider";
import { ConfigWizard } from "./ConfigWizard";
import { LimitationsNotice } from "./LimitationsNotice";
import { OverridePanel } from "./OverridePanel";
import { RunHistory } from "./RunHistory";
import { SyncStateBanner } from "./SyncStateBanner";
import { VersionList } from "./VersionList";

const section = "bg-surface-container-low flex flex-col gap-3 rounded-xl p-5";

/**
 * Custom REST (Beta, N9): the guided connection for a helpdesk Elapsed has no
 * adapter for. Read-only against your system; credentials encrypted and never
 * shown again. Members can read the state; only the owner can change anything.
 */
export function CustomProviderView({ data }: { data: CustomProviderPageData }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [seed, setSeed] = useState<DraftView | null>(null);
  const { status } = data;

  if (!data.enabled && !status.connected) {
    return (
      <div className="flex flex-col gap-4">
        <Header />
        <Alert>Custom REST is in Beta and is not enabled for your organization. Contact support to request access.</Alert>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Header />
      <SyncStateBanner status={status} />
      {status.connected && <LimitationsNotice slaSupport={status.slaSupport} />}
      <OverridePanel status={status} isOwner={data.isOwner} />

      {status.connected && (
        <>
          <section className={section} aria-labelledby="cp-runs">
            <h2 id="cp-runs" className="text-on-surface font-medium">
              Syncs
            </h2>
            <RunHistory status={status} />
          </section>
          <section className={section} aria-labelledby="cp-versions">
            <h2 id="cp-versions" className="text-on-surface font-medium">
              Configuration versions
            </h2>
            <VersionList status={status} isOwner={data.isOwner} />
          </section>
        </>
      )}

      {data.isOwner && data.enabled && (
        <section className={section} aria-labelledby="cp-config">
          <div className="flex items-center justify-between gap-3">
            <h2 id="cp-config" className="text-on-surface font-medium">
              {status.connected ? "Change the configuration" : "Connect your helpdesk"}
            </h2>
            {status.connected && !editing && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={async () => {
                  const result = await Actions.CustomProvider.editFromActive();
                  if (result.ok && result.body.draft) {
                    setSeed(result.body.draft);
                    setEditing(true);
                  }
                }}
              >
                Edit (creates a new version)
              </Button>
            )}
          </div>
          {(!status.connected || editing) && (
            <ConfigWizard key={seed?.expiresAt ?? "new"} initial={seed ?? data.draft} secretsSet={(seed ?? data.draft)?.secretsSet ?? []} userId={data.userId} />
          )}
          {status.connected && (
            <div className="border-outline-variant/20 border-t pt-3">
              <Button
                type="button"
                size="sm"
                variant="destructive"
                onClick={async () => {
                  if (window.confirm("Disconnect Custom REST? Syncing stops. Your existing data and configuration versions are kept.")) {
                    await Actions.CustomProvider.disconnect();
                    router.refresh();
                  }
                }}
              >
                Disconnect
              </Button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function Header() {
  return (
    <div className="flex items-center gap-3">
      <span className="bg-surface-container-highest text-primary flex size-10 items-center justify-center rounded">
        <Plug className="size-5" />
      </span>
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-on-surface text-xl font-medium">Custom REST</h1>
          <Badge variant="beta">Beta</Badge>
        </div>
        <p className="text-on-surface-variant text-sm">Connect a helpdesk through its read-only JSON API. Elapsed only reads; nothing is ever written back.</p>
      </div>
    </div>
  );
}
