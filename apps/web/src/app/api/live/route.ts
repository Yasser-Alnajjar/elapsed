import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import type { LiveDataEvent } from "@sla/db";
import { authOptions } from "@/lib/auth";
import { getLiveDataBus, type LiveDataStatus } from "@/lib/live-data-bus";

// A long-lived stream must never be statically optimized or cached by Next
// itself — only ever run per-request, with its own connection lifecycle.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEARTBEAT_MS = 20_000;

function sseEvent(event: LiveDataEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * The browser only needs the Postgres `LISTEN` connection's state to render
 * its badge — never the raw error message, which could echo back
 * connection-level detail (host, auth failure text). That stays server-side,
 * visible only on the Monitoring settings page's own SSR read of
 * `getLiveDataBus().getStatus()`.
 */
function statusSseEvent(status: LiveDataStatus): string {
  return `event: listener.status\ndata: ${JSON.stringify({ state: status.state })}\n\n`;
}

/**
 * `GET /api/live` — the one global SSE stream every authenticated page
 * subscribes to (see `LiveDataProvider`). It never sends application data:
 * only "this organization's data changed", scoped server-side to the
 * caller's own session so one tenant's writes can never reach another
 * tenant's browser. The worker (and any web request going through
 * `withOrganizationSlaLock`) is the publisher; this route only relays what
 * `getLiveDataBus()` already receives from Postgres `LISTEN` for this
 * process.
 */
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const organizationId = session.user.organizationId;

  const bus = getLiveDataBus();
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let unsubscribe: (() => void) | null = null;
  let unsubscribeStatus: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // Controller already closed (client disconnected between an event
          // firing and this write) — cleanup below already runs from `abort`.
        }
      };

      // A retry hint plus an immediate comment so the browser (and any
      // buffering proxy in between) sees bytes right away instead of an
      // apparently-hung connection.
      send(`retry: 2000\n: connected\n\n`);

      unsubscribe = bus.subscribe(organizationId, (event) => {
        send(sseEvent(event));
      });

      // The client must never infer "Live" merely from the stream opening —
      // it gets the real, current Postgres-listener state right away, then
      // only a push per actual transition (never a poll) after that.
      send(statusSseEvent(bus.getStatus()));
      unsubscribeStatus = bus.subscribeToStatus((status) => {
        send(statusSseEvent(status));
      });

      heartbeat = setInterval(() => {
        send(": heartbeat\n\n");
      }, HEARTBEAT_MS);
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe?.();
      unsubscribeStatus?.();
    },
  });

  request.signal.addEventListener("abort", () => {
    if (heartbeat) clearInterval(heartbeat);
    unsubscribe?.();
    unsubscribeStatus?.();
  });
  console.log(
    "Live",
    new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        // Disables response buffering on nginx specifically (docs/deployment's
        // reverse proxy), belt-and-braces alongside the dedicated location
        // block in apps/nginx/nginx.conf.
        "X-Accel-Buffering": "no",
      },
    }),
  );

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Disables response buffering on nginx specifically (docs/deployment's
      // reverse proxy), belt-and-braces alongside the dedicated location
      // block in apps/nginx/nginx.conf.
      "X-Accel-Buffering": "no",
    },
  });
}
