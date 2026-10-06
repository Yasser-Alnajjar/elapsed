import type { Metadata } from "next";

import { DocsLayout } from "@/components/docs/docs-layout";
import { Badge } from "@/components/ui/badge";
import { DataTableCard } from "@/components/shared/data-table/data-table-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getProviderAccessFacts, SLACK_ACCESS_FACT } from "@/lib/security-summary";

export const metadata: Metadata = {
  title: "Security summary",
  description: "What Elapsed can access, what it stores, and how it is protected. Written to be forwarded to a security reviewer.",
};

const toc = [
  { id: "access", title: "Access to your systems", level: 2 as const },
  { id: "no-write-back", title: "No write-back", level: 2 as const },
  { id: "stored", title: "What is stored", level: 2 as const },
  { id: "encryption", title: "Encryption at rest", level: 2 as const },
  { id: "isolation", title: "Tenant isolation", level: 2 as const },
  { id: "retention", title: "Retention and deletion", level: 2 as const },
];

export default function SecuritySummaryPage() {
  const facts = getProviderAccessFacts();

  return (
    <DocsLayout toc={toc}>
      <div className="space-y-12">
        <header className="space-y-4">
          <Badge variant="outline">Security</Badge>
          <h1 className="text-4xl font-bold tracking-tight">Security summary</h1>
          <p className="max-w-2xl text-lg leading-8 text-muted-foreground">
            A short, factual page you can forward to whoever approves access to your ticketing or issue tracker. The
            permission lists below are generated from the same values the connect flow requests.
          </p>
        </header>

        <section id="access" className="space-y-4">
          <h2 className="text-2xl font-semibold">Access to your systems</h2>
          <p className="text-muted-foreground">Every data source is connected through that provider&apos;s own OAuth flow, with read-only access.</p>
          <DataTableCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>System</TableHead>
                <TableHead>Requested scopes</TableHead>
                <TableHead>How read-only is enforced</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {facts.map((fact) => (
                <TableRow key={fact.provider}>
                  <TableCell className="font-medium">{fact.label}</TableCell>
                  <TableCell>
                    {fact.scopes.length > 0 ? (
                      fact.scopes.map((scope) => (
                        <code key={scope} className="mr-1 rounded bg-muted px-1.5 py-0.5 text-xs">
                          {scope}
                        </code>
                      ))
                    ) : (
                      <span className="text-muted-foreground">None requested per connection</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {fact.note ?? "The requested scopes are read-only. offline_access, where listed, only lets the connection refresh its own token."}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </DataTableCard>
          <p className="text-sm text-muted-foreground">
            Slack is outbound only, used to post alerts and reports. Bot scopes:{" "}
            {SLACK_ACCESS_FACT.scopes.map((scope) => (
              <code key={scope} className="mr-1 rounded bg-muted px-1.5 py-0.5 text-xs">
                {scope}
              </code>
            ))}
          </p>
        </section>

        <section id="no-write-back" className="space-y-3">
          <h2 className="text-2xl font-semibold">No write-back</h2>
          <p className="text-muted-foreground">
            Elapsed never creates, edits or comments on anything in your ticketing system, issue tracker or code host. Its
            only outbound actions are a Slack message and an email, both notifications about your own data.
          </p>
        </section>

        <section id="stored" className="space-y-3">
          <h2 className="text-2xl font-semibold">What is stored</h2>
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            <li>The tickets, conversations, issues and pull requests the connected systems return, kept as received so they can be replayed.</li>
            <li>The timelines, SLA policies, commitments and breach results derived from them.</li>
            <li>Customer names and identifiers as they appear in those systems, and your team members&apos; sign-in details (passwords are hashed).</li>
            <li>Alert records and monthly report delivery status.</li>
          </ul>
          <p className="text-muted-foreground">There is no third-party product analytics and no tracking outside the application.</p>
        </section>

        <section id="encryption" className="space-y-3">
          <h2 className="text-2xl font-semibold">Encryption at rest</h2>
          <p className="text-muted-foreground">
            OAuth access and refresh tokens, including Slack&apos;s bot token, your organization&apos;s OAuth application secrets
            and its SMTP password are encrypted with AES-256-GCM before they are written to the database, each under its own
            key. Disconnecting an integration clears its stored credentials.
          </p>
        </section>

        <section id="isolation" className="space-y-3">
          <h2 className="text-2xl font-semibold">Tenant isolation</h2>
          <p className="text-muted-foreground">
            Every record belongs to one organization, and every request is scoped to the signed-in user&apos;s organization. A
            request for another organization&apos;s record is treated as not found. This is covered by automated tests.
          </p>
        </section>

        <section id="retention" className="space-y-3">
          <h2 className="text-2xl font-semibold">Retention and deletion</h2>
          <p className="text-muted-foreground">
            There is no automatic expiry: data is kept until it is removed. Disconnecting an integration never deletes data; an
            owner can separately back up an integration&apos;s stored data and clean up a disconnected integration&apos;s imported data from Settings → Data. Removal of
            an organization is a manual operator action. Backups age out on a fixed schedule. Provider tokens are cleared on disconnect, but we do not
            call the provider to revoke them, so revoke the app in the provider as well if you want the grant gone. Compliance
            certifications and data-residency commitments are not offered today; ask us rather than assuming.
          </p>
        </section>
      </div>
    </DocsLayout>
  );
}
