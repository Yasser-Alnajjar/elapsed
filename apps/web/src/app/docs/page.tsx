import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  CirclePlay,
  GitBranch,
  LifeBuoy,
  Plug,
  ShieldCheck,
} from "lucide-react";

import { DocsLayout } from "@/components/docs/docs-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getPageMetadata } from "@/lib/seo/metadata";

const sections = [
  {
    title: "Getting Started",
    description:
      "Set up your workspace, connect your systems, and start monitoring SLA performance.",
    href: "/docs/getting-started",
    icon: CirclePlay,
  },
  {
    title: "How It Works",
    description:
      "Understand how cases, events, engineering handoffs, and SLA time are calculated.",
    href: "/docs/how-it-works",
    icon: GitBranch,
  },
  {
    title: "Integrations",
    description:
      "Connect Zendesk, Jira, Slack, and more, and understand what data is used.",
    href: "/docs/integrations/zendesk",
    icon: Plug,
  },
  {
    title: "Cases",
    description:
      "Learn how customer cases are created, correlated, and tracked across systems.",
    href: "/docs/cases",
    icon: BookOpen,
  },
  {
    title: "SLA & Targets",
    description:
      "Configure SLA behavior and understand engineering response targets.",
    href: "/docs/sla",
    icon: ShieldCheck,
  },
  {
    title: "Troubleshooting",
    description:
      "Find answers to common setup, integration, synchronization, and SLA issues.",
    href: "/docs/troubleshooting",
    icon: LifeBuoy,
  },
];

export const generateMetadata = () => getPageMetadata("/docs");

export default function DocsPage() {
  return (
    <DocsLayout>
      <div className="space-y-12">
        <section className="space-y-5">
          <div className="flex size-12 items-center justify-center rounded-xl border bg-muted">
            <BookOpen className="size-6" />
          </div>

          <div className="space-y-3">
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
              Documentation
            </h1>

            <p className="max-w-2xl text-lg leading-8 text-muted-foreground">
              Everything you need to connect your systems, understand SLA
              performance, and identify customer cases at risk of breach.
            </p>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2">
          <h2 className="sr-only">Documentation sections</h2>

          {sections.map((section) => {
            const Icon = section.icon;

            return (
              <Link key={section.href} href={section.href} className="group">
                <Card className="h-full transition-colors hover:border-foreground/20 hover:bg-muted/30">
                  <CardHeader>
                    <div className="mb-2 flex size-9 items-center justify-center rounded-lg border bg-background">
                      <Icon className="size-4" />
                    </div>

                    <CardTitle className="flex items-center gap-2 text-base">
                      {section.title}

                      <ArrowRight className="size-4 opacity-0 transition-opacity group-hover:opacity-100" />
                    </CardTitle>
                  </CardHeader>

                  <CardContent>
                    <p className="text-sm leading-6 text-muted-foreground">
                      {section.description}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </section>
      </div>
    </DocsLayout>
  );
}
