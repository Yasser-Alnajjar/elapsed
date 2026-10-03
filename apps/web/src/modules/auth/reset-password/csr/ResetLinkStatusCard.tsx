"use client";

import { AlertCircle, ArrowRight, CheckCircle2 } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  AuthAlert,
  AuthPage,
  authButtonClass,
} from "@/components/shared/auth-shell";
import { cn } from "@/lib/utils";
import { cardClass } from "./reset-password-schema";

/** The terminal states: the password was reset, or the link has no token to reset with. */
export function ResetLinkStatusCard({ submitted }: { submitted: boolean }) {
  const router = useRouter();

  return (
    <AuthPage>
      <div className="relative z-10 mx-auto w-full max-w-xl">
        <div className={cardClass}>
          <div className="flex flex-col gap-4">
            <div className="space-y-1">
              <h1 className="text-[28px] font-semibold leading-9 tracking-[-0.015em] text-foreground">
                {submitted ? "Password reset" : "Reset password"}
              </h1>
              <p className="text-sm leading-5 text-muted-foreground">
                {submitted
                  ? "Your password has been changed."
                  : "This reset link is missing its token."}
              </p>
            </div>
            {submitted ? (
              <>
                <AuthAlert tone="success" icon={<CheckCircle2 aria-hidden />}>
                  You can now sign in with your new password.
                </AuthAlert>
                <button
                  type="button"
                  className={cn(authButtonClass, "h-11")}
                  onClick={() => router.push("/sign-in")}
                >
                  <span>Go to sign in</span>
                  <ArrowRight aria-hidden className="size-[18px]" />
                </button>
              </>
            ) : (
              <>
                <AuthAlert tone="danger" icon={<AlertCircle aria-hidden />}>
                  Open the link from your email again, or request a new one.
                </AuthAlert>
                <a
                  href="/forgot-password"
                  className={cn(authButtonClass, "h-11")}
                >
                  Request a new link
                </a>
              </>
            )}
          </div>
        </div>
      </div>
    </AuthPage>
  );
}
