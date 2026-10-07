import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type DocsContentProps = {
  children: ReactNode;
  className?: string;
};

export function DocsContent({ children, className }: DocsContentProps) {
  return (
    // Not a <main>: SidebarInset (docs-layout.tsx) already renders the page's one <main>.
    <div className="min-w-0 flex-1">
      <article
        className={cn(
          "mx-auto w-full max-w-7xl px-6 py-10",
          "sm:px-8 sm:py-12",
          className,
        )}
      >
        {children}
      </article>
    </div>
  );
}
