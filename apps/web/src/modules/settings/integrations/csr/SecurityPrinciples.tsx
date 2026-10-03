import { ShieldCheck } from "lucide-react";

const PRINCIPLES = [
  {
    title: "Wall-Clock Immutability",
    body: "Elapsed records absolute timestamps at the exact instant an external webhook is received. Timelines do not rely on malleable third-party update fields.",
  },
  {
    title: "Non-Attributive Leg Tracking",
    body: 'Time elapsed is calculated per operational leg ("Engineering Leg", "Support Leg") rather than individual agent names, prioritizing root bottlenecks over friction.',
  },
  {
    title: "Zero Payload Persistence",
    body: "Ticket comment text, customer email strings, and attachment blobs are stripped immediately at the edge. Only cryptographic event hashes are indexed.",
  },
];

/** The three numbered timeline-security principles under the provider cards. */
export function SecurityPrinciples() {
  return (
    <section className="bg-surface-container-low flex flex-col gap-4 rounded-xl p-6 shadow-md">
      <div className="flex flex-col justify-between gap-2 md:flex-row md:items-center">
        <div className="flex items-center gap-2">
          <span className="bg-surface-container text-primary flex size-8 items-center justify-center rounded">
            <ShieldCheck className="size-4" />
          </span>
          <div className="flex flex-col">
            <h3 className="text-on-surface font-display text-lg font-semibold">
              Deterministic Timeline Security Principles
            </h3>
            <span className="text-outline font-mono text-xxs uppercase">
              Cryptographic read integrity without message content ingestion
            </span>
          </div>
        </div>
        <span className="text-success bg-success/10 rounded px-2 py-1 font-mono text-xxs">
          SOC-2 TYPE II AUDITED
        </span>
      </div>
      <div className="grid grid-cols-1 items-stretch gap-4 pt-2 md:grid-cols-3">
        {PRINCIPLES.map((principle, index) => (
          <div
            key={principle.title}
            className="bg-surface-container border-outline-variant/20 flex h-full flex-col gap-1 rounded-lg border p-4"
          >
            <span className="text-on-surface font-mono text-sm font-bold">
              <span className="text-primary">0{index + 1}.</span>{" "}
              {principle.title}
            </span>
            <p className="text-on-surface-variant text-xs leading-relaxed">
              {principle.body}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
