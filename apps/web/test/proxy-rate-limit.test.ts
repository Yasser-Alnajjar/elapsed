import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth/jwt", () => ({ getToken: vi.fn(async () => null) }));

const { _resetRateLimitState } = await import("../src/lib/rate-limit");
const { proxy } = await import("../src/proxy");

function credentialsRequest(ip: string) {
  return new NextRequest("https://app.example.com/api/auth/callback/credentials", {
    method: "POST",
    headers: { "x-forwarded-for": ip },
  });
}

beforeEach(() => {
  _resetRateLimitState();
});

describe("proxy rate limiting — /api/auth/callback/credentials", () => {
  it("can't be bypassed by rotating a client-supplied X-Forwarded-For entry", async () => {
    // Behind a proxy that appends the real peer, the client's own value sits to its left.
    const spoofed = (n: number) =>
      new NextRequest("https://app.example.com/api/auth/callback/credentials", {
        method: "POST",
        headers: { "x-forwarded-for": `198.51.100.${n}, 203.0.113.50` },
      });
    const statuses: number[] = [];
    for (let n = 1; n <= 11; n += 1) statuses.push((await proxy(spoofed(n))).status);
    expect(statuses.slice(0, 10).every((status) => status !== 429)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it("allows the first 10 requests from one IP within the window and 429s the 11th", async () => {
    for (let i = 0; i < 10; i += 1) {
      const response = await proxy(credentialsRequest("203.0.113.1"));
      // NextAuth's own route handler runs for these — not intercepted by the rate
      // limiter — so nothing about their response is asserted here beyond "not 429".
      expect(response?.status).not.toBe(429);
    }

    const blocked = await proxy(credentialsRequest("203.0.113.1"));
    expect(blocked.status).toBe(429);
  });

  it("sets a Retry-After header with a positive integer number of seconds", async () => {
    for (let i = 0; i < 10; i += 1) {
      await proxy(credentialsRequest("203.0.113.2"));
    }
    const blocked = await proxy(credentialsRequest("203.0.113.2"));

    const retryAfter = Number(blocked.headers.get("Retry-After"));
    expect(Number.isInteger(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThan(0);
  });

  it("responds with a `url` field whose error query param carries the RATE_LIMITED sentinel and the Retry-After seconds — the shape next-auth/react's signIn() needs to avoid its own 'Invalid URL' crash", async () => {
    for (let i = 0; i < 10; i += 1) {
      await proxy(credentialsRequest("203.0.113.3"));
    }
    const blocked = await proxy(credentialsRequest("203.0.113.3"));
    const retryAfter = Number(blocked.headers.get("Retry-After"));

    const body = await blocked.json();
    expect(typeof body.url).toBe("string");

    const error = new URL(body.url).searchParams.get("error");
    expect(error).toBe(`RATE_LIMITED:${retryAfter}`);
  });

  it("never leaks the raw 429 status or NextAuth internals in the body — only the encoded url", async () => {
    for (let i = 0; i < 10; i += 1) {
      await proxy(credentialsRequest("203.0.113.4"));
    }
    const blocked = await proxy(credentialsRequest("203.0.113.4"));
    const body = await blocked.json();

    expect(Object.keys(body)).toEqual(["url"]);
  });

  it("keys the limit per IP — a different address is unaffected", async () => {
    for (let i = 0; i < 10; i += 1) {
      await proxy(credentialsRequest("203.0.113.5"));
    }
    await proxy(credentialsRequest("203.0.113.5")); // now blocked

    const otherIp = await proxy(credentialsRequest("203.0.113.6"));
    expect(otherIp.status).not.toBe(429);
  });
});

describe("proxy rate limiting — /api/webhooks keyed by integrationId, not IP (roadmap task 2.5)", () => {
  function webhookRequest(provider: string, integrationId: string, ip: string) {
    return new NextRequest(`https://app.example.com/api/webhooks/${provider}/${integrationId}`, {
      method: "POST",
      headers: { "x-forwarded-for": ip },
    });
  }

  it("two different integrationIds from the same IP get independent buckets", async () => {
    for (let i = 0; i < 60; i += 1) {
      const response = await proxy(webhookRequest("zendesk", "int-a", "203.0.113.20"));
      expect(response?.status).not.toBe(429);
    }
    const blockedA = await proxy(webhookRequest("zendesk", "int-a", "203.0.113.20"));
    expect(blockedA.status).toBe(429);

    // Different integration, same IP, same request volume — unaffected.
    const unaffectedB = await proxy(webhookRequest("zendesk", "int-b", "203.0.113.20"));
    expect(unaffectedB.status).not.toBe(429);
  });

  it("the same integrationId from different IPs shares one bucket", async () => {
    for (let i = 0; i < 30; i += 1) {
      const response = await proxy(webhookRequest("jira", "int-c", "203.0.113.30"));
      expect(response?.status).not.toBe(429);
    }
    for (let i = 0; i < 30; i += 1) {
      const response = await proxy(webhookRequest("jira", "int-c", "203.0.113.31"));
      expect(response?.status).not.toBe(429);
    }
    // 60 requests already spent across the two IPs — the 61st, from either, is blocked.
    const blocked = await proxy(webhookRequest("jira", "int-c", "203.0.113.30"));
    expect(blocked.status).toBe(429);
  });

  it("falls back to IP-keying when the path doesn't match the /api/webhooks/{provider}/{id} shape", async () => {
    const malformed = () =>
      new NextRequest("https://app.example.com/api/webhooks", {
        method: "POST",
        headers: { "x-forwarded-for": "203.0.113.40" },
      });
    for (let i = 0; i < 60; i += 1) {
      const response = await proxy(malformed());
      expect(response?.status).not.toBe(429);
    }
    const blocked = await proxy(malformed());
    expect(blocked.status).toBe(429);
  });
});

describe("proxy rate limiting — other routes keep the plain error body", () => {
  it("/api/sign-up still returns a plain { error } body on 429, not the url-bridge shape", async () => {
    const request = () =>
      new NextRequest("https://app.example.com/api/sign-up", {
        method: "POST",
        headers: { "x-forwarded-for": "203.0.113.10" },
      });

    for (let i = 0; i < 5; i += 1) {
      await proxy(request());
    }
    const blocked = await proxy(request());

    expect(blocked.status).toBe(429);
    const body = await blocked.json();
    expect(body).toEqual({ error: "Too many requests" });
    expect(blocked.headers.get("Retry-After")).toBeTruthy();
  });

  it("/api/email-verification/resend is reachable without a session, and is capped at 5 per IP per window", async () => {
    const request = (ip: string) =>
      new NextRequest("https://app.example.com/api/email-verification/resend", {
        method: "POST",
        // A same-origin browser POST: the proxy's CSRF check (which runs before the route) must pass.
        headers: { "x-forwarded-for": ip, origin: "https://app.example.com", host: "app.example.com" },
      });

    for (let i = 0; i < 5; i += 1) {
      const response = await proxy(request("203.0.113.11"));
      // Passed through to the route (public path: no 401 redirect/JSON) — not blocked by anything in the proxy.
      expect(response.status).toBe(200);
      expect(response.headers.get("x-middleware-next")).toBe("1");
    }
    const blocked = await proxy(request("203.0.113.11"));

    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: "Too many requests" });
    expect(blocked.headers.get("Retry-After")).toBeTruthy();

    // Another IP is unaffected.
    expect((await proxy(request("203.0.113.12"))).status).toBe(200);
  });
});
