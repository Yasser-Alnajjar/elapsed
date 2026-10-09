"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { Actions } from "@/actions/client";
import { formatRetryAfter } from "@/lib/auth-rate-limit";
import { useRetryCountdown } from "@/hooks/use-retry-countdown";

type ResendState =
  | { status: "idle" }
  | { status: "sending" }
  | { status: "sent" }
  | { status: "error"; message: string };

/**
 * "Resend verification email" for an account that can't sign in until its
 * email is verified — shared by the sign-in screen (shown when sign-in is
 * refused as unverified) and the post-sign-up "check your email" screen.
 * The server answers identically whether or not the address has an
 * account, so a "sent" here means "asked", never "an account exists".
 */
export const ResendVerification = ({ email }: { email: string }) => {
  const [state, setState] = useState<ResendState>({ status: "idle" });
  const retry = useRetryCountdown();

  async function handleResend() {
    setState({ status: "sending" });
    const { ok, body } = await Actions.EmailVerification.resend(email);
    if (!ok && body.retryAfterSeconds) retry.start(body.retryAfterSeconds);
    setState(
      ok
        ? { status: "sent" }
        : {
            status: "error",
            message: body.error ?? "Could not send the email. Try again.",
          },
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={handleResend}
        disabled={state.status === "sending" || retry.active}
        className="inline-flex w-fit cursor-pointer items-center gap-1.5 font-medium underline underline-offset-4 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {state.status === "sending" && (
          <Loader2 aria-hidden className="size-3.5 animate-spin" />
        )}
        {state.status === "sending"
          ? "Sending…"
          : retry.active
            ? `Try again in ${formatRetryAfter(retry.remainingSeconds)}`
            : "Resend verification email"}
      </button>
      {state.status === "sent" && (
        <p role="status">
          If that account still needs verifying, a new link is on its way.
        </p>
      )}
      {state.status === "error" && !retry.active && (
        <p role="alert">{state.message}</p>
      )}
    </div>
  );
};
