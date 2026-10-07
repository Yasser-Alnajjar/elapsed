import Link from "next/link";
import { ArrowRight, ExternalLink, Info } from "lucide-react";

import { DocsLayout } from "@/components/docs/docs-layout";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { getPageMetadata } from "@/lib/seo/metadata";

const toc = [
  { id: "channels", title: "Channels", level: 2 as const },
  { id: "slack", title: "Slack", level: 2 as const },
  { id: "email", title: "Email", level: 2 as const },
  { id: "triggers", title: "When alerts fire", level: 2 as const },
  { id: "deduplication", title: "Deduplication", level: 2 as const },
  { id: "failures", title: "Delivery failures", level: 2 as const },
];

export const generateMetadata = () => getPageMetadata("/docs/notifications");

export default function NotificationsPage() {
  return (
    <DocsLayout toc={toc}>
      <div className="space-y-12">
        <header className="space-y-4">
          <Badge variant="outline">Product</Badge>

          <div className="space-y-3">
            <h1 className="text-4xl font-bold tracking-tight">Notifications</h1>

            <p className="max-w-2xl text-lg leading-8 text-muted-foreground">
              Slack and email alerts fire the moment a commitment crosses a
              warning threshold or breaches — so you find out before your
              customer does.
            </p>
          </div>
        </header>

        <section id="channels" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">Channels</h2>

          <p className="leading-7 text-muted-foreground">
            Both notification channels are self-service, configured per
            organization from Settings → Integrations. Slack does not become a
            source of truth for SLA timing in the core model — it is purely an
            outbound alert channel, and neither is email.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border p-4">
              <p className="text-sm font-semibold">Slack</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Connect from Settings → Integrations and pick one alert
                channel.
              </p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-sm font-semibold">Email</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Add your SMTP server under Settings → Integrations →
                Notifications — no deployment-level configuration needed.
              </p>
            </div>
          </div>
        </section>

        <Separator />

        <section id="slack" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">Slack</h2>

          <p className="leading-7 text-muted-foreground">
            From Settings → Integrations, click Connect Slack and approve the
            OAuth prompt. Bot scopes requested:{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-sm">
              chat:write
            </code>
            ,{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-sm">
              chat:write.public
            </code>
            ,{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-sm">
              channels:read
            </code>
            , and{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-sm">
              groups:read
            </code>{" "}
            — enough to post messages and list channels for the picker; nothing
            else.
          </p>

          <p className="leading-7 text-muted-foreground">
            After connecting, pick one channel from a list (public and private
            channels the bot can see) and save it. There is exactly one alert
            channel per organization today — no per-severity or per-team
            routing.
          </p>

          <div className="space-y-2 rounded-lg border bg-muted/30 p-4 font-mono text-xs leading-6">
            <p>
              🚨 First response SLA breached — #4821 for Acme Corp, over target
              by 1h 12m.
            </p>
            <p>
              ⚠️ Resolution SLA at risk — #4821 for Acme Corp, 80% of target
              used, 1h 36m remaining.
            </p>
          </div>

          <p className="text-sm text-muted-foreground">
            See{" "}
            <Link
              href="/docs/integrations/slack"
              className="underline underline-offset-4"
            >
              Integrations → Slack
            </Link>{" "}
            for the full connection reference.
          </p>
        </section>

        <section id="email" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">Email</h2>

          <p className="leading-7 text-muted-foreground">
            Email alerts use the same trigger and deduplication logic as Slack,
            and go to every user in your organization — there is currently no
            per-user opt-out or preference, and no way to route email
            differently from Slack.
          </p>

          <Alert variant="warning">
            <Info className="size-4" />
            <AlertTitle>Configure your own SMTP server</AlertTitle>
            <AlertDescription>
              From Settings → Integrations → Notifications, add your SMTP
              host, port, security mode, credentials, and from-address. Use
              Test Connection to check authentication and Send Test Email to
              confirm delivery before saving — each organization brings its
              own SMTP server, there is no shared deployment-level fallback.
            </AlertDescription>
          </Alert>
        </section>

        <section id="triggers" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            When alerts fire
          </h2>

          <p className="leading-7 text-muted-foreground">
            The moment a first-response or resolution commitment crosses a
            warning threshold (50/80/95%) or breaches, checked on every sync
            cycle (at minimum every 5 minutes for open cases) and immediately on
            a Zendesk/Jira webhook delivery, if configured.
          </p>

          <p className="text-sm text-muted-foreground">
            The separate, optional engineering-leg target is currently
            dashboard-only and does not send its own alert. See{" "}
            <Link href="/docs/sla" className="underline underline-offset-4">
              SLA &amp; Targets
            </Link>
            .
          </p>
        </section>

        <section id="deduplication" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Deduplication
          </h2>

          <p className="leading-7 text-muted-foreground">
            Each commitment/threshold combination alerts at most once, ever — a
            poll that runs twice, or a webhook that fires alongside a scheduled
            poll, cannot double-alert.
          </p>
        </section>

        <section id="failures" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Delivery failures
          </h2>

          <p className="leading-7 text-muted-foreground">
            A failed notification is recorded internally; it does not block the
            same alert from being attempted through the other configured
            channel, and it does not stop other cases from being evaluated or
            alerted.
          </p>
        </section>

        <section className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Link
              href="/docs/integrations/slack"
              className="group flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-muted/50"
            >
              <div>
                <p className="text-sm font-medium">Connect Slack</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Set up your alert channel.
                </p>
              </div>
              <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
            </Link>

            <Link
              href="/docs/troubleshooting"
              className="group flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-muted/50"
            >
              <div>
                <p className="text-sm font-medium">Troubleshooting</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Notifications not arriving? Start here.
                </p>
              </div>
              <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
            </Link>
          </div>
        </section>

        <div className="border-t pt-8">
          <a
            href="#channels"
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
