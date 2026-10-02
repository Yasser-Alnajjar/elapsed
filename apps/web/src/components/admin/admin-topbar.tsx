"use client";

import { Search, Timer } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { formatUtcClock } from "@/lib/admin-format";

/**
 * The admin top bar. The search is real: it opens the Tenants list filtered to
 * the query (name, owner email or tenant id), and `⌘K` / `Ctrl+K` focuses it.
 * The clock is the browser's own, shown in UTC, because every timestamp in the
 * console is UTC.
 */
export function AdminTopbar({ actorEmail }: { actorEmail: string }) {
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
    router.push(trimmed ? `/admin/tenants?q=${encodeURIComponent(trimmed)}` : "/admin/tenants");
    inputRef.current?.blur();
  }

  return (
    <header className="bg-card/90 border-border sticky top-0 z-30 flex h-14 items-center gap-3 border-b px-4 backdrop-blur-xl lg:px-6">
      <SidebarTrigger className="shrink-0" />

      <form onSubmit={handleSubmit} role="search" className="relative min-w-0 max-w-xl flex-1">
        <Search className="text-foreground-subtle pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" aria-hidden />
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
        <UtcClock />
        <div className="bg-border hidden h-4 w-px sm:block" />
        <ThemeToggle />
        <div className="flex items-center gap-2.5">
          <div className="hidden min-w-0 flex-col text-right md:flex">
            <span className="text-foreground max-w-48 truncate font-mono text-xs leading-none" title={actorEmail}>
              {actorEmail}
            </span>
            <span className="text-primary mt-1 font-mono text-[10px] leading-none font-semibold tracking-[0.06em] uppercase">
              Platform operator
            </span>
          </div>
          <span
            aria-hidden
            className="bg-primary text-primary-foreground flex size-8 shrink-0 items-center justify-center rounded-full font-mono text-xs font-semibold"
          >
            {actorEmail.slice(0, 2).toUpperCase()}
          </span>
        </div>
      </div>
    </header>
  );
}

/** Ticks once a second after mount; renders a placeholder first so server and client markup match. */
function UtcClock() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div
      className="bg-surface-raised border-border text-muted-foreground hidden items-center gap-1.5 rounded border px-2.5 py-1 font-mono text-xs sm:flex"
      title="Every timestamp in this console is UTC"
    >
      <Timer className="text-foreground-subtle size-3.5" aria-hidden />
      <span className="text-foreground font-medium tabular-nums">UTC {now ? formatUtcClock(now) : "--:--:--"}</span>
    </div>
  );
}
