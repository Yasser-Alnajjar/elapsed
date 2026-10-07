import { afterEach, describe, expect, it, vi } from "vitest";
import { canonicalUrl, getSiteOrigin, resolveSiteOrigin } from "../src/lib/seo/site";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveSiteOrigin", () => {
  it.each([
    ["https://app.elapsedhq.io", "https://app.elapsedhq.io"],
    ["https://app.elapsedhq.io/", "https://app.elapsedhq.io"],
    ["https://app.elapsedhq.io/dashboard?x=1#top", "https://app.elapsedhq.io"],
    ["https://elapsedhq.io:8443", "https://elapsedhq.io:8443"],
    ["https://WWW.ElapsedHQ.io", "https://www.elapsedhq.io"],
  ])("accepts the public origin %s", (raw, origin) => {
    expect(resolveSiteOrigin(raw)).toBe(origin);
  });

  it.each([
    // The deployment values this repo actually ships with.
    ["http://localhost:3000", "dev server / Docker build placeholder"],
    ["https://localhost", "docker-compose.dev nginx"],
    ["https://13.62.74.24", "the production server's bare IP"],
    ["https://outsmart-module-sensation.ngrok-free.dev", "dev tunnel"],
    ["https://sla.example.com", ".env.prod.example placeholder"],
    // Everything else that can never be a public domain.
    ["http://app.elapsedhq.io", "plain http"],
    ["https://127.0.0.1:3000", "loopback IP"],
    ["https://192.168.1.46", "LAN IP"],
    ["https://[::1]", "IPv6 loopback"],
    ["https://2130706433", "decimal IP, normalized to 127.0.0.1"],
    ["https://web", "bare internal service name"],
    ["https://elapsed.local", "mDNS name"],
    ["https://elapsed.internal", "internal TLD"],
    ["https://staging.elapsed.test", "reserved test TLD"],
    ["https://abc.trycloudflare.com", "dev tunnel"],
    ["https://ngrok-free.dev", "tunnel apex"],
    ["not a url", "garbage"],
    ["", "empty"],
  ])("rejects %s (%s)", (raw) => {
    expect(resolveSiteOrigin(raw)).toBeNull();
  });

  it("returns null when NEXTAUTH_URL is unset", () => {
    expect(resolveSiteOrigin(undefined)).toBeNull();
  });

  it("does not treat a look-alike suffix as a reserved one", () => {
    // `mylocal.io` ends in "local" as text but is not under the `.local` TLD.
    expect(resolveSiteOrigin("https://mylocal.io")).toBe("https://mylocal.io");
    expect(resolveSiteOrigin("https://notngrok.io")).toBe("https://notngrok.io");
  });
});

describe("getSiteOrigin", () => {
  it("reads NEXTAUTH_URL at call time, not import time", () => {
    vi.stubEnv("NEXTAUTH_URL", "https://app.elapsedhq.io");
    expect(getSiteOrigin()).toBe("https://app.elapsedhq.io");

    vi.stubEnv("NEXTAUTH_URL", "http://localhost:3000");
    expect(getSiteOrigin()).toBeNull();
  });
});

describe("canonicalUrl", () => {
  it("is the bare origin for the home page and origin + path elsewhere, never with a trailing slash", () => {
    expect(canonicalUrl("https://app.elapsedhq.io", "/")).toBe("https://app.elapsedhq.io");
    expect(canonicalUrl("https://app.elapsedhq.io", "/pricing")).toBe("https://app.elapsedhq.io/pricing");
    expect(canonicalUrl("https://app.elapsedhq.io", "/docs/faq")).toBe("https://app.elapsedhq.io/docs/faq");
  });
});
