"use client";

import { Search, Timer } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useOrgTimezone } from "@/components/shared/org-timezone-provider";
import { formatClockTime, formatTimeZoneLabel } from "@/lib/format";
import type { IUser } from "@/lib/types/user";
import { UserMenu } from "../layout/user-menu";

/**
 * The admin top bar. The search is real: it opens the Tenants list filtered to
 * the query (name, owner email or tenant id), and `⌘K` / `Ctrl+K` focuses it.
 * The clock is the browser's own, shown in the operator's organization display
 * timezone (`Organization.timezone`), not UTC. The timestamps in the console's
 * tables stay UTC (see `@/lib/admin-format`); the clock's tooltip says so.
 */
export function AdminTopbar({ user }: { user: IUser }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = query.trim();
    router.push(
      trimmed
        ? `/admin/tenants?q=${encodeURIComponent(trimmed)}`
        : "/admin/tenants",
    );
    inputRef.current?.blur();
  }

  return (
    <header className="bg-surface-container-lowest border-border sticky top-0 z-30 flex h-14 items-center gap-3 border-b px-4 backdrop-blur-xl lg:px-6">
      <SidebarTrigger className="shrink-0" />

      <form
        onSubmit={handleSubmit}
        role="search"
        className="relative min-w-0 max-w-xl flex-1"
      >
        <Search
          className="text-foreground-subtle pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
          aria-hidden
        />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find a tenant by name, owner or id"
          aria-label="Find a tenant"
          className="bg-background border-border text-foreground placeholder:text-foreground-subtle focus:border-primary h-9 w-full rounded border py-1.5 pr-14 pl-9 font-mono text-xs outline-none transition-colors"
        />
        <kbd className="border-border text-foreground-subtle pointer-events-none absolute top-1/2 right-2.5 hidden -translate-y-1/2 rounded border px-1.5 py-0.5 font-mono text-[10px] sm:block">
          ⌘K
        </kbd>
      </form>

      <div className="ml-auto flex shrink-0 items-center gap-3">
        <OrgClock />
        <div className="bg-border hidden h-4 w-px sm:block" />
        <UserMenu user={user} />
      </div>
    </header>
  );
}

/** Ticks once a second after mount; renders a placeholder first so server and client markup match. */
export function OrgClock() {
  const timeZone = useOrgTimezone();
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const label = formatTimeZoneLabel(timeZone);

  return (
    <div
      className="bg-surface-raised border-border text-muted-foreground hidden items-center gap-1.5 rounded border px-2.5 py-1 font-mono text-xs sm:flex"
      title={`Current time in ${label}, your organization's display timezone. Timestamps in the console's tables are UTC.`}
    >
      <Timer className="text-foreground-subtle size-3.5" aria-hidden />
      <span className="text-foreground font-medium tabular-nums">
        {label} {now ? formatClockTime(now, timeZone) : "--:--:--"}
      </span>
    </div>
  );
}
