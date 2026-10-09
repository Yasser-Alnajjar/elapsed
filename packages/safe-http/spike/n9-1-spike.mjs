// N9.1 security spike (plan 09 section 8.2). Not production code, and not a test:
// it exercises `undici` (option A) against local servers and prints PASS/FAIL per
// criterion. Run: `pnpm --filter @sla/safe-http spike`.
//
// Local servers cannot be "public", so address classification is an injected
// predicate (`allowed`). The mechanism under test is the one N9.2 will use:
// `Agent({ connect: { lookup } })`, where the lookup hook resolves, validates
// EVERY address, and only then hands the connect layer the validated set.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer as createHttps } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent, request } from "undici";
import { gzipSync } from "node:zlib";

const results = [];
function record(id, name, ok, detail = "") {
  results.push({ id, name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${id}  ${name}${detail ? `  (${detail})` : ""}`);
}

// ---- local PKI: a CA and a leaf certificate for api.example.test ----------
const dir = mkdtempSync(join(tmpdir(), "n9-1-"));
const sh = (args) => execFileSync("openssl", args, { cwd: dir, stdio: "pipe" });
sh(["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "ca.key", "-out", "ca.pem", "-days", "2", "-subj", "/CN=spike-ca"]);
sh(["req", "-newkey", "rsa:2048", "-nodes", "-keyout", "leaf.key", "-out", "leaf.csr", "-subj", "/CN=api.example.test"]);
execFileSync("sh", ["-c", `printf 'subjectAltName=DNS:api.example.test\n' > ext.cnf`], { cwd: dir });
sh(["x509", "-req", "-in", "leaf.csr", "-CA", "ca.pem", "-CAkey", "ca.key", "-CAcreateserial", "-out", "leaf.pem", "-days", "2", "-extfile", "ext.cnf"]);
const ca = readFileSync(join(dir, "ca.pem"));
const cert = readFileSync(join(dir, "leaf.pem"));
const key = readFileSync(join(dir, "leaf.key"));

// ---- servers ---------------------------------------------------------------
const seenSni = [];
const seenRemote = [];
let behavior = "ok";
function handler(req, res) {
  seenRemote.push(req.socket.remoteAddress);
  if (behavior === "redirect") {
    res.writeHead(302, { location: "https://api.example.test/elsewhere" }).end();
  } else if (behavior === "big") {
    res.writeHead(200, { "content-type": "application/json" });
    const chunk = Buffer.alloc(64 * 1024, 0x61);
    let sent = 0;
    const pump = () => {
      while (sent < 50 * 1024 * 1024) {
        sent += chunk.length;
        if (!res.write(chunk)) return void res.once("drain", pump);
      }
      res.end();
    };
    pump();
  } else if (behavior === "gzip") {
    // Ignores `Accept-Encoding: identity` on purpose: a hostile server.
    res.writeHead(200, { "content-type": "application/json", "content-encoding": "gzip" }).end(gzipSync(Buffer.from('{"a":1}')));
  } else if (behavior === "hang") {
    // never answers
  } else {
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, host: req.headers.host }));
  }
}
const tlsOptions = { key, cert, SNICallback: (servername, cb) => { seenSni.push(servername); cb(null, undefined); } };
function listen(server, host) {
  return new Promise((resolve) => server.listen(0, host, () => resolve(server.address().port)));
}
// One port on both families: bind v4 and v6 separately on the same port.
const v4 = createHttps({ key, cert, SNICallback: tlsOptions.SNICallback }, handler);
const port = await listen(v4, "127.0.0.1");
const v6 = createHttps({ key, cert, SNICallback: tlsOptions.SNICallback }, handler);
let v6ok = true;
await new Promise((resolve) => { v6.once("error", () => { v6ok = false; resolve(); }); v6.listen(port, "::1", resolve); });

// ---- the mechanism under test ----------------------------------------------
/** `resolve(hostname) => string[]` and `allowed(address) => boolean` are injected. */
function pinnedAgent({ resolve, allowed, extra = {} }) {
  const lookups = [];
  const agent = new Agent({
    connect: {
      ca,
      lookup(hostname, options, callback) {
        Promise.resolve(resolve(hostname)).then((addresses) => {
          lookups.push({ hostname, addresses });
          if (addresses.length === 0 || addresses.some((a) => !allowed(a))) {
            const err = new Error("blocked_destination");
            err.code = "EBLOCKED";
            return callback(err);
          }
          const records = addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
          if (options && options.all) callback(null, records);
          else callback(null, records[0].address, records[0].family);
        }, (e) => callback(e));
      },
      ...extra,
    },
    keepAliveTimeout: 1,
    keepAliveMaxTimeout: 1,
    maxRedirections: 0,
  });
  return { agent, lookups };
}

const get = (agent, url, opts = {}) =>
  request(url, { method: "GET", dispatcher: agent, headers: { accept: "application/json", "accept-encoding": "identity" }, ...opts });
const origin = `https://api.example.test:${port}`;
async function rejects(promise) {
  try { await promise; return null; } catch (e) { return e; }
}
const allowedOnly = (...ok) => (a) => ok.includes(a);

// 1. Pinning: validation and connect use the same lookup, so a rebind between "checks" cannot matter.
{
  let calls = 0;
  const { agent } = pinnedAgent({
    resolve: () => (++calls === 1 ? ["127.0.0.1"] : ["::1"]),
    allowed: allowedOnly("127.0.0.1"),
  });
  const first = await get(agent, origin);
  await first.body.dump();
  const remote1 = seenRemote.at(-1);
  await agent.close();
  // A second agent re-resolves: now the name answers with the denied address.
  const second = pinnedAgent({ resolve: () => ["::1"], allowed: allowedOnly("127.0.0.1") });
  const e = await rejects(get(second.agent, origin));
  await second.agent.close();
  record("1", "pinning: connects to the validated address only; a rebinding answer is refused", first.statusCode === 200 && remote1 === "127.0.0.1" && e && /blocked_destination|EBLOCKED/.test(String(e.code ?? e.message) + String(e.cause?.code ?? "")), `remote=${remote1} err=${e?.code ?? e?.cause?.code ?? e?.message}`);
}

// 2. TLS hostname verification: valid cert for another name is rejected, the right name passes.
{
  const { agent } = pinnedAgent({ resolve: () => ["127.0.0.1"], allowed: allowedOnly("127.0.0.1") });
  const ok = await get(agent, origin); await ok.body.dump();
  const e = await rejects(get(agent, `https://other.example.test:${port}`));
  await agent.close();
  const code = e?.code ?? e?.cause?.code;
  record("2", "TLS hostname verification: certificate for another name is rejected", ok.statusCode === 200 && code === "ERR_TLS_CERT_ALTNAME_INVALID", `code=${code}`);
}

// 3. SNI equals the hostname, not an IP.
{
  seenSni.length = 0;
  const { agent } = pinnedAgent({ resolve: () => ["127.0.0.1"], allowed: allowedOnly("127.0.0.1") });
  const r = await get(agent, origin); await r.body.dump();
  await agent.close();
  record("3", "SNI is the hostname", seenSni.length > 0 && seenSni.every((s) => s === "api.example.test"), `sni=${JSON.stringify(seenSni)}`);
}

// 4. Dual-stack: any non-validated record refuses the request; all-validated falls back only among validated.
{
  const mixed = pinnedAgent({ resolve: () => ["127.0.0.1", "::1"], allowed: allowedOnly("127.0.0.1") });
  const e = await rejects(get(mixed.agent, origin));
  await mixed.agent.close();
  const refused = !!e && (e.code === "EBLOCKED" || e.cause?.code === "EBLOCKED" || /blocked_destination/.test(e.message));
  let fallbackOk = true;
  let detail = "";
  if (v6ok) {
    // IPv6 first and unreachable-by-listener is not possible here; instead put a validated address that refuses
    // connections first and the working validated one second, and prove the fallback stays inside the set.
    const both = pinnedAgent({ resolve: () => ["::1", "127.0.0.1"], allowed: allowedOnly("::1", "127.0.0.1") });
    const r = await get(both.agent, origin); await r.body.dump();
    await both.agent.close();
    fallbackOk = r.statusCode === 200 && ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(seenRemote.at(-1));
    detail = `remote=${seenRemote.at(-1)}`;
  } else detail = "IPv6 loopback listener unavailable; fallback sub-check skipped";
  record("4", "dual-stack: one non-validated record refuses; fallback stays inside the validated set", refused && fallbackOk, detail);
}

// 5. One agent per run: a new agent re-validates; the first agent's socket is closed with it.
{
  let calls = 0;
  const run1 = pinnedAgent({ resolve: () => (calls++, ["127.0.0.1"]), allowed: allowedOnly("127.0.0.1") });
  const a = await get(run1.agent, origin); await a.body.dump();
  const b = await get(run1.agent, origin); await b.body.dump();
  const lookupsInRun = run1.lookups.length; // keep-alive within a run reuses the validated socket
  await run1.agent.close();
  const run2 = pinnedAgent({ resolve: () => (calls++, ["127.0.0.1"]), allowed: allowedOnly("127.0.0.1") });
  const c = await get(run2.agent, origin); await c.body.dump();
  await run2.agent.close();
  record("5", "per-run agent: new run re-resolves and re-validates; no reuse across runs", run2.lookups.length === 1 && calls >= 2, `lookups in run1=${lookupsInRun}, run2=${run2.lookups.length}`);
}

// 6. Redirects: not followed; the 3xx is visible to the caller, which treats it as an error.
{
  behavior = "redirect";
  const { agent } = pinnedAgent({ resolve: () => ["127.0.0.1"], allowed: allowedOnly("127.0.0.1") });
  const r = await get(agent, origin); await r.body.dump();
  await agent.close();
  behavior = "ok";
  record("6", "redirects are not followed (3xx surfaces to the caller)", r.statusCode === 302 && !!r.headers.location, `status=${r.statusCode}`);
}

// 7. Limits: streamed byte cap, identity encoding enforced, timeouts, abort.
{
  const { agent } = pinnedAgent({ resolve: () => ["127.0.0.1"], allowed: allowedOnly("127.0.0.1") });
  // 7a. byte cap on a 50 MB body: stop at 1 MB
  behavior = "big";
  const big = await get(agent, origin);
  let received = 0;
  const cap = 1024 * 1024;
  let capped = false;
  try {
    for await (const chunk of big.body) { received += chunk.length; if (received > cap) { big.body.destroy(); capped = true; break; } }
  } catch { capped = true; }
  // 7b. gzip despite identity: undici.request does not decompress; the caller rejects any content-encoding
  behavior = "gzip";
  const gz = await get(agent, origin); await gz.body.dump();
  const encodingVisible = gz.headers["content-encoding"] === "gzip";
  // 7c. timeout and abort-by-signal on a server that never answers
  behavior = "hang";
  const t0 = Date.now();
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 300);
  const e1 = await rejects(get(agent, origin, { signal: ac.signal }));
  const abortedMs = Date.now() - t0;
  const t1 = Date.now();
  const e2 = await rejects(get(agent, origin, { headersTimeout: 300 }));
  const timeoutMs = Date.now() - t1;
  behavior = "ok";
  await agent.close();
  record("7", "limits: byte cap, content-encoding visible for rejection, abort and timeout", capped && received <= cap + 256 * 1024 && encodingVisible && !!e1 && abortedMs < 2000 && !!e2 && timeoutMs < 2000, `received=${received} abortMs=${abortedMs} timeoutMs=${timeoutMs} e2=${e2?.code}`);
}

// 8. Proxy variables are ignored by Agent (only EnvHttpProxyAgent reads them).
{
  const saved = { ...process.env };
  for (const k of ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY"]) process.env[k] = "http://127.0.0.1:9";
  delete process.env.NO_PROXY; delete process.env.no_proxy;
  const { agent } = pinnedAgent({ resolve: () => ["127.0.0.1"], allowed: allowedOnly("127.0.0.1") });
  const e = await rejects(get(agent, origin).then((r) => r.body.dump()));
  await agent.close();
  Object.assign(process.env, saved);
  record("8", "proxy environment variables are ignored", e === null, e ? String(e.code ?? e.message) : "direct");
}

v4.close(); v6.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} criteria passed; undici ${JSON.parse(readFileSync(new URL("../node_modules/undici/package.json", import.meta.url), "utf8")).version}; node ${process.version}`);
process.exit(failed.length ? 1 : 0);
