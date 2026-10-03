"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const REVIEWED_POLICIES_KEY = "onboarding:reviewedPolicies";

/**
 * Consumes the one-shot query flags the flow is re-entered with, then strips
 * them from the URL: `?connected` (back from an OAuth callback) refreshes the
 * backfill status; `?reviewed` (back from the policy review) is remembered
 * for the tab session. Returns whether policies have been reviewed.
 */
export function useOnboardingReturnFlags(refresh: () => Promise<unknown>): {
  reviewedPolicies: boolean;
} {
  const router = useRouter();
  const searchParams = useSearchParams();

  const consumedConnectedParam = useRef(false);

  useEffect(() => {
    const connected = searchParams.get("connected");

    if (!connected || consumedConnectedParam.current) {
      return;
    }

    consumedConnectedParam.current = true;

    void refresh();
    router.replace("/onboarding");
  }, [searchParams, refresh, router]);

  const [reviewedPolicies, setReviewedPolicies] = useState(false);

  useEffect(() => {
    setReviewedPolicies(
      window.sessionStorage.getItem(REVIEWED_POLICIES_KEY) === "true",
    );
  }, []);

  const consumedReviewedParam = useRef(false);

  useEffect(() => {
    const reviewed = searchParams.get("reviewed");

    if (!reviewed || consumedReviewedParam.current) {
      return;
    }

    consumedReviewedParam.current = true;

    window.sessionStorage.setItem(REVIEWED_POLICIES_KEY, "true");
    setReviewedPolicies(true);
    router.replace("/onboarding");
  }, [searchParams, router]);

  return { reviewedPolicies };
}

/** Moves on to the activation screen shortly after onboarding completes. */
export function useRedirectWhenComplete(complete: boolean) {
  const router = useRouter();

  useEffect(() => {
    if (!complete) {
      return;
    }

    const timeout = window.setTimeout(() => {
      router.push("/onboarding/activation");
    }, 1200);

    return () => window.clearTimeout(timeout);
  }, [router, complete]);
}
