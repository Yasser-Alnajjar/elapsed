import type { ReactNode } from "react";

import { DocsContent } from "@/components/docs/docs-content";
import { DocsHeader } from "@/components/docs/docs-header";
import { DocsToc } from "@/components/docs/docs-toc";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { DocsSidebar } from "./docs-sidebar";

type DocsTocItem = {
  id: string;
  title: string;
  level: 2 | 3;
};

type DocsLayoutProps = {
  children: ReactNode;
  toc?: DocsTocItem[];
};

export function DocsLayout({ children, toc = [] }: DocsLayoutProps) {
  return (
    <SidebarProvider defaultOpen={false}>
      <DocsSidebar />
      <SidebarInset>
        <DocsHeader />

        <div className="mx-auto flex w-full max-w-7xl">
          <DocsContent>{children}</DocsContent>

          <DocsToc items={toc} />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
