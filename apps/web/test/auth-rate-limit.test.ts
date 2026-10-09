import { describe, expect, it } from "vitest";
import {
  EMAIL_NOT_VERIFIED_ERROR,
  encodeAuthThrottleError,
  encodeCredentialsRateLimitError,
  formatRetryAfter,
  interpretCredentialsSignInResult,
} from "../src/lib/auth-rate-limit";

describe("encodeCredentialsRateLimitError / interpretCredentialsSignInResult round trip", () => {
  it("carries the exact retryAfterSeconds proxy.ts computed through to the UI-facing shape", () => {
    const encoded = encodeCredentialsRateLimitError(287);
    const result = interpretCredentialsSignInResult({ error: encoded, status: 429, ok: false, url: null });

    expect(result).toEqual({ ok: false, error: "RATE_LIMITED", retryAfterSeconds: 287 });
  });

  it("rounds and floors non-integer/zero input to at least 1 second so the UI never shows an already-expired cooldown", () => {
    expect(encodeCredentialsRateLimitError(0.4)).toBe("RATE_LIMITED:1");
    expect(encodeCredentialsRateLimitError(59.6)).toBe("RATE_LIMITED:60");
  });
});

describe("encodeAuthThrottleError / interpretCredentialsSignInResult round trip", () => {
  it("carries the exact retryAfterSeconds authorize() computed through to the UI-facing shape", () => {
    const encoded = encodeAuthThrottleError(10);
    const result = interpretCredentialsSignInResult({ error: encoded, status: 401, ok: false, url: null });

    expect(result).toEqual({ ok: false, error: "AUTH_THROTTLED", retryAfterSeconds: 10 });
  });

  it("rounds and floors non-integer/zero input to at least 1 second", () => {
    expect(encodeAuthThrottleError(0.4)).toBe("AUTH_THROTTLED:1");
    expect(encodeAuthThrottleError(1.6)).toBe("AUTH_THROTTLED:2");
  });

  it("is distinguishable from RATE_LIMITED even though both carry a retryAfterSeconds", () => {
    const rateLimited = interpretCredentialsSignInResult({
      error: encodeCredentialsRateLimitError(30),
      status: 429,
      ok: false,
      url: null,
    });
    const throttled = interpretCredentialsSignInResult({
      error: encodeAuthThrottleError(30),
      status: 401,
      ok: false,
      url: null,
    });

    expect(rateLimited.ok).toBe(false);
    expect(throttled.ok).toBe(false);
    if (!rateLimited.ok) expect(rateLimited.error).toBe("RATE_LIMITED");
    if (!throttled.ok) expect(throttled.error).toBe("AUTH_THROTTLED");
  });
});

describe("interpretCredentialsSignInResult", () => {
  it("treats a successful sign-in (no error) as ok", () => {
    expect(interpretCredentialsSignInResult({ error: null, status: 200, ok: true, url: "/dashboard" })).toEqual({
      ok: true,
    });
  });

  it("passes an ordinary NextAuth error (e.g. wrong password) through unchanged", () => {
    expect(
      interpretCredentialsSignInResult({ error: "CredentialsSignin", status: 401, ok: false, url: null }),
    ).toEqual({ ok: false, error: "CredentialsSignin" });
  });

  it("surfaces the unverified-email error as its own stable code (what authorize() throws), distinct from a wrong password", () => {
    expect(EMAIL_NOT_VERIFIED_ERROR).toBe("EMAIL_NOT_VERIFIED");
    expect(
      interpretCredentialsSignInResult({ error: EMAIL_NOT_VERIFIED_ERROR, status: 401, ok: false, url: null }),
    ).toEqual({ ok: false, error: "EMAIL_NOT_VERIFIED" });
  });

  it("returns a generic failure when signIn() itself resolves undefined", () => {
    const result = interpretCredentialsSignInResult(undefined);
    expect(result.ok).toBe(false);
  });

  it("does not mistake an unrelated error string containing the rate-limit prefix for a real match", () => {
    expect(
      interpretCredentialsSignInResult({ error: "RATE_LIMITED", status: 401, ok: false, url: null }),
    ).toEqual({ ok: false, error: "RATE_LIMITED" });
    expect(
      interpretCredentialsSignInResult({ error: "RATE_LIMITED:abc", status: 401, ok: false, url: null }),
    ).toEqual({ ok: false, error: "RATE_LIMITED:abc" });
  });
});

describe("formatRetryAfter", () => {
  it.each([
    [353, "6 minutes"],
    [120, "2 minutes"],
    [61, "2 minutes"],
    [60, "1 minute"],
    [45, "less than a minute"],
    [0, "less than a minute"],
    [-5, "less than a minute"],
  ])("%i seconds -> %s", (seconds, expected) => {
    expect(formatRetryAfter(seconds)).toBe(expected);
  });
});
