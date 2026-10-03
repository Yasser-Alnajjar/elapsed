import { NextResponse } from "next/server";
import { getPrismaClient } from "@sla/db";
import { errorMessage } from "@/lib/utils";

/**
 * Deliberately unauthenticated (see `proxy.ts`'s `PUBLIC_API_PATHS`) — an
 * external uptime monitor or a Docker/orchestrator healthcheck has no
 * session cookie to send. Checks DB connectivity only (roadmap step 29's
 * stated scope) — this app has no other dependency worth gating startup on,
 * and a downstream Zendesk/Jira/etc outage is that integration's own
 * `lastSyncError`, not this app's health.
 */
export async function GET() {
  const prisma = getPrismaClient();

  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok", checks: { database: "ok" } });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "health_check_failed",
        error: errorMessage(error),
      }),
    );
    return NextResponse.json({ status: "error", checks: { database: "error" } }, { status: 503 });
  }
}
