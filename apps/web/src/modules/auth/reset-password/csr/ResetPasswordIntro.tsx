import { Timer } from "lucide-react";
import { authLabelClass } from "@/components/shared/auth-shell";
import { cn } from "@/lib/utils";

/** Token-received / runway badges and the page title. */
export function ResetPasswordIntro({ token }: { token: string }) {
  const tokenHash = `0x${token.slice(0, 3)}...${token.slice(-3)}`;

  return (
    <>
      <div className="relative mb-6 flex flex-wrap items-center justify-between gap-1 pb-4">
        <div
          className={cn(
            authLabelClass,
            "flex items-center gap-1 rounded-[2px] bg-surface-raised px-2 py-1 text-primary-fixed-dim",
          )}
        >
          <span className="inline-block size-1.5 animate-pulse rounded-full bg-success" />
          <span className="tracking-widest">TOKEN RECEIVED</span>
          <span className="text-foreground-subtle">·</span>
          <span className="text-muted-foreground">TOKEN_HASH: {tokenHash}</span>
        </div>
        <div
          className={cn(
            authLabelClass,
            "flex items-center gap-1 rounded-[2px] bg-surface-raised px-2 py-1 text-warning",
          )}
        >
          <Timer aria-hidden className="size-[13px]" />
          <span>1H RUNWAY</span>
        </div>
      </div>

      <div className="mb-6 space-y-1">
        <h1 className="text-[28px] font-semibold leading-9 tracking-[-0.015em] text-foreground">
          Set a new master password
        </h1>
        <p className="text-sm leading-5 text-muted-foreground">
          For security reasons, your new password must comply with enterprise
          zero-trust entropy standards.
        </p>
      </div>
    </>
  );
}
