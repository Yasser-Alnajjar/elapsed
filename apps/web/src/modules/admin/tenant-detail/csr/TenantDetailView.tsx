"use client";

import { FileSliders, PlugZap } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useAdminOperator } from "@/components/admin/admin-operator-context";
import { AdminPanel, AuditNotice, MonoLabel, SectionTitle } from "@/components/admin/admin-ui";
import { formatUtcTimestamp } from "@/lib/admin-format";
import type { AdminTenantDetail } from "@/lib/types/admin";
import { AlertDeliverySection } from "./AlertDeliverySection";
import { CoverageSection } from "./CoverageSection";
import { IntegrationCard } from "./IntegrationCard";
import { PlanRecordForm } from "./PlanRecordForm";
import { SafetyProtocolPanel } from "./SafetyProtocolPanel";
import { TenantHeader } from "./TenantHeader";
import { WorkerRunPanel } from "./WorkerRunPanel";

interface TenantDetailViewProps {
  data: AdminTenantDetail;
}

/**
 * One tenant in depth (N4.4): its plan record (editable, audited), per
 * integration health with the operator controls, alert delivery, policy
 * coverage, link coverage and this organization's own worker run. Opening this
 * page wrote a `view_tenant` audit row. Nothing here shows credentials, and
 * alert failures list ticket ids, never ticket content.
 */
export function TenantDetailView({ data }: TenantDetailViewProps) {
  const router = useRouter();
  const actorEmail = useAdminOperator();
  const [refreshing, startRefresh] = useTransition();
  const { tenant } = data;

  return (
    <div className="flex flex-col gap-5">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5">
        <MonoLabel>
          <Link href="/admin" className="hover:text-foreground">
            Platform admin
          </Link>
        </MonoLabel>
        <MonoLabel>/</MonoLabel>
        <MonoLabel>
          <Link href="/admin/tenants" className="hover:text-foreground">
            Tenants
          </Link>
        </MonoLabel>
        <MonoLabel>/</MonoLabel>
        <MonoLabel className="text-primary">{tenant.name}</MonoLabel>
      </nav>

      <AuditNotice label="Strict audit protocol">
        Viewing this tenant was recorded in the platform audit log as <code className="text-primary font-mono font-bold">view_tenant</code> by{" "}
        <span className="text-foreground font-mono">{actorEmail}</span> at <span className="font-mono">{formatUtcTimestamp(data.asOf)}</span>.
      </AuditNotice>

      <TenantHeader tenant={tenant} asOf={data.asOf} refreshing={refreshing} onRefresh={() => startRefresh(() => router.refresh())} />

      <div className="grid items-start gap-5 xl:grid-cols-12">
        <div className="flex min-w-0 flex-col gap-6 xl:col-span-8">
          <section aria-labelledby="integrations" className="flex flex-col gap-3">
            <SectionTitle
              icon={PlugZap}
              title={<span id="integrations">Connected integrations</span>}
              description="Per-integration health, and the controls an operator may use. Each one is audited."
            />
            {data.integrations.length === 0 ? (
              <AdminPanel className="text-muted-foreground px-4 py-6 text-sm">This organization has not connected any integration.</AdminPanel>
            ) : (
              <ul className="flex flex-col gap-3">
                {data.integrations.map((integration) => (
                  <IntegrationCard key={integration.id} integration={integration} tenantName={tenant.name} />
                ))}
              </ul>
            )}
          </section>

          <AlertDeliverySection
            sent24h={tenant.notificationsSent24h}
            failing24h={tenant.notificationsFailed24h}
            failingAlertCount={data.failingAlertCount}
            failures={data.recentAlertFailures}
          />

          <CoverageSection tenant={tenant} casesWithNoMatchingPolicy={data.casesWithNoMatchingPolicy} slaImport={data.slaImport} />
        </div>

        <aside className="flex min-w-0 flex-col gap-5 xl:col-span-4">
          <AdminPanel className="overflow-hidden">
            <div className="bg-surface-raised border-border flex items-center justify-between gap-2 border-b px-4 py-3">
              <span className="flex items-center gap-2.5">
                <FileSliders className="text-primary size-4" aria-hidden />
                <h2 className="text-foreground text-sm font-semibold tracking-wide uppercase">Plan record</h2>
              </span>
              <span className="border-border text-foreground-subtle rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-[0.06em] uppercase">
                Recorded by hand
              </span>
            </div>
            <PlanRecordForm
              organizationId={tenant.organizationId}
              record={{
                plan: tenant.plan,
                planStatus: tenant.planStatus,
                trialEndsAt: tenant.trialEndsAt,
                billingReference: tenant.billingReference,
              }}
            />
          </AdminPanel>

          <WorkerRunPanel work={data.work} />
          <SafetyProtocolPanel />
        </aside>
      </div>
    </div>
  );
}
