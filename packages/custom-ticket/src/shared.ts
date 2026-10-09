import type { CustomConfig } from "./schema";
import type { EvalEnv } from "./transforms";

/** Raw-event id prefixes the normalizer reads. */
export const RAW_PREFIX = { ticket: "ticket:", comment: "comment:", history: "history:", deleted: "ticket_deleted:" } as const;

export function envOf(config: CustomConfig): EvalEnv {
  return { timezone: config.timezone ?? null };
}
