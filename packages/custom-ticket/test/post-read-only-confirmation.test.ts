/**
 * The owner's confirmation that a POST is a read-only search (plan 09 §6.2, §8.3):
 * required at validation, and again wherever a request is built, so a
 * configuration that has not been through full validation (test, sample,
 * preview) can never send an unconfirmed POST.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { RunBudget, SafeHttpError, createSafeHttpClient, type SafeHttpClient } from "@sla/safe-http";
import { fetchPage, type Endpoint } from "../src/fetcher";
import { START, buildRequest } from "../src/requests";
import { parseConfig, type CustomConfig, type PaginationConfig } from "../src/schema";
import { unconfirmedPostEndpoints, validateConfig } from "../src/validate";

const mock = JSON.parse(readFileSync(fileURLToPath(new URL("../dev/mock-helpdesk-config.json", import.meta.url)), "utf8"));

function cfg(patch: (c: Record<string, any>) => void = () => {}): CustomConfig {
  const draft = structuredClone(mock) as Record<string, any>;
  patch(draft);
  const parsed = parseConfig(draft);
  if (!parsed.ok) throw new Error(`config invalid: ${JSON.stringify(parsed.issues)}`);
  return parsed.config;
}
const withPost = (extra: Record<string, unknown>) => (c: Record<string, any>) => {
  c.tickets.request = { method: "POST", path: "/v2/search", body: { q: "{{updatedSince}}" }, ...extra };
  c.tickets.incremental = { format: "iso8601", lookbackSeconds: 300 };
};
const errorCodes = (config: CustomConfig) =>
  validateConfig(config, { allowPrivateHosts: true }).diagnostics.filter((d) => d.severity === "error").map((d) => d.code);

let server: Server;
let port = 0;
const seen: { method?: string; url?: string }[] = [];
const clients: SafeHttpClient[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    seen.push({ method: req.method, url: req.url });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: [{ id: 1 }] }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});
afterAll(async () => {
  await Promise.all(clients.map((c) => c.close()));
  server.closeAllConnections();
  server.close();
});
beforeEach(() => {
  seen.length = 0;
});

function newClient(): SafeHttpClient {
  const c = createSafeHttpClient({ baseUrl: `http://127.0.0.1:${port}`, destination: { allowPrivateHosts: true }, budget: new RunBudget({ requestsPerSecond: 1000 }), baseBackoffMs: 1 });
  clients.push(c);
  return c;
}
const none = { type: "none" } as PaginationConfig;
const endpoint = (request: Record<string, unknown>): Endpoint => ({ request: request as Endpoint["request"], itemsPath: "$.data[*]", pagination: none });

describe("configuration validation", () => {
  it("rejects a POST without the confirmation and accepts it with the confirmation", () => {
    expect(errorCodes(cfg(withPost({})))).toContain("post_requires_read_only_designation");
    expect(errorCodes(cfg(withPost({ readOnlySearch: true })))).not.toContain("post_requires_read_only_designation");
  });

  it("only the literal true counts as a confirmation", () => {
    const parsed = parseConfig(
      (() => {
        const draft = structuredClone(mock) as Record<string, any>;
        withPost({ readOnlySearch: false })(draft);
        return draft;
      })(),
    );
    expect(parsed.ok).toBe(false);
  });

  it("a GET is unchanged: valid without a confirmation, and it may not carry one", () => {
    expect(errorCodes(cfg())).toEqual([]);
    expect(errorCodes(cfg((c) => (c.tickets.request.readOnlySearch = true)))).toContain("read_only_designation_on_get");
  });

  it("switching a confirmed POST back to GET and again to POST needs a new confirmation", () => {
    const confirmed = cfg(withPost({ readOnlySearch: true }));
    const switchedBack = { ...confirmed.tickets.request, method: "GET" as const };
    delete (switchedBack as Record<string, unknown>).body;
    delete (switchedBack as Record<string, unknown>).readOnlySearch;
    const again = { ...switchedBack, method: "POST" as const, body: { q: "x" } };
    expect(again.readOnlySearch).toBeUndefined();
    expect(unconfirmedPostEndpoints({ ...confirmed, tickets: { ...confirmed.tickets, request: again } } as CustomConfig)).toEqual(["tickets.request"]);
  });
});

describe("unconfirmedPostEndpoints (the outbound checks' pre-flight)", () => {
  it("is empty for GET and for a confirmed POST", () => {
    expect(unconfirmedPostEndpoints(cfg())).toEqual([]);
    expect(unconfirmedPostEndpoints(cfg(withPost({ readOnlySearch: true })))).toEqual([]);
  });

  it("names every endpoint whose POST is unconfirmed", () => {
    expect(unconfirmedPostEndpoints(cfg(withPost({})))).toEqual(["tickets.request"]);
    const comments = cfg((c) => {
      c.comments = { ...(c.comments ?? {}), request: { method: "POST", path: "/tickets/{{ticket.id}}/comments", body: {} } };
    });
    expect(unconfirmedPostEndpoints(comments)).toContain("comments.request");
  });
});

describe("request time", () => {
  it("buildRequest refuses an unconfirmed POST and builds a confirmed POST and a GET as before", () => {
    const origin = newClient().origin;
    expect(() => buildRequest({ method: "POST", path: "/v2/search", body: {} } as Endpoint["request"], none, START, {}, origin)).toThrow(SafeHttpError);
    const post = buildRequest({ method: "POST", path: "/v2/search", body: { q: "x" }, readOnlySearch: true } as Endpoint["request"], none, START, {}, origin);
    expect(post.method).toBe("POST");
    expect(post.body).toBe(JSON.stringify({ q: "x" }));
    const get = buildRequest({ method: "GET", path: "/v2/tickets" } as Endpoint["request"], none, START, {}, origin);
    expect(get.method).toBe("GET");
    expect(get.body).toBeUndefined();
  });

  it("sends nothing to the customer's API for an unconfirmed POST, and sends a confirmed POST and a GET", async () => {
    await expect(fetchPage(newClient(), endpoint({ method: "POST", path: "/v2/search", body: { q: "x" } }), START, {})).rejects.toBeInstanceOf(SafeHttpError);
    expect(seen).toEqual([]);

    await fetchPage(newClient(), endpoint({ method: "POST", path: "/v2/search", body: { q: "x" }, readOnlySearch: true }), START, {});
    await fetchPage(newClient(), endpoint({ method: "GET", path: "/v2/tickets" }), START, {});
    expect(seen.map((r) => r.method)).toEqual(["POST", "GET"]);
  });
});
