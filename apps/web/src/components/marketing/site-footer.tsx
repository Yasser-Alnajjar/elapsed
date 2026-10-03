import Link from "next/link";

import { BrandMark } from "@/components/shared/brand-mark";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { cn } from "@/lib/utils";
import { MONO_LABEL } from "./marketing-ui";

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
      { href: "/docs/security", label: "Security" },
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
    <footer className="mt-8 w-full border-t border-border bg-background">
      <div className="mx-auto w-full max-w-7xl px-4 pt-8 pb-6 lg:px-6">
        <div className="grid grid-cols-1 gap-6 border-b border-border pb-8 md:grid-cols-2 lg:grid-cols-5">
          <div className="flex flex-col gap-2">
            <BrandMark logoClassName="size-7" className="font-semibold" />
            <p className="text-foreground-subtle text-xs leading-relaxed">
              Know before your customer does. One clock across support, triage, and engineering handoffs.
            </p>
          </div>

          {COLUMNS.map((column) => (
            <div key={column.title} className="flex flex-col gap-2">
              <h3 className={cn(MONO_LABEL, "text-foreground-subtle tracking-widest")}>{column.title}</h3>
              <ul className="flex flex-col gap-1 text-xs">
                {column.links.map((link) => (
                  <li key={link.href} className="flex">
                    <Link href={link.href} className="text-muted-foreground transition-colors hover:text-foreground">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="flex flex-col items-center justify-between gap-4 pt-4 sm:flex-row">
          <p className="text-foreground-subtle font-mono text-xs">&copy; {new Date().getFullYear()} Elapsed. All rights reserved.</p>
          <div className="flex items-center gap-2">
            <span className={cn(MONO_LABEL, "text-foreground-subtle")}>Mode</span>
            <ThemeToggle />
          </div>
        </div>
      </div>
    </footer>
  );
}
