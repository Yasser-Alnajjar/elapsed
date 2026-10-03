import type { ReactNode } from "react";
import { BillingCaption } from "@/components/billing/billing-ui";

interface BillingPageHeaderProps {
  /** Last breadcrumb segment, after "Settings". */
  crumb: string;
  title: string;
  description: ReactNode;
  actions?: ReactNode;
}

/** Breadcrumb, title, description and the page's primary actions. */
export function BillingPageHeader({ crumb, title, description, actions }: BillingPageHeaderProps) {
  return (
    <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5">
          <BillingCaption>Settings</BillingCaption>
          <BillingCaption className="opacity-60">/</BillingCaption>
          <BillingCaption className="text-primary">{crumb}</BillingCaption>
        </nav>
        <h1 className="text-foreground text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        <p className="text-muted-foreground max-w-2xl text-sm">{description}</p>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
