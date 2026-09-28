"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { connectLiveData } from "@/lib/live-data-connection";
import { setLiveStatus, setSseTransportOpen } from "@/lib/live-status-store";

/**
 * Global, event-driven replacement for the old `SlaAutoRefreshProvider`
 * timer. Mounted once in `(main)/layout.tsx` so it covers every page under
 * the app shell, not just the dashboard: it opens one SSE connection to
 * `/api/live`, scoped server-side to the signed-in organization, and calls
 * `router.refresh()` only when that organization's data actually changed —
 * never on a fixed interval.
 */
export function LiveDataProvider() {
  const router = useRouter();
  // `router` is a fresh object on some navigations; the effect below must
  // not re-run (and reopen the SSE connection) just because of that.
  const routerRef = useRef(router);
  routerRef.current = router;

  useEffect(() => {
    const connection = connectLiveData({
      url: "/api/live",
      onRefresh: () => routerRef.current.refresh(),
      onStatusChange: setLiveStatus,
      onTransportChange: setSseTransportOpen,
    });
    return () => connection.close();
  }, []);

  return null;
}
