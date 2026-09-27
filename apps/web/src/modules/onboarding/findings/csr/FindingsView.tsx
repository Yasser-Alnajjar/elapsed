"use client";

import { Sparkles } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { OnboardingShell } from "@/components/shared/onboarding-shell";
import { Reveal } from "@/components/shared/reveal";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatMinutes } from "@/lib/format";
import type { FindingsData } from "@/lib/types/findings";

interface FindingsViewProps {
  data: FindingsData;
}

function FindingsSummary({ data }: FindingsViewProps) {
  return (
    <p className="text-base leading-relaxed text-foreground">
      Over the last {data.periodDays} days,{" "}
      <strong className="text-primary">{data.totalEscalated}</strong> ticket
      {data.totalEscalated === 1 ? " was" : "s were"} escalated to Jira.{" "}
      <strong className="text-warning">{data.exceededTarget}</strong> of{" "}
      {data.exceededTarget === 1 ? "it" : "them"} exceeded{" "}
      {data.exceededTarget === 1 ? "its" : "their"} customer resolution target.
      {data.avgEngineeringMinutes !== null && (
        <>
          {" "}
          Escalated tickets spent an average of{" "}
          <strong>{formatMinutes(data.avgEngineeringMinutes)}</strong> waiting
          to be picked up in Jira.
        </>
      )}
    </p>
  );
}

function TopAccounts({ data }: FindingsViewProps) {
  if (data.topAccounts.length === 0) {
    return null;
  }

  return (
    <div>
      <h2 className="mb-3 text-sm font-medium text-foreground">
        Top affected accounts
      </h2>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Account</TableHead>
            <TableHead>Escalations</TableHead>
            <TableHead>Exceeded target</TableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {data.topAccounts.map((account) => (
            <TableRow key={account.customerName}>
              <TableCell className="font-medium">
                {account.customerName}
              </TableCell>
              <TableCell>{account.escalatedCases}</TableCell>
              <TableCell>{account.breachedCases}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function FindingsView({ data }: FindingsViewProps) {
  const hasFindings = data.totalEscalated > 0;

  return (
    <OnboardingShell title="Your findings" currentStep={null}>
      <Reveal>
        <div className="flex flex-col gap-2 rounded-xl bg-surface-container p-6 shadow-elevated">
          <div className="flex items-center gap-3">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-tertiary/15 text-tertiary">
              <span className="material-symbols-outlined text-[24px]">
                check_circle
              </span>
            </div>
            <div className="flex flex-col">
              <span className="font-headline-md text-headline-md text-on-surface">
                Zero-config setup complete — Elapsed is online
              </span>
              <span className="font-body-sm text-body-sm text-on-surface-variant">
                Your tools are connected. Findings now show up automatically.
              </span>
            </div>
          </div>
        </div>
      </Reveal>

      {hasFindings ? (
        <Reveal delay={0.05}>
          <Card>
            <CardContent className="space-y-5 pt-5">
              <FindingsSummary data={data} />
              <TopAccounts data={data} />
            </CardContent>
          </Card>
        </Reveal>
      ) : (
        <Reveal delay={0.05}>
          <EmptyState
            icon={Sparkles}
            title="No escalations yet"
            description={`No tickets have been escalated to Jira in the last ${data.periodDays} days. Once Jira is connected and issues get linked, findings will appear here automatically — nothing to configure.`}
          />
        </Reveal>
      )}

      <div className="flex flex-col gap-3 sm:flex-row">
        <Button variant="outline" asChild>
          <Link href="/settings/integrations">
            Confirm SLA policies &amp; connect Slack
          </Link>
        </Button>

        <Button asChild>
          <Link href="/dashboard">
            Launch live operations dashboard
            <span className="material-symbols-outlined text-[18px]">
              arrow_forward
            </span>
          </Link>
        </Button>
      </div>
    </OnboardingShell>
  );
}
