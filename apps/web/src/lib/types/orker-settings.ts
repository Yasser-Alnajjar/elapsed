// Deliberately not a *value* import of anything from `@sla/db` (see the same
// note in `worker-settings.ts`) — this file is imported by a client
// component (`modules/settings/monitoring/csr`), and pulling in `@sla/db`'s
// barrel would drag its Node-only `pg`/`@prisma/adapter-pg` driver into the
// browser bundle. Only the type survives; it's erased at compile time.
import type { LiveListenerConnectionState } from "@sla/db";

export type { LiveListenerConnectionState };

/** Mirrors `LiveDataStatus` (`@sla/db` + `live-data-bus.ts`), timestamps as ISO strings for the client boundary — see `getLiveDataStatusView`. */
export interface LiveDataStatusView {
  state: LiveListenerConnectionState;
  lastConnectedAt: string | null;
  lastEventAt: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
  reconnectCount: number;
}
