import { Actions } from "@/actions/client";
import type { EntitlementWarningPayload } from "@/components/shared/entitlement-alerts";
import type { InvitationSendStatus } from "@/lib/types/invitations";

export type InviteStatus = InvitationSendStatus<EntitlementWarningPayload>;

/** Sends one invitation and words the result the same way on every invite form. */
export async function sendInvitation(email: string): Promise<InviteStatus> {
  const { ok, body } = await Actions.Invitations.invite(email);

  if (!ok) {
    return {
      type: "error",
      message: body.error ?? "Failed to send invitation",
    };
  }

  return {
    type: "success",
    message: body.resent ? "Invitation resent." : "Invitation sent.",
    warning: body.entitlementWarning,
  };
}
