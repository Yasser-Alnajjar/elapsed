import { execFileSync } from "node:child_process";
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { RunBudget } from "../src/budget";
import { createSafeHttpClient, type SafeHttpClient, type SafeHttpClientOptions } from "../src/client";
import { SafeHttpError } from "../src/errors";

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

interface Fixture {
  server: Server;
  port: number;
  hits: { method: string; url: string; headers: IncomingMessage["headers"]; body: string }[];
  setHandler(handler: Handler): void;
  close(): Promise<void>;
}

async function listen(create: (listener: Handler) => Server): Promise<Fixture> {
  let handler: Handler = (_req, res) => res.end("{}");
  const hits: Fixture["hits"] = [];
  const server = create((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => {
      hits.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers, body: Buffer.concat(chunks).toString("utf8") });
      handler(req, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    server,
    port: (server.address() as AddressInfo).port,
    hits,
    setHandler: (h) => {
      handler = h;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

const json = (res: ServerResponse, body: unknown, status = 200, headers: Record<string, string> = {}) => {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
};

function codeOf(error: unknown): string {
  return error instanceof SafeHttpError ? error.code : `other:${String(error)}`;
}

async function failure(promise: Promise<unknown>): Promise<SafeHttpError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof SafeHttpError) return error;
    throw error;
  }
  throw new Error("expected the request to fail");
}

/** An instant budget: sleeping advances a fake clock, so back-off never really waits. */
function fastBudget(overrides: ConstructorParameters<typeof RunBudget>[0] = {}) {
  return new RunBudget({ totalMs: 120_000, requestsPerSecond: 1000, ...overrides });
}

const clients: SafeHttpClient[] = [];
function client(options: Partial<SafeHttpClientOptions> & { baseUrl: string }): SafeHttpClient {
  const c = createSafeHttpClient({ budget: fastBudget(), baseBackoffMs: 1, ...options });
  clients.push(c);
  return c;
}
afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
});

describe("destination policy at connect time (no network is reached)", () => {
  const publicHost = "https://api.example.com";
  const resolveTo = (...addresses: string[]) => async () => addresses;

  it.each([
    ["loopback", "127.0.0.1"],
    ["RFC 1918 10/8", "10.1.2.3"],
    ["RFC 1918 172.16/12", "172.20.0.5"],
    ["RFC 1918 192.168/16", "192.168.1.1"],
    ["link-local", "169.254.1.1"],
    ["cloud metadata IPv4", "169.254.169.254"],
    ["cloud metadata IPv6", "fd00:ec2::254"],
    ["CGNAT", "100.64.0.9"],
    ["IPv6 loopback", "::1"],
    ["IPv4-mapped loopback", "::ffff:127.0.0.1"],
    ["unique-local IPv6", "fc00::5"],
    ["NAT64", "64:ff9b::7f00:1"],
  ])("refuses a name that resolves to %s", async (_label, address) => {
    const c = client({ baseUrl: publicHost, resolve: resolveTo(address) });
    expect((await failure(c.request({ method: "GET", url: `${publicHost}/v2/tickets` }))).code).toBe("blocked_destination");
  });

  it("refuses when ANY resolved record is private (mixed public and private, dual-stack)", async () => {
    for (const records of [
      ["93.184.216.34", "10.0.0.5"],
      ["10.0.0.5", "93.184.216.34"],
      ["2606:4700:4700::1111", "fe80::1"],
      ["93.184.216.34", "2606:4700:4700::1111", "127.0.0.1"],
    ]) {
      const c = client({ baseUrl: publicHost, resolve: resolveTo(...records) });
      expect((await failure(c.request({ method: "GET", url: `${publicHost}/x` }))).code).toBe("blocked_destination");
    }
  });

  it("refuses an empty answer and propagates a DNS failure as unreachable", async () => {
    const empty = client({ baseUrl: publicHost, resolve: async () => [] });
    expect((await failure(empty.request({ method: "GET", url: `${publicHost}/x` }))).code).toBe("blocked_destination");
    const failing = client({
      baseUrl: publicHost,
      resolve: async () => {
        throw Object.assign(new Error("nxdomain"), { code: "ENOTFOUND" });
      },
    });
    expect((await failure(failing.request({ method: "GET", url: `${publicHost}/x` }))).code).toBe("unreachable");
  });

  it("errors carry only a code: no host, address or URL text", async () => {
    const c = client({ baseUrl: publicHost, resolve: resolveTo("10.9.8.7") });
    const error = await failure(c.request({ method: "GET", url: `${publicHost}/v2/tickets?cursor=abc` }));
    expect(error.message).toBe("blocked_destination");
    expect(JSON.stringify({ message: error.message, status: error.status, reason: error.reason })).not.toMatch(/10\.9\.8\.7|api\.example\.com|cursor/);
  });

  it("refuses a literal IP, a metadata name and a private name at construction", () => {
    for (const baseUrl of ["https://127.0.0.1", "https://[::1]", "https://metadata.google.internal", "https://localhost", "http://api.example.com", "https://api.example.com:8443"]) {
      expect(() => createSafeHttpClient({ baseUrl, budget: fastBudget() })).toThrowError(expect.objectContaining({ code: "blocked_destination" }));
    }
  });

  it("re-resolves for every new connection and refuses a name that starts pointing at metadata (rebinding)", async () => {
    const fixture = await listen((l) => createHttpServer(l));
    try {
      fixture.setHandler((_req, res) => json(res, { ok: true }, 200, { connection: "close" }));
      let calls = 0;
      const c = client({
        baseUrl: `http://rebind.example.com:${fixture.port}`,
        destination: { allowPrivateHosts: true },
        resolve: async () => {
          calls += 1;
          return [calls === 1 ? "127.0.0.1" : "169.254.169.254"];
        },
      });
      const first = await c.request({ method: "GET", url: `http://rebind.example.com:${fixture.port}/a` });
      expect(first.status).toBe(200);
      expect((await failure(c.request({ method: "GET", url: `http://rebind.example.com:${fixture.port}/b` }))).code).toBe("blocked_destination");
      expect(calls).toBe(2);
      expect(fixture.hits.map((h) => h.url)).toEqual(["/a"]);
    } finally {
      await fixture.close();
    }
  });

  it("refuses the cloud metadata address even when private hosts are allowed for development", async () => {
    const c = client({ baseUrl: "http://dev.example.com:4010", destination: { allowPrivateHosts: true }, resolve: resolveTo("169.254.169.254") });
    expect((await failure(c.request({ method: "GET", url: "http://dev.example.com:4010/x" }))).code).toBe("blocked_destination");
  });
});

describe("request validation (nothing is sent)", () => {
  let fixture: Fixture;
  beforeAll(async () => {
    fixture = await listen((l) => createHttpServer(l));
  });
  afterAll(async () => {
    await fixture.close();
  });

  const make = (extra: Partial<SafeHttpClientOptions> = {}) =>
    client({ baseUrl: `http://127.0.0.1:${fixture.port}`, destination: { allowPrivateHosts: true }, ...extra });
  const base = () => `http://127.0.0.1:${fixture.port}`;

  it("never sends a request to another origin, so credentials cannot leave the base origin", async () => {
    const other = await listen((l) => createHttpServer(l));
    try {
      const c = make({ headers: { "x-api-key": "sentinel-secret" } });
      for (const url of [`http://127.0.0.1:${other.port}/steal`, `http://localhost:${fixture.port}/x`, `https://127.0.0.1:${fixture.port}/x`, `http://user:pw@127.0.0.1:${fixture.port}/x`]) {
        expect((await failure(c.request({ method: "GET", url }))).code).toBe("invalid_request");
      }
      expect(other.hits).toHaveLength(0);
    } finally {
      await other.close();
    }
  });

  it("refuses a secret value placed in a query string, a fragment, GET with a body, other methods and CRLF headers", async () => {
    const before = fixture.hits.length;
    const c = make({ secretValues: ["sentinel-secret", ""] });
    const cases: { label: string; req: Parameters<SafeHttpClient["request"]>[0] }[] = [
      { label: "secret in query", req: { method: "GET", url: `${base()}/x?token=sentinel-secret` } },
      { label: "fragment", req: { method: "GET", url: `${base()}/x#frag` } },
      { label: "GET with body", req: { method: "GET", url: `${base()}/x`, body: "{}" } },
      { label: "PUT", req: { method: "PUT" as "GET", url: `${base()}/x` } },
      { label: "DELETE", req: { method: "DELETE" as "GET", url: `${base()}/x` } },
      { label: "CRLF header injection", req: { method: "GET", url: `${base()}/x`, headers: { "x-a": "1\r\nX-Injected: yes" } } },
      { label: "Host override", req: { method: "GET", url: `${base()}/x`, headers: { Host: "evil.com" } } },
      { label: "forwarded header", req: { method: "GET", url: `${base()}/x`, headers: { "X-Forwarded-For": "1.2.3.4" } } },
    ];
    for (const { label, req } of cases) {
      expect((await failure(c.request(req))).code, label).toBe("invalid_request");
    }
    expect(fixture.hits.length).toBe(before);
  });

  it("refuses CRLF in the client's default headers at construction", () => {
    expect(() => make({ headers: { "x-api-key": "a\r\nb" } })).toThrowError(expect.objectContaining({ code: "invalid_request" }));
  });

  it("sends GET and POST as designated, with identity encoding the caller cannot override", async () => {
    fixture.setHandler((_req, res) => json(res, { ok: true }));
    const c = make({ headers: { "x-api-key": "k1" } });
    const get = await c.request({ method: "GET", url: `${base()}/v2/t?a=1`, headers: { "accept-encoding": "gzip", "x-extra": "e" } });
    expect(get.status).toBe(200);
    expect(get.json()).toEqual({ ok: true });
    const post = await c.request({ method: "POST", url: `${base()}/v2/search`, body: '{"q":1}' });
    expect(post.status).toBe(200);
    const [g, p] = fixture.hits.slice(-2);
    expect(g!.method).toBe("GET");
    expect(g!.headers["accept-encoding"]).toBe("identity");
    expect(g!.headers["x-api-key"]).toBe("k1");
    expect(g!.headers["x-extra"]).toBe("e");
    expect(p!.method).toBe("POST");
    expect(p!.headers["content-type"]).toBe("application/json");
    expect(p!.body).toBe('{"q":1}');
  });
});

describe("responses: redirects, size, encoding, status handling", () => {
  let fixture: Fixture;
  let target: Fixture;
  beforeAll(async () => {
    fixture = await listen((l) => createHttpServer(l));
    target = await listen((l) => createHttpServer(l));
  });
  afterAll(async () => {
    await fixture.close();
    await target.close();
  });
  const make = (extra: Partial<SafeHttpClientOptions> = {}) =>
    client({ baseUrl: `http://127.0.0.1:${fixture.port}`, destination: { allowPrivateHosts: true }, ...extra });
  const url = (path = "/x") => `http://127.0.0.1:${fixture.port}${path}`;

  it.each([301, 302, 303, 307, 308])("never follows a %s redirect, and sends nothing to the target", async (status) => {
    const before = target.hits.length;
    fixture.setHandler((_req, res) => {
      res.writeHead(status, { location: `http://127.0.0.1:${target.port}/landing` });
      res.end();
    });
    const error = await failure(make().request({ method: "GET", url: url() }));
    expect(error.code).toBe("redirect");
    expect(error.status).toBe(status);
    expect(target.hits.length).toBe(before);
  });

  it("does not follow a redirect loop: exactly one request is made", async () => {
    const start = fixture.hits.length;
    fixture.setHandler((req, res) => {
      res.writeHead(302, { location: `http://127.0.0.1:${fixture.port}${req.url}` });
      res.end();
    });
    expect((await failure(make().request({ method: "GET", url: url("/loop") }))).code).toBe("redirect");
    expect(fixture.hits.length - start).toBe(1);
  });

  it("ignores a Link header and a cross-origin next URL inside the body (callers must pass them through assertSameOrigin)", async () => {
    fixture.setHandler((_req, res) => json(res, { meta: { next: `http://127.0.0.1:${target.port}/evil` } }, 200, { link: `<http://127.0.0.1:${target.port}/evil>; rel="next"` }));
    const before = target.hits.length;
    const response = await make().request({ method: "GET", url: url() });
    expect(response.headers.link).toContain("rel=\"next\"");
    expect(target.hits.length).toBe(before);
    const next = (response.json() as { meta: { next: string } }).meta.next;
    expect((await failure(make().request({ method: "GET", url: next }))).code).toBe("invalid_request");
    expect(target.hits.length).toBe(before);
  });

  it("refuses a declared content-length above the cap, and a streamed body that grows past it", async () => {
    fixture.setHandler((_req, res) => {
      res.writeHead(200, { "content-type": "application/json", "content-length": "5000" });
      res.end("x".repeat(5000));
    });
    expect((await failure(make({ maxResponseBytes: 1000 }).request({ method: "GET", url: url() }))).code).toBe("response_too_large");
    fixture.setHandler((_req, res) => {
      res.writeHead(200, { "content-type": "application/json", "transfer-encoding": "chunked" });
      res.write("[");
      res.write("1,".repeat(2000));
      res.end("1]");
    });
    expect((await failure(make({ maxResponseBytes: 1000 }).request({ method: "GET", url: url() }))).code).toBe("response_too_large");
  });

  it("accepts a body exactly at the cap", async () => {
    const body = JSON.stringify({ pad: "a".repeat(100) });
    fixture.setHandler((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(body);
    });
    const response = await make({ maxResponseBytes: Buffer.byteLength(body) }).request({ method: "GET", url: url() });
    expect(response.text).toBe(body);
  });

  it("stops the run when the per-run byte cap is exceeded", async () => {
    fixture.setHandler((_req, res) => json(res, { pad: "a".repeat(400) }));
    const c = make({ budget: fastBudget({ maxBytes: 600 }) });
    await c.request({ method: "GET", url: url() });
    expect((await failure(c.request({ method: "GET", url: url() }))).code).toBe("run_cap_reached");
  });

  it("refuses a compressed response instead of expanding it (decompression cap)", async () => {
    fixture.setHandler((_req, res) => {
      res.writeHead(200, { "content-type": "application/json", "content-encoding": "gzip" });
      res.end(Buffer.from("1f8b0800000000000003ab0000", "hex"));
    });
    expect((await failure(make().request({ method: "GET", url: url() }))).code).toBe("unsupported_encoding");
    for (const encoding of ["br", "deflate", "gzip, br"]) {
      fixture.setHandler((_req, res) => {
        res.writeHead(200, { "content-type": "application/json", "content-encoding": encoding });
        res.end("{}");
      });
      expect((await failure(make().request({ method: "GET", url: url() }))).code, encoding).toBe("unsupported_encoding");
    }
    fixture.setHandler((_req, res) => {
      res.writeHead(200, { "content-type": "application/json", "content-encoding": "identity" });
      res.end("{}");
    });
    expect((await make().request({ method: "GET", url: url() })).status).toBe(200);
  });

  it("returns 4xx statuses without reading the body, so a hostile error body is never held", async () => {
    for (const status of [400, 401, 403, 404, 410]) {
      fixture.setHandler((_req, res) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end('{"error":"secret detail"}');
      });
      const response = await make().request({ method: "GET", url: url() });
      expect(response.status).toBe(status);
      expect(response.text).toBe("");
    }
  });

  it("json() requires a JSON content type, enforces the depth limit and returns bad_response otherwise", async () => {
    fixture.setHandler((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html></html>");
    });
    const html = await make().request({ method: "GET", url: url() });
    expect(() => html.json()).toThrowError(expect.objectContaining({ code: "bad_response" }));

    fixture.setHandler((_req, res) => {
      res.writeHead(200, { "content-type": "application/vnd.api+json; charset=utf-8" });
      res.end("[".repeat(30) + "]".repeat(30));
    });
    const deep = await make({ maxJsonDepth: 20 }).request({ method: "GET", url: url() });
    expect(() => deep.json()).toThrowError(expect.objectContaining({ code: "bad_response" }));
    const shallow = await make({ maxJsonDepth: 40 }).request({ method: "GET", url: url() });
    expect(Array.isArray(shallow.json())).toBe(true);

    fixture.setHandler((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{not json");
    });
    const broken = await make().request({ method: "GET", url: url() });
    expect(() => broken.json()).toThrowError(expect.objectContaining({ code: "bad_response" }));
  });
});

describe("timeouts, retries, back-off and the run budget (Q4, Q12)", () => {
  let fixture: Fixture;
  beforeAll(async () => {
    fixture = await listen((l) => createHttpServer(l));
  });
  afterAll(async () => {
    await fixture.close();
  });
  const make = (extra: Partial<SafeHttpClientOptions> = {}) =>
    client({ baseUrl: `http://127.0.0.1:${fixture.port}`, destination: { allowPrivateHosts: true }, ...extra });
  const url = () => `http://127.0.0.1:${fixture.port}/x`;

  it("a request that uses its whole per-attempt limit is a timeout (not clipped by the budget)", async () => {
    fixture.setHandler(() => undefined); // never answers
    const error = await failure(make({ attemptTimeoutMs: 150, maxAttempts: 1 }).request({ method: "GET", url: url() }));
    expect(error.code).toBe("timeout");
  });

  it("a request still in flight when the run budget ends is budget_exhausted, not a timeout", async () => {
    fixture.setHandler(() => undefined);
    const budget = new RunBudget({ totalMs: 1_300, minUsefulMs: 1_000, requestsPerSecond: 1000 });
    const error = await failure(make({ budget, attemptTimeoutMs: 30_000, maxAttempts: 1 }).request({ method: "GET", url: url() }));
    expect(error.code).toBe("budget_exhausted");
  });

  it("no attempt begins once less than the minimum useful time remains", async () => {
    const before = fixture.hits.length;
    let t = 0;
    const budget = new RunBudget({ totalMs: 5_000, minUsefulMs: 1_000, now: () => t, sleep: async (ms) => void (t += ms) });
    t = 4_500;
    expect((await failure(make({ budget }).request({ method: "GET", url: url() }))).code).toBe("budget_exhausted");
    expect(fixture.hits.length).toBe(before);
  });

  it("retries 5xx up to maxAttempts and then returns the last response (a real failure stays a failure)", async () => {
    const start = fixture.hits.length;
    fixture.setHandler((_req, res) => json(res, { e: 1 }, 503));
    const response = await make({ maxAttempts: 3 }).request({ method: "GET", url: url() });
    expect(response.status).toBe(503);
    expect(response.retriesCutByBudget).toBe(false);
    expect(fixture.hits.length - start).toBe(3);
  });

  it("recovers when a retry succeeds", async () => {
    let n = 0;
    fixture.setHandler((_req, res) => (++n < 3 ? json(res, {}, 502) : json(res, { ok: true })));
    const response = await make({ maxAttempts: 5 }).request({ method: "GET", url: url() });
    expect(response.status).toBe(200);
    expect(n).toBe(3);
  });

  it("does not retry a 4xx", async () => {
    const start = fixture.hits.length;
    fixture.setHandler((_req, res) => json(res, {}, 404));
    expect((await make().request({ method: "GET", url: url() })).status).toBe(404);
    expect(fixture.hits.length - start).toBe(1);
  });

  it("429 with Retry-After: the wait is the header value, bounded by the budget; a long wait ends the retry loop as budget-cut", async () => {
    // Retry-After 600 s is clamped to 60 s by the client and then to what the budget leaves.
    fixture.setHandler((_req, res) => json(res, {}, 429, { "retry-after": "600" }));
    const slept: number[] = [];
    let t = 0;
    const budget = new RunBudget({ totalMs: 120_000, requestsPerSecond: 1000, now: () => t, sleep: async (ms) => void (slept.push(ms), (t += ms)) });
    const cut = await make({ budget, maxAttempts: 5, baseBackoffMs: 5_000 }).request({ method: "GET", url: url() });
    expect(cut.status).toBe(429);
    // one 60 s wait fits (120 s budget), the next would leave less than a useful attempt: cut by the budget
    expect(cut.retriesCutByBudget).toBe(true);
    expect(slept.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(120_000);
    expect(slept.every((ms) => ms <= 60_000)).toBe(true);
  });

  it("a small Retry-After is honoured exactly", async () => {
    let n = 0;
    fixture.setHandler((_req, res) => (++n === 1 ? json(res, {}, 429, { "retry-after": "2" }) : json(res, { ok: true })));
    const slept: number[] = [];
    let t = 0;
    const budget = new RunBudget({ totalMs: 120_000, requestsPerSecond: 1000, now: () => t, sleep: async (ms) => void (slept.push(ms), (t += ms)) });
    const response = await make({ budget }).request({ method: "GET", url: url() });
    expect(response.status).toBe(200);
    expect(slept.filter((ms) => ms >= 1000)).toEqual([2000]);
  });

  it("a connection failure is retried then reported as unreachable; a budget cut on a transport error is flagged", async () => {
    const dead = await listen((l) => createHttpServer(l));
    const deadPort = dead.port;
    await dead.close();
    const error = await failure(client({ baseUrl: `http://127.0.0.1:${deadPort}`, destination: { allowPrivateHosts: true }, maxAttempts: 2 }).request({ method: "GET", url: `http://127.0.0.1:${deadPort}/x` }));
    expect(error.code).toBe("unreachable");
    expect(error.budgetCut).toBe(false);
  });

  it("the caller's stop check (Beta flag off) aborts an in-flight request within the check interval and discards the response", async () => {
    fixture.setHandler(() => undefined);
    let stopped = false;
    const budget = new RunBudget({ requestsPerSecond: 1000, stopCheckIntervalMs: 40, checkStop: async () => (stopped ? "flag_disabled" : null) });
    const started = Date.now();
    setTimeout(() => {
      stopped = true;
    }, 100);
    const error = await failure(make({ budget, attemptTimeoutMs: 20_000 }).request({ method: "GET", url: url() }));
    expect(error.code).toBe("stopped");
    expect(error.reason).toBe("flag_disabled");
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("a stop flagged before the run starts sends no request at all", async () => {
    const before = fixture.hits.length;
    const budget = new RunBudget({ checkStop: async () => "flag_disabled" });
    expect((await failure(make({ budget }).request({ method: "GET", url: url() }))).code).toBe("stopped");
    expect(fixture.hits.length).toBe(before);
  });

  it("a stop during a back-off wake-up prevents the retry", async () => {
    const start = fixture.hits.length;
    fixture.setHandler((_req, res) => json(res, {}, 503));
    let checks = 0;
    const budget = new RunBudget({ requestsPerSecond: 1000, stopCheckIntervalMs: 20, checkStop: async () => (++checks > 3 ? "flag_disabled" : null) });
    const error = await failure(make({ budget, maxAttempts: 5, baseBackoffMs: 200 }).request({ method: "GET", url: url() }));
    expect(error.code).toBe("stopped");
    expect(fixture.hits.length - start).toBe(1);
  });
});

describe("TLS: certificate verification and SNI", () => {
  const dir = mkdtempSync(join(tmpdir(), "safe-http-tls-"));
  const names = ["api.test.example", "other.test.example"];
  const material: Record<string, { key: string; cert: string }> = {};
  let servers: Fixture[] = [];

  beforeAll(() => {
    for (const name of names) {
      const key = join(dir, `${name}.key`);
      const cert = join(dir, `${name}.crt`);
      execFileSync("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-keyout", key, "-out", cert, "-subj", `/CN=${name}`, "-days", "1", "-addext", `subjectAltName=DNS:${name}`], {
        stdio: "ignore",
      });
      material[name] = { key: readFileSync(key, "utf8"), cert: readFileSync(cert, "utf8") };
    }
  });
  afterAll(async () => {
    await Promise.all(servers.map((s) => s.close()));
    rmSync(dir, { recursive: true, force: true });
  });

  async function tlsServer(certName: string, seenServerNames: string[]): Promise<Fixture> {
    const f = await listen((l) =>
      createHttpsServer({ key: material[certName]!.key, cert: material[certName]!.cert }, l).on("tlsClientError", () => undefined).on("secureConnection", (socket) => {
        seenServerNames.push((socket as unknown as { servername?: string }).servername ?? "");
      }),
    );
    servers.push(f);
    return f;
  }
  const tlsClient = (port: number, ca: string | undefined) =>
    client({
      baseUrl: `https://api.test.example:${port}`,
      destination: { allowPrivateHosts: true },
      resolve: async () => ["127.0.0.1"],
      ...(ca ? { tlsCa: ca } : {}),
    });

  it("connects when the certificate matches the host name and sends that name as SNI", async () => {
    const seen: string[] = [];
    const f = await tlsServer("api.test.example", seen);
    f.setHandler((_req, res) => json(res, { ok: true }));
    const response = await tlsClient(f.port, material["api.test.example"]!.cert).request({ method: "GET", url: `https://api.test.example:${f.port}/x` });
    expect(response.status).toBe(200);
    expect(seen).toEqual(["api.test.example"]);
  });

  it("refuses a certificate issued for another name (wrong host), even if the CA is trusted", async () => {
    const f = await tlsServer("other.test.example", []);
    const error = await failure(tlsClient(f.port, material["other.test.example"]!.cert).request({ method: "GET", url: `https://api.test.example:${f.port}/x` }));
    expect(error.code).toBe("tls_error");
  });

  it("refuses an untrusted (self-signed) certificate when no extra CA is configured", async () => {
    const f = await tlsServer("api.test.example", []);
    const error = await failure(tlsClient(f.port, undefined).request({ method: "GET", url: `https://api.test.example:${f.port}/x` }));
    expect(error.code).toBe("tls_error");
  });

  it("a plain-HTTP server on an https origin is a TLS or unreachable failure, never a successful response", async () => {
    const f = await listen((l) => createHttpServer(l));
    servers.push(f);
    const error = await failure(tlsClient(f.port, material["api.test.example"]!.cert).request({ method: "GET", url: `https://api.test.example:${f.port}/x` }));
    expect(["tls_error", "unreachable"]).toContain(error.code);
    expect(codeOf(error)).not.toBe("no_error");
  });
});
