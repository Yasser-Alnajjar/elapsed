import Link from "next/link";
import { getServerSession } from "next-auth";
import { TRIAL_LENGTH_DAYS } from "@sla/db/plans";

import { BrandMark } from "@/components/shared/brand-mark";
import { authOptions } from "@/lib/auth";
import { UserMenu } from "../layout/user-menu";
import { MarketingCta } from "./marketing-ui";
import { SiteMobileNav } from "./site-mobile-nav";
import { SiteNav } from "./site-nav";

export async function SiteHeader() {
  const session = await getServerSession(authOptions);
  const isAuthenticated = !!session?.user;

  const LINKS = [
    { href: "/", label: "Product" },
    { href: "/pricing", label: "Pricing" },
    { href: "/docs/security", label: "Security" },
    { href: "/about", label: "About" },
    { href: "/docs", label: "Docs" },
    ...(isAuthenticated ? [{ href: "/dashboard", label: "Dashboard" }] : []),
  ];

  return (
    <header className="bg-background/90 sticky top-0 z-40 h-16 border-b border-border backdrop-blur-md">
      <div className="mx-auto flex h-full w-full max-w-7xl items-center justify-between gap-4 px-4 lg:px-6">
        <Link
          href="/"
          aria-label="Elapsed, home"
          className="hover:text-primary transition-colors"
        >
          <BrandMark logoClassName="size-8" className="text-xl font-semibold" />
        </Link>

        <SiteNav links={LINKS} />

        <div className="flex items-center gap-2">
          {isAuthenticated ? (
            <UserMenu user={session.user} />
          ) : (
            <>
              <MarketingCta
                href="/sign-in"
                variant="outline"
                size="sm"
                className="hidden sm:inline-flex"
              >
                Sign in
              </MarketingCta>
              <MarketingCta href="/sign-up" size="sm">
                Start {TRIAL_LENGTH_DAYS}-day trial
              </MarketingCta>
            </>
          )}
          <SiteMobileNav links={LINKS} />
        </div>
      </div>
    </header>
  );
}
