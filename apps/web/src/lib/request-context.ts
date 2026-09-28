import "server-only";
import { cache } from "react";
import { getServerSession, type Session } from "next-auth";
import { redirect } from "next/navigation";

import { authOptions } from "./auth";

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

  return {
    session,
    userId: session.user.id,
    organizationId: session.user.organizationId,
    role: session.user.role,
  };
});
