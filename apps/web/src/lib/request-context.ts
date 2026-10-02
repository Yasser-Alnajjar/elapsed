import "server-only";
import { cache } from "react";
import { getServerSession, type Session } from "next-auth";
import { redirect } from "next/navigation";

import { getPrismaClient } from "@sla/db";

import { authOptions } from "./auth";
import { recordUserSeen } from "./usage-tracking";

export interface RequestContext {
  session: Session;
  userId: string;
  organizationId: string;
  role: Session["user"]["role"];
}

/**
 * One `getServerSession` call per request instead of one per `Actions.*`
 * call — `React.cache` memoizes by argument-less call within the current
 * request only, never across requests (see performance-plan.md Phase 1.1).
 */
export const getRequestContext = cache(async (): Promise<RequestContext> => {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/sign-in");

  // Weekly-active measurement (N5.7): at most one write an hour per user,
  // fire-and-forget so the request never waits on it or fails because of it.
  void recordUserSeen(getPrismaClient(), session.user.id);

  return {
    session,
    userId: session.user.id,
    organizationId: session.user.organizationId,
    role: session.user.role,
  };
});
