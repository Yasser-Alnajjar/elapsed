import { Network } from "lucide-react";

/** Pipeline-topology meta bar plus the page's title panel. */
export function IntegrationsHeader({
  connectedCount,
}: {
  connectedCount: number;
}) {
  return (
    <>
      {/* Breadcrumb / guardrail meta bar */}
      <div className="bg-surface-container-low flex flex-wrap items-center justify-between gap-2 rounded-xl px-4 py-1.5 shadow-sm">
        <div className="flex min-w-0 items-center gap-2">
          <Network className="text-primary size-4" />
          <span className="text-outline font-mono text-xxs uppercase">
            INGESTION_CONTROLLER // PIPELINE_TOPOLOGY
          </span>
          <span className="text-outline font-mono text-xs">/</span>
          <span className="text-primary truncate font-mono text-xs">
            v2-deterministic-clock
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-4">
          <div className="bg-surface-container flex items-center gap-1.5 rounded px-1.5 py-0.5">
            <span className="bg-success size-1.5 animate-pulse rounded-full" />
            <span className="text-success font-mono text-xxs">
              INGRESS RUNWAYS SYNCHRONIZED
            </span>
          </div>
          <span className="text-outline hidden font-mono text-xs sm:inline">
            POLL_INTERVAL: 1000ms
          </span>
        </div>
      </div>

      {/* Header panel */}
      <section className="bg-surface-container-low border-outline-variant/20 flex flex-col gap-4 rounded-xl border p-6 shadow-md">
        <div className="border-outline-variant/20 flex flex-wrap items-center justify-between gap-2 border-b pb-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-outline font-mono text-xxs font-semibold uppercase tracking-widest">
              Data ingestion pipelines
            </span>
            <span className="bg-surface-container border-outline-variant/30 text-secondary rounded border px-2 py-0.5 font-mono text-xxs">
              MUTATION LOCK: ACTIVE
            </span>
          </div>
        </div>
        <div className="max-w-4xl space-y-1">
          <h2 className="text-on-surface font-display text-xl font-semibold tracking-tight">
            Ticket &amp; Issue Integrations — Available Providers (
            {connectedCount} Active)
          </h2>
          <p className="text-on-surface-variant text-sm leading-relaxed">
            Bi-directional read-only streams synchronizing helpdesk ticket
            events and engineering issues into continuous customer wall-clock
            timelines.
          </p>
          <div className="mt-1 flex items-center gap-2">
            <span className="bg-primary/70 size-2 rounded-full" />
            <span className="text-on-surface-variant text-xs">
              Role Context:{" "}
              <strong className="text-on-surface font-medium">
                Organization Owner
              </strong>{" "}
              (Full pipeline configuration &amp; ingestion scope privileges)
            </span>
          </div>
        </div>
      </section>
    </>
  );
}
