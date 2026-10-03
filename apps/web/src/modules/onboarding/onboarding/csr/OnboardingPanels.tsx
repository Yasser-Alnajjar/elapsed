import {
  CircleCheck,
  Network,
  Route,
  ShieldCheck,
  Workflow,
  type LucideIcon,
} from "lucide-react";

/** Presentational side panels and strips that frame the onboarding steps. */

interface StatItem {
  label: string;
  value: string;
  unit: string;
}

/** Fixed-fact backfill specs — the mockups' inline metric strip, kept to claims the product actually guarantees. */
export function StatStrip({ stats }: { stats: StatItem[] }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-surface-container-low p-3.5">
      <div className="flex items-center gap-4">
        {stats.map((stat, index) => (
          <div key={stat.label} className="flex items-center gap-4">
            {index > 0 && (
              <div className="hidden h-8 w-px bg-outline-variant/30 sm:block" />
            )}
            <div className="flex flex-col">
              <span className="font-label-caps text-label-caps text-on-surface-variant uppercase">
                {stat.label}
              </span>
              <span className="font-mono-metric-lg text-mono-metric-lg text-on-surface">
                {stat.value}{" "}
                <span className="font-body-sm text-body-sm text-on-surface-variant">
                  {stat.unit}
                </span>
              </span>
            </div>
          </div>
        ))}
      </div>
      <span className="font-code-audit text-code-audit hidden rounded bg-tertiary-container/10 px-2 py-1 text-tertiary sm:inline">
        REST + INCREMENTAL API
      </span>
    </div>
  );
}

/** Right-column "what's ahead" panel shown during Stage 02 backfill — the mockups' "Next Step Connection" card, without inventing numbers that don't exist yet. */
export function NextStepPanel() {
  return (
    <div className="flex flex-col gap-4 rounded-xl bg-surface-container-lowest p-6 shadow-elevated">
      <div className="flex items-center justify-between">
        <span className="font-label-caps text-label-caps uppercase tracking-wider text-primary">
          System reconciliation
        </span>
        <Workflow className="size-5 text-primary shrink-0" />
      </div>
      <div className="flex flex-col gap-1.5">
        <h3 className="font-headline-sm text-headline-sm text-on-surface">
          Next: connect engineering
        </h3>
        <p className="font-body-sm text-body-sm text-on-surface-variant">
          The SLA clock keeps running when a case moves into engineering.
          Connecting a work tracker next links each escalated ticket to its
          issue so that time is never silently dropped. It is optional: you can
          start without one.
        </p>
      </div>
      <span className="font-label-caps text-label-caps self-start rounded bg-primary-container/20 px-1.5 py-0.5 uppercase text-primary">
        Ready in step 3
      </span>
    </div>
  );
}

/** Right-column panel for Stage 03 — the mockups' "Continuous Timeline Engine" panel, kept to the two guarantees the product actually makes. */
export function CorrelationPanel() {
  return (
    <div className="flex flex-col gap-4 rounded-xl bg-surface-container-lowest p-6 shadow-elevated">
      <div className="flex items-center justify-between">
        <span className="font-label-caps text-label-caps uppercase tracking-wider text-primary">
          Continuous timeline engine
        </span>
        <Route className="size-5 text-primary shrink-0" />
      </div>

      <div className="flex gap-2.5 rounded-lg bg-surface-container p-3">
        <ShieldCheck className="size-4 shrink-0 text-primary" />
        <div className="flex flex-col gap-0.5">
          <span className="font-headline-sm text-[14px] leading-tight text-on-surface">
            Zero mutation guarantee
          </span>
          <p className="font-body-sm text-body-sm text-on-surface-variant">
            Elapsed requests strictly read-only authorization — it can&apos;t
            edit issues, add comments, or transition workflows.
          </p>
        </div>
      </div>

      <div className="flex gap-2.5 rounded-lg bg-surface-container p-3">
        <Network className="size-4 shrink-0 text-primary" />
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            <span className="font-headline-sm text-[14px] leading-tight text-on-surface">
              Deterministic correlation
            </span>
            <span className="font-label-caps text-label-caps rounded bg-tertiary/10 px-1 py-0.5 uppercase text-tertiary">
              Zero guessing
            </span>
          </div>
          <p className="font-body-sm text-body-sm text-on-surface-variant">
            Tickets are matched strictly via official remote issue links and
            issue keys — never fuzzy guesswork or synthetic estimation.
          </p>
        </div>
      </div>
    </div>
  );
}

/** SOC2 trust micro-badge under the trust rail. */
export function Soc2Badge() {
  return (
    <div className="flex items-center justify-between rounded-lg bg-surface-container-low px-3.5 py-2.5 text-on-surface-variant">
      <div className="flex items-center gap-2">
        <CircleCheck className="size-4 text-tertiary shrink-0" />
        <span className="font-body-sm text-body-sm">
          SOC 2 Type II–aligned architecture
        </span>
      </div>
      <span className="font-code-audit text-code-audit text-on-surface-variant/60">
        Read-only by design
      </span>
    </div>
  );
}

interface TrustItem {
  icon: LucideIcon;
  title: string;
  description: string;
}

/** Trust rail under a connector's form — the mockups' "Engine Safety & Trust Contract" panel, with copy that matches what the product actually does. */
export function TrustList({ items }: { items: TrustItem[] }) {
  return (
    <div className="flex flex-col gap-2">
      {items.map(({ icon: Icon, title, description }) => (
        <div
          key={title}
          className="flex gap-2.5 rounded-lg bg-surface-container-low p-3"
        >
          <div className="flex size-7 shrink-0 items-center justify-center rounded bg-surface-container-high text-primary">
            <Icon className="size-4 shrink-0" />
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="font-headline-sm text-[15px] leading-tight text-on-surface">
              {title}
            </span>
            <p className="font-body-sm text-body-sm text-on-surface-variant">
              {description}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
