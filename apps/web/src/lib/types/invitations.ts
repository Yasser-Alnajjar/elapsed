export interface PendingInvitation {
  id: string;
  email: string;
  expiresAt: string;
  createdAt: string;
}

export interface InvitationPreview {
  organizationName: string;
  email: string;
  alreadyRegistered: boolean;
}

/** The outcome of sending one invitation, as shown under an invite form. */
export interface InvitationSendStatus<Warning = unknown> {
  type: "success" | "error";
  message: string;
  /** Soft limit (N6.3): the invitation went out; this only tells the owner where they stand. */
  warning?: Warning;
}
