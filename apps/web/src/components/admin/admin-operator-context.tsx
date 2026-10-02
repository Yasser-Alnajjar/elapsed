"use client";

import { createContext, useContext } from "react";

const AdminOperatorContext = createContext<string | null>(null);

/** Makes the signed-in operator's email available to the admin area, so a dialog can say who is acting and a banner who looked. */
export function AdminOperatorProvider({ actorEmail, children }: { actorEmail: string; children: React.ReactNode }) {
  return <AdminOperatorContext.Provider value={actorEmail}>{children}</AdminOperatorContext.Provider>;
}

/** The signed-in operator's email. Only valid under `AdminShell`; the admin layout guarantees a signed-in operator. */
export function useAdminOperator(): string {
  const actorEmail = useContext(AdminOperatorContext);
  if (actorEmail === null) throw new Error("useAdminOperator must be used inside the admin shell");
  return actorEmail;
}
