import type { LucideIcon } from "lucide-react";
import type { PlanId } from "@sla/db/plans";

export interface MarketingFeature {
  icon: LucideIcon;
  title: string;
  description: string;
}

export interface MarketingStep {
  number: string;
  title: string;
  description: string;
}

export interface MarketingPrinciple {
  icon: LucideIcon;
  title: string;
  description: string;
}

export interface PricingPlan {
  id: PlanId;
  name: string;
  price: string;
  cadence: string;
  description: string;
  highlighted: boolean;
  features: string[];
}

export interface PricingFaq {
  question: string;
  answer: string;
}
