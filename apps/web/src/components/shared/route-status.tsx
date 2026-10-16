import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { BrandMark } from "@/components/shared/brand-mark";

/**
 * Body of the `error.tsx` / `not-found.tsx` boundaries. `standalone` is for
 * the root-level boundaries, which render outside any app shell and so
 * bring their own full-screen frame and brand mark.
 */
export function RouteStatus({
  icon: Icon,
  title,
  description,
  actions,
  standalone = false,
}: {
  icon: LucideIcon;
  title: string;
  description: ReactNode;
  actions?: ReactNode;
  standalone?: boolean;
}) {
  const body = (
    <div className="flex flex-col items-center gap-4 text-center">
      <span className="flex size-11 items-center justify-center rounded-full bg-interactive/60 text-muted-foreground">
        <Icon className="size-5" />
      </span>
      <div className="space-y-1.5">
        <h1 className="font-display text-2xl font-medium tracking-tight">
          {title}
        </h1>
        <div className="max-w-md text-sm text-muted-foreground">
          {description}
        </div>
      </div>
      {actions && (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          {actions}
        </div>
      )}
    </div>
  );

  if (!standalone) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4 py-16">
        {body}
      </div>
    );
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-6 py-16">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-grain"
      />
      <div className="relative flex flex-col items-center gap-10">
        <BrandMark logoClassName="size-12" />
        {body}
      </div>
    </main>
  );
}

/** Shows Next's error digest so a user can quote it and it can be matched to the server log. */
export function ErrorReference({ digest }: { digest?: string }) {
  if (!digest) return null;
  return (
    <p className="mt-2 text-xs text-muted-foreground">
      Reference: <code className="font-mono">{digest}</code>
    </p>
  );
}
