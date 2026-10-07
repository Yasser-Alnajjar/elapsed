import Link from "next/link";
import { ArrowRight, ExternalLink, Info } from "lucide-react";

import { DocsLayout } from "@/components/docs/docs-layout";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DataTableCard } from "@/components/shared/data-table/data-table-card";
import { getPageMetadata } from "@/lib/seo/metadata";

const toc = [
  { id: "oauth-apps", title: "Bringing your own OAuth app", level: 2 as const },
  { id: "settings-reference", title: "Settings reference", level: 2 as const },
  {
    id: "engineering-target",
    title: "Engineering leg target",
    level: 2 as const,
  },
  {
    id: "calendar-override",
    title: "Customer calendar override",
    level: 2 as const,
  },
  {
    id: "policy-override",
    title: "SLA policy target override",
    level: 2 as const,
  },
  {
    id: "not-available",
    title: "Settings that don't exist yet",
    level: 2 as const,
  },
];

const settings = [
  {
    setting: "OAuth app credentials",
    location: "Settings → Integrations → provider → Configure",
    meaning:
      "Your organization's own OAuth Client ID/Secret for that provider — required before it can be connected.",
    default: "Not configured",
  },
  {
    setting: "Engineering leg target",
    location: "Settings → SLA",
    meaning:
      "An optional, org-wide target (in hours) for how long a case should stay in the engineering leg before it's flagged for that leg specifically.",
    default: "Not set",
  },
  {
    setting: "Customer calendar override",
    location: "Settings → SLA",
    meaning:
      "Pin a specific customer to one of your imported business calendars, instead of whatever their matched policy would resolve to.",
    default: "Uses the calendar from the matched SLA policy",
  },
  {
    setting: "SLA policy target override",
    location: "Settings → SLA",
    meaning:
      "Override the imported minutes for a first-response or resolution target on a specific policy.",
    default: "Uses the value imported from Zendesk",
  },
  {
    setting: "Slack alert channel",
    location: "Settings → Integrations → Slack",
    meaning: "Which Slack channel receives at-risk/breach alerts.",
    default: "None — no alerts sent until a channel is chosen",
  },
];

export const generateMetadata = () => getPageMetadata("/docs/configuration");

export default function ConfigurationPage() {
  return (
    <DocsLayout toc={toc}>
      <div className="space-y-12">
        <header className="space-y-4">
          <Badge variant="outline">Administration</Badge>

          <div className="space-y-3">
            <h1 className="text-4xl font-bold tracking-tight">Configuration</h1>

            <p className="max-w-2xl text-lg leading-8 text-muted-foreground">
              Every setting that exists in the product today, in one place.
              Nothing is required to get useful findings — configuration is
              entirely optional refinement.
            </p>
          </div>
        </header>

        <section id="oauth-apps" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Bringing your own OAuth app
          </h2>

          <p className="leading-7 text-muted-foreground">
            Before any of the five data-source integrations (Zendesk, Jira,
            Linear, Intercom, GitHub) can be connected, your organization must
            configure its own OAuth application credentials (Client ID and
            Client Secret) for that provider, from the Integrations page. There
            is no shared, built-in application you connect through by default —
            this is a one-time setup step per provider, done once per
            organization.
          </p>

          <Alert>
            <Info className="size-4" />
            <AlertTitle>Client secrets are write-only</AlertTitle>
            <AlertDescription>
              Client secrets are encrypted at rest and are never displayed again
              after saving — only edited by supplying a new one.
            </AlertDescription>
          </Alert>
        </section>

        <Separator />

        <section id="settings-reference" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Settings reference
          </h2>

          <DataTableCard>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Setting</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>What it means</TableHead>
                  <TableHead>Default</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {settings.map((row) => (
                  <TableRow key={row.setting}>
                    <TableCell className="font-medium">
                      {row.setting}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.location}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.meaning}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.default}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </DataTableCard>
        </section>

        <section id="engineering-target" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Engineering leg target
          </h2>

          <p className="leading-7 text-muted-foreground">
            Set this if you want visibility into engineering turnaround time as
            its own metric. Cases exceeding the target show as at-risk/breached
            in the &quot;Aging in engineering&quot; view; it does not send its
            own Slack/email alert.
          </p>
        </section>

        <section id="calendar-override" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Customer calendar override
          </h2>

          <p className="leading-7 text-muted-foreground">
            Use this if one customer&apos;s contractual hours differ from your
            general policy. It applies to new commitments only — commitments
            already created keep their original calendar.
          </p>
        </section>

        <section id="policy-override" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            SLA policy target override
          </h2>

          <p className="leading-7 text-muted-foreground">
            Use this if the imported value doesn&apos;t match your actual
            contractual target. Overriding creates a new policy version;
            existing commitments keep their original target, and new commitments
            use the override. See{" "}
            <Link href="/docs/sla" className="underline underline-offset-4">
              SLA &amp; Targets
            </Link>{" "}
            for how policy versioning affects reproducibility.
          </p>
        </section>

        <section id="not-available" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Settings that don&apos;t exist yet
          </h2>

          <p className="leading-7 text-muted-foreground">
            Do not look for these — they are not hidden elsewhere in the product
            today:
          </p>

          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>
              • Per-policy pause-state configuration (which statuses pause a
              clock, beyond the fixed &quot;Pending customer&quot; default)
            </li>
            <li>• Custom warning-threshold percentages</li>
            <li>• Per-user notification preferences</li>
            <li>• Role-based permissions</li>
            <li>• A public API key</li>
          </ul>
        </section>

        <section className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Link
              href="/docs/sla"
              className="group flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-muted/50"
            >
              <div>
                <p className="text-sm font-medium">SLA &amp; Targets</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  How these settings affect calculations.
                </p>
              </div>
              <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
            </Link>

            <Link
              href="/docs/faq"
              className="group flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-muted/50"
            >
              <div>
                <p className="text-sm font-medium">FAQ</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Common configuration questions answered.
                </p>
              </div>
              <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
            </Link>
          </div>
        </section>

        <div className="border-t pt-8">
          <a
            href="#oauth-apps"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            Back to top
            <ExternalLink className="size-3.5" />
          </a>
        </div>
      </div>
    </DocsLayout>
  );
}
