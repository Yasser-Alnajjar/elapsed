import Link from "next/link";

import { BrandMark } from "@/components/shared/brand-mark";

const COLUMNS: { title: string; links: { href: string; label: string }[] }[] = [
  {
    title: "Product",
    links: [
      { href: "/pricing", label: "Pricing" },
      { href: "/docs", label: "Documentation" },
      { href: "/docs/integrations/zendesk", label: "Integrations" },
      { href: "/docs/how-it-works", label: "How it works" },
    ],
  },
  {
    title: "Company",
    links: [
      { href: "/about", label: "About" },
      { href: "/docs/faq", label: "FAQ" },
    ],
  },
  {
    title: "Account",
    links: [
      { href: "/sign-in", label: "Sign in" },
      { href: "/sign-up", label: "Get started" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/terms", label: "Terms of Service" },
      { href: "/privacy", label: "Privacy Policy" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-border/60">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-6 py-14 sm:grid-cols-2 md:grid-cols-4">
        <div className="space-y-3 sm:col-span-2 md:col-span-1">
          <BrandMark logoClassName="size-10" />

          <p className="max-w-xs text-sm leading-6 text-muted-foreground">
            Know before your customer does.
          </p>
        </div>

        {COLUMNS.map((column) => (
          <div key={column.title} className="space-y-3">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {column.title}
            </h3>
            <ul className="space-y-2.5">
              {column.links.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="border-t border-border/60">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-6 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>
            &copy; {new Date().getFullYear()} SLA Breach Monitoring. All rights
            reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
