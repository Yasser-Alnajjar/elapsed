import type { DraftConfigDocument } from "@/lib/types/custom-provider";

/** What every wizard step receives: the document, how to change it, and the sample paths for the pickers. */
export interface StepProps {
  config: DraftConfigDocument;
  /** Replaces the value at a path (an empty string removes the key). */
  set: (path: (string | number)[], value: unknown) => void;
  /** Paths found in the latest sample ticket. */
  paths: string[];
  /** Secret fields already stored (so the form can say "set" without ever holding a value). */
  secretsSet: string[];
  /** New secret values typed in this session (write-only). */
  secrets: Record<string, string>;
  setSecret: (field: string, value: string) => void;
  userId: string;
}
