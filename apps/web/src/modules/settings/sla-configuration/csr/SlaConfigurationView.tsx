"use client";

import { CalendarClock, Lock, Timer } from "lucide-react";
import type { SlaConfigurationData } from "@/lib/types/sla-configuration";
import { EngineeringTargetForm } from "./EngineeringTargetForm";
import { SlaPoliciesCard } from "./SlaPoliciesCard";
import { CustomerCalendarsCard } from "./CustomerCalendarsCard";
import { BusinessCalendarsCard } from "./BusinessCalendarsCard";
import { SlaSection } from "./SlaSection";

interface SlaConfigurationViewProps {
  data: SlaConfigurationData;
}

/**
 * Org-wide SLA engine configuration — engineering leg target, customer
 * calendar overrides, business calendars and versioned SLA policies. None of
 * these are provider-specific: they govern how the SLA engine calculates and
 * monitors commitments, not how a connection to Zendesk/Jira/Linear is made.
 */
export const SlaConfigurationView = ({ data }: SlaConfigurationViewProps) => {
  const {
    engineeringLegTargetMinutes,
    defaultCalendarId,
    slaPolicies,
    businessCalendars,
    customerCalendars,
  } = data;

  const pinnedCount = customerCalendars.filter((c) => c.calendarId).length;

  return (
    <div className="space-y-4">
      <div className="bg-surface-container-low flex flex-wrap items-center justify-between gap-2 rounded-xl px-4 py-1.5 shadow-sm">
        <div className="text-outline flex min-w-0 items-center gap-2 font-mono text-xxs uppercase tracking-widest">
          <span>Settings</span>
          <span>/</span>
          <span>SLA Engine</span>
          <span>/</span>
          <span className="text-primary font-semibold">
            Configuration Matrix
          </span>
        </div>

        <span className="bg-surface-container text-primary flex items-center gap-1.5 rounded px-2 py-0.5 font-mono text-xxs">
          <Lock className="size-3" />
          MUTATION LOCK: ACTIVE (OWNER PRIVILEGES)
        </span>
      </div>

      <div>
        <span className="text-secondary font-mono text-xxs font-semibold uppercase tracking-widest">
          Deterministic timers
        </span>
        <h2 className="text-on-surface font-display mt-1 text-xl font-medium tracking-tight">
          SLA Configuration
        </h2>
        <p className="text-on-surface-variant mt-1 max-w-4xl text-sm">
          Configure organization commitments, cross-silo engineering target
          budgets, business calendars, and versioned SLA policies.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <SlaSection
          className="xl:col-span-5"
          delay={0}
          icon={<Timer className="size-5" />}
          title="Engineering Leg Target"
          subtitle="Team-wide target for cases in the engineering leg"
        >
          <EngineeringTargetForm
            initialTargetMinutes={engineeringLegTargetMinutes}
          />
        </SlaSection>

        <SlaSection
          className="xl:col-span-7"
          delay={0.1}
          icon={<CalendarClock className="size-5" />}
          title="Customer Calendars"
          meta={`${pinnedCount} pinned`}
          subtitle="Per-customer business hours override. Only new commitments pick up the change."
        >
          <CustomerCalendarsCard
            customers={customerCalendars}
            calendars={businessCalendars}
          />
        </SlaSection>
      </div>

      <BusinessCalendarsCard
        calendars={businessCalendars}
        defaultCalendarId={defaultCalendarId}
      />

      <SlaPoliciesCard
        policies={slaPolicies}
        businessCalendars={businessCalendars}
        customers={customerCalendars}
        defaultCalendarId={defaultCalendarId}
      />
    </div>
  );
};
