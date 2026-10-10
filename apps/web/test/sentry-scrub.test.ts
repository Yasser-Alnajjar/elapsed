import type { ErrorEvent } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";
import { scrubSensitiveQuery, scrubSentryBreadcrumb, scrubSentryEvent } from "../src/lib/sentry-scrub";

describe("scrubSensitiveQuery", () => {
  it("filters the Jira webhook secret in a full URL", () => {
    expect(scrubSensitiveQuery("https://app.example.com/api/webhooks/jira/int-1?secret=abc123")).toBe(
      "https://app.example.com/api/webhooks/jira/int-1?secret=[Filtered]",
    );
  });

  it("leaves other parameters and fragments untouched", () => {
    expect(scrubSensitiveQuery("/x?a=1&Secret=abc&b=2#frag")).toBe("/x?a=1&Secret=[Filtered]&b=2#frag");
    expect(scrubSensitiveQuery("/x?secretive=1")).toBe("/x?secretive=1");
    expect(scrubSensitiveQuery("/x")).toBe("/x");
  });

  it("handles a bare query string and a percent-encoded key", () => {
    expect(scrubSensitiveQuery("secret=abc&page=2")).toBe("secret=[Filtered]&page=2");
    expect(scrubSensitiveQuery("?%73ecret=abc")).toBe("?%73ecret=[Filtered]");
  });
});

describe("scrubSentryEvent", () => {
  it("scrubs the request URL, every query_string shape, and breadcrumbs", () => {
    const url = "https://app.example.com/api/webhooks/jira/int-1?secret=abc123";
    for (const query_string of ["secret=abc123", { secret: "abc123" }, [["secret", "abc123"]] as [string, string][]]) {
      const event = scrubSentryEvent({
        type: undefined,
        request: { url, query_string },
        breadcrumbs: [{ category: "http", data: { url } }],
      } as ErrorEvent);
      const serialized = JSON.stringify(event);
      expect(serialized).not.toContain("abc123");
      expect(event.request?.url).toBe("https://app.example.com/api/webhooks/jira/int-1?secret=[REDACTED]");
    }
  });

  it("passes an event without request data through", () => {
    const event = { type: undefined, message: "boom" } as ErrorEvent;
    expect(scrubSentryEvent(event)).toEqual(event);
  });
});

describe("scrubSentryBreadcrumb", () => {
  it("scrubs navigation-style to/from fields", () => {
    expect(scrubSentryBreadcrumb({ data: { from: "/a?secret=x", to: "/b" } }).data).toEqual({
      from: "/a?secret=[REDACTED]",
      to: "/b",
    });
  });
});
