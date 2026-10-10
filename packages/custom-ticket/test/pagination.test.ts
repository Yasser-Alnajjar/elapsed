/** "Synchronization" row of plan 09 §13: each pagination type, loop detection, same-origin next links, child-page cap. */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { RunBudget, createSafeHttpClient, type SafeHttpClient } from "@sla/safe-http";
import { ChildTooLargeError, fetchAllItems, fetchPage, type Endpoint } from "../src/fetcher";
import { START, buildRequest, parseLinkNext } from "../src/requests";
import type { PaginationConfig } from "../src/schema";
import { SourceStatusError } from "../src/source-errors";

let server: Server;
let other: Server;
let port = 0;
let otherPort = 0;
let handler: (req: IncomingMessage, res: ServerResponse) => void = (_req, res) => res.end("{}");
const seen: string[] = [];
const otherSeen: string[] = [];
const clients: SafeHttpClient[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    seen.push(req.url ?? "");
    handler(req, res);
  });
  other = createServer((req, res) => {
    otherSeen.push(req.url ?? "");
    res.end("{}");
  });
  await Promise.all([new Promise<void>((r) => server.listen(0, "127.0.0.1", r)), new Promise<void>((r) => other.listen(0, "127.0.0.1", r))]);
  port = (server.address() as AddressInfo).port;
  otherPort = (other.address() as AddressInfo).port;
});
afterAll(async () => {
  await Promise.all(clients.map((c) => c.close()));
  server.closeAllConnections();
  other.closeAllConnections();
  server.close();
  other.close();
});
beforeEach(() => {
  seen.length = 0;
  otherSeen.length = 0;
});

const base = () => `http://127.0.0.1:${port}`;
function newClient(): SafeHttpClient {
  const c = createSafeHttpClient({ baseUrl: base(), destination: { allowPrivateHosts: true }, budget: new RunBudget({ requestsPerSecond: 1000 }), baseBackoffMs: 1 });
  clients.push(c);
  return c;
}
const json = (res: ServerResponse, body: unknown, headers: Record<string, string> = {}, status = 200) => {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
};
const endpoint = (pagination: PaginationConfig, extra: Partial<Endpoint["request"]> = {}): Endpoint => ({
  request: { method: "GET", path: "/v2/tickets", ...extra } as Endpoint["request"],
  itemsPath: "$.data[*]",
  pagination,
});

describe("page-number pagination", () => {
  it("walks pages from startAt and stops on a short page", async () => {
    handler = (req, res) => {
      const page = Number(new URL(req.url!, base()).searchParams.get("page"));
      json(res, { data: page < 3 ? [{ id: page * 10 }, { id: page * 10 + 1 }] : [{ id: 99 }] });
    };
    const pagination: PaginationConfig = { type: "page", param: "page", startAt: 1, pageSize: 2, in: "query" } as PaginationConfig;
    const all = await fetchAllItems(newClient(), endpoint(pagination), {});
    expect(all).toEqual([{ id: 10 }, { id: 11 }, { id: 20 }, { id: 21 }, { id: 99 }]);
    expect(seen.map((u) => new URL(u, base()).searchParams.get("page"))).toEqual(["1", "2", "3"]);
  });

  it("an empty page ends the listing", async () => {
    handler = (_req, res) => json(res, { data: [] });
    const page = await fetchPage(newClient(), endpoint({ type: "page", param: "p", startAt: 0, pageSize: 5, in: "query" } as PaginationConfig), START, {});
    expect(page.items).toEqual([]);
    expect(page.next).toBeNull();
  });
});

describe("offset pagination", () => {
  it("advances the offset by the items received", async () => {
    handler = (req, res) => {
      const offset = Number(new URL(req.url!, base()).searchParams.get("offset"));
      json(res, { data: offset === 0 ? [1, 2] : offset === 2 ? [3, 4] : [5] });
    };
    const pagination = { type: "offset", offsetParam: "offset", limitParam: "limit", pageSize: 2, in: "query" } as PaginationConfig;
    expect(await fetchAllItems(newClient(), endpoint(pagination), {})).toEqual([1, 2, 3, 4, 5]);
    expect(seen.map((u) => new URL(u, base()).searchParams.get("offset"))).toEqual(["0", "2", "4"]);
  });
});

describe("cursor pagination: resume position and loop detection", () => {
  const pagination = { type: "cursor", cursorPath: "$.meta.next", param: "cursor", pageSize: 2, sizeParam: "per_page", in: "query" } as PaginationConfig;

  it("follows the cursor and stops when it is absent, null or empty", async () => {
    handler = (req, res) => {
      const c = new URL(req.url!, base()).searchParams.get("cursor");
      if (c === null) json(res, { data: [1, 2], meta: { next: "abc" } });
      else if (c === "abc") json(res, { data: [3, 4], meta: { next: 7 } });
      else json(res, { data: [5], meta: { next: null } });
    };
    expect(await fetchAllItems(newClient(), endpoint(pagination), {})).toEqual([1, 2, 3, 4, 5]);
    expect(seen.map((u) => new URL(u, base()).searchParams.get("cursor"))).toEqual([null, "abc", "7"]);
  });

  it("can resume from a persisted position (the cursor) without refetching earlier pages", async () => {
    handler = (_req, res) => json(res, { data: [9], meta: { next: null } });
    await fetchPage(newClient(), endpoint(pagination), { kind: "cursor", cursor: "resume-here" }, {});
    expect(new URL(seen[0]!, base()).searchParams.get("cursor")).toBe("resume-here");
    expect(seen).toHaveLength(1);
  });

  it("a cursor that repeats is a loop: bad_response, not an endless fetch", async () => {
    handler = (_req, res) => json(res, { data: [1], meta: { next: "same" } });
    const client = newClient();
    const first = await fetchPage(client, endpoint(pagination), START, {});
    expect(first.next).toEqual({ kind: "cursor", cursor: "same" });
    await expect(fetchPage(client, endpoint(pagination), first.next!, {})).rejects.toMatchObject({ code: "bad_response" });
  });

  it("an object cursor, an overlong cursor and an empty page with a cursor are handled safely", async () => {
    const client = newClient();
    handler = (_req, res) => json(res, { data: [1], meta: { next: { x: 1 } } });
    await expect(fetchPage(client, endpoint(pagination), START, {})).rejects.toMatchObject({ code: "bad_response" });
    handler = (_req, res) => json(res, { data: [1], meta: { next: "x".repeat(3000) } });
    await expect(fetchPage(client, endpoint(pagination), START, {})).rejects.toMatchObject({ code: "bad_response" });
    handler = (_req, res) => json(res, { data: [], meta: { next: "more" } });
    expect((await fetchPage(client, endpoint(pagination), START, {})).next).toBeNull();
  });
});

describe("next_url and Link-header pagination: same origin only", () => {
  const nextUrl = { type: "next_url", nextPath: "$.links.next" } as PaginationConfig;
  const link = { type: "link_header" } as PaginationConfig;

  it("follows a relative and an absolute same-origin next URL", async () => {
    handler = (req, res) => {
      if (req.url!.startsWith("/v2/tickets?page=2")) json(res, { data: [2], links: { next: `${base()}/v2/tickets?page=3` } });
      else if (req.url!.startsWith("/v2/tickets?page=3")) json(res, { data: [3], links: { next: null } });
      else json(res, { data: [1], links: { next: "/v2/tickets?page=2" } });
    };
    expect(await fetchAllItems(newClient(), endpoint(nextUrl), {})).toEqual([1, 2, 3]);
    expect(seen).toEqual(["/v2/tickets", "/v2/tickets?page=2", "/v2/tickets?page=3"]);
  });

  it("refuses a cross-origin next URL (and sends nothing there), including userinfo, another port and another scheme", async () => {
    for (const target of [`http://127.0.0.1:${otherPort}/steal`, `http://user:pw@127.0.0.1:${port}/x`, `https://127.0.0.1:${port}/x`, "http://localhost/x"]) {
      handler = (_req, res) => json(res, { data: [1], links: { next: target } });
      await expect(fetchPage(newClient(), endpoint(nextUrl), START, {}), target).rejects.toMatchObject({ code: "invalid_request" });
    }
    expect(otherSeen).toEqual([]);
  });

  it("refuses a cross-origin Link header the same way", async () => {
    handler = (_req, res) => json(res, { data: [1] }, { link: `<http://127.0.0.1:${otherPort}/steal>; rel="next"` });
    await expect(fetchPage(newClient(), endpoint(link), START, {})).rejects.toMatchObject({ code: "invalid_request" });
    expect(otherSeen).toEqual([]);
  });

  it("a next URL equal to the current URL is a loop", async () => {
    handler = (req, res) => json(res, { data: [1], links: { next: `${base()}${req.url}` } });
    await expect(fetchPage(newClient(), endpoint(nextUrl), START, {})).rejects.toMatchObject({ code: "bad_response" });
  });

  it("parses Link headers: rel=next among several, quoted and unquoted, and ignores prev/last", () => {
    expect(parseLinkNext('<https://a/x?p=2>; rel="next", <https://a/x?p=9>; rel="last"')).toBe("https://a/x?p=2");
    expect(parseLinkNext('<https://a/x?p=1>; rel="prev", <https://a/x?p=3>; rel=next')).toBe("https://a/x?p=3");
    expect(parseLinkNext('<https://a/x?p=1>; rel="prev"')).toBeNull();
    expect(parseLinkNext('<https://a/x>; rel="next last"')).toBe("https://a/x");
    expect(parseLinkNext(undefined)).toBeNull();
    expect(parseLinkNext("garbage")).toBeNull();
  });
});

describe("request building: variables never change the destination", () => {
  const origin = () => newClient().origin;

  it("URL-encodes a ticket id placed in a path segment and omits a lone unset query variable", () => {
    const req = buildRequest(
      { method: "GET", path: "/v2/tickets/{{ticket.id}}/comments", query: { since: "{{updatedSince}}", fixed: "x" } } as Endpoint["request"],
      { type: "none" } as PaginationConfig,
      START,
      { "ticket.id": "T 1&x=1" },
      origin(),
    );
    const url = new URL(typeof req.url === "string" ? req.url : req.url.toString());
    expect(url.host).toBe(`127.0.0.1:${port}`);
    expect(url.pathname).toBe("/v2/tickets/T%201%26x%3D1/comments");
    expect(url.searchParams.has("since")).toBe(false);
    expect(url.searchParams.get("fixed")).toBe("x");
  });

  it.each(["../../admin", "a/b", "..", "@evil.com", "evil.com:80", "x\r\nHost: evil.com"])("a ticket id of %j can neither leave the origin nor inject a header", (id) => {
    let built: ReturnType<typeof buildRequest> | undefined;
    let failed = false;
    try {
      built = buildRequest({ method: "GET", path: "/v2/tickets/{{ticket.id}}" } as Endpoint["request"], { type: "none" } as PaginationConfig, START, { "ticket.id": id }, origin());
    } catch {
      failed = true; // refusing is acceptable
    }
    if (!failed) {
      const url = new URL(typeof built!.url === "string" ? built!.url : built!.url.toString());
      expect(url.host).toBe(`127.0.0.1:${port}`);
      expect(url.protocol).toBe("http:");
      expect(url.pathname.startsWith("/v2/tickets/")).toBe(true);
    }
  });

  it("substitutes variables into a JSON body as typed values, not as structure", () => {
    const req = buildRequest(
      { method: "POST", path: "/search", body: { q: "{{updatedSince}}", n: "{{limit}}", nested: ["{{cursor}}"] } } as Endpoint["request"],
      { type: "none" } as PaginationConfig,
      START,
      { updatedSince: '2026-01-01","admin":true,"x":"', limit: 5 },
      origin(),
    );
    const body = JSON.parse(req.body!);
    expect(body.q).toBe('2026-01-01","admin":true,"x":"');
    expect(body.admin).toBeUndefined();
    expect(body.n).toBe(5);
    expect(req.method).toBe("POST");
  });
});

describe("child endpoints and status handling", () => {
  it("a child endpoint with more pages than the cap is ChildTooLargeError, never a silent cut", async () => {
    handler = (_req, res) => json(res, { data: [1], meta: { next: String(Math.random()) } });
    const pagination = { type: "cursor", cursorPath: "$.meta.next", param: "cursor", pageSize: 1, in: "query" } as PaginationConfig;
    await expect(fetchAllItems(newClient(), endpoint(pagination), {})).rejects.toBeInstanceOf(ChildTooLargeError);
    expect(seen.length).toBe(10);
  });

  it("a non-2xx status is a SourceStatusError carrying only the status, and a 204 is an empty page", async () => {
    handler = (_req, res) => json(res, { error: "nope" }, {}, 403);
    await expect(fetchPage(newClient(), endpoint({ type: "none" } as PaginationConfig), START, {})).rejects.toBeInstanceOf(SourceStatusError);
    handler = (_req, res) => {
      res.writeHead(204);
      res.end();
    };
    const empty = await fetchPage(newClient(), endpoint({ type: "none" } as PaginationConfig), START, {});
    expect(empty.items).toEqual([]);
    expect(empty.next).toBeNull();
  });

  it("a page that is not JSON is bad_response", async () => {
    handler = (_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html></html>");
    };
    await expect(fetchPage(newClient(), endpoint({ type: "none" } as PaginationConfig), START, {})).rejects.toMatchObject({ code: "bad_response" });
  });
});
