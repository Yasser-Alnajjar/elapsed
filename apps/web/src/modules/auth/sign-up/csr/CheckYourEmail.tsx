"use client";

import { MailCheck } from "lucide-react";
import { AuthShell } from "@/components/shared/auth-shell";
import { ResendVerification } from "@modules/auth/verify-email/csr/ResendVerification";

/**
 * Shown in place of the sign-up form once the account exists. Sign-up no
 * longer signs the user in — the account can't be used until its email is
 * verified — so this tells them what to do next.
 */
export const CheckYourEmail = ({ email }: { email: string }) => (
  <AuthShell
    title="Check your email"
    description={`We sent a verification link to ${email}. Verify it, then sign in to continue.`}
    footer={
      <p>
        <a
          href="/sign-in"
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          Go to sign in
        </a>
      </p>
    }
  >
    <div className="flex items-start justify-center gap-2 text-xs leading-4 text-muted-foreground">
      <MailCheck aria-hidden className="mt-px size-3.5 shrink-0" />
      <ResendVerification email={email} />
    </div>
  </AuthShell>
);
