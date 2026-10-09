import type { ActivationImpact } from "@sla/commitments";
import type { ConnectionTest, DraftView, FullPassMeasurement, Preview, Sample } from "@sla/custom-ticket";
import type { CustomStatus } from "@/lib/custom-provider/status";

/** Everything the Custom REST page needs, assembled on the server. */
export interface CustomProviderPageData {
  /** The operator's Beta flag for this organization. */
  enabled: boolean;
  /** The caller is the organization owner; members read the state but cannot change it. */
  isOwner: boolean;
  /** The signed-in user, recorded with the comment-visibility acknowledgement. */
  userId: string;
  draft: DraftView | null;
  status: CustomStatus;
}

export type { ActivationImpact, ConnectionTest, DraftView, FullPassMeasurement, Preview, Sample };

export interface DraftConfigDocument {
  [key: string]: unknown;
}

export interface MetricVerdictView {
  state: "supported" | "supported_with_limitations" | "unsupported";
  reasons: string[];
}

export interface ValidateResponse {
  ok: boolean;
  issues: { path: string; code: string }[];
  diagnostics: { severity: "error" | "warning"; code: string; path: string }[];
  support?: Record<"first_response" | "next_reply" | "resolution", MetricVerdictView>;
  limitations?: string[];
  requiredSecrets?: string[];
  secretsSet?: string[];
  impact?: ActivationImpact;
}

export type ActivateOutcome =
  | { kind: "activated"; version: number; cancelled: number }
  | { kind: "needs_confirmation"; impact: ActivationImpact }
  | { kind: "listing_too_large"; measurement: FullPassMeasurement }
  | { kind: "invalid"; issues: { path: string; code: string }[]; diagnostics: { severity: string; code: string; path: string }[] }
  | { kind: "error"; code: string; missing?: string[] };
