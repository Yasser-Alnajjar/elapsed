import { describe, expect, it } from "vitest";
import { SafeHttpError } from "../src/errors";
import {
  assertAllowedHostname,
  assertSameOrigin,
  buildUrl,
  isCredentialLookingQueryKey,
  parseHttpsOrigin,
  privateHostsAllowed,
  validateHeaders,
} from "../src/url";

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof SafeHttpError) return error.code;
    throw error;
  }
  return "no_error";
}

describe("parseHttpsOrigin: destination rules", () => {
  it("accepts a plain HTTPS origin and normalizes case and the default port", () => {
    const origin = parseHttpsOrigin("https://API.Example.com:443");
    expect(origin).toEqual({ origin: "https://api.example.com", hostname: "api.example.com", port: 443, protocol: "https:" });
  });

  it("drops a trailing dot from the host name", () => {
    expect(parseHttpsOrigin("https://api.example.com.").hostname).toBe("api.example.com");
  });

  it.each([
    ["http scheme", "http://api.example.com"],
    ["ftp scheme", "ftp://api.example.com"],
    ["non-443 port", "https://api.example.com:8443"],
    ["port 80 over https", "https://api.example.com:80"],
    ["userinfo", "https://user:pass@api.example.com"],
    ["username only", "https://user@api.example.com"],
    ["IPv4 literal", "https://8.8.8.8"],
    ["IPv6 literal", "https://[2606:4700:4700::1111]"],
    ["decimal IPv4", "https://2130706433"],
    ["hex IPv4", "https://0x7f000001"],
    ["octal IPv4", "https://0177.0.0.1"],
    ["short IPv4", "https://127.1"],
    ["all-digit dotted name", "https://1.2.3"],
    ["localhost", "https://localhost"],
    ["subdomain of localhost", "https://app.localhost"],
    ["single-label host", "https://intranet"],
    [".local", "https://printer.local"],
    [".internal", "https://db.internal"],
    ["GCP metadata name", "https://metadata.google.internal"],
    ["EC2 instance data", "https://instance-data.ec2.internal"],
    ["Azure metadata", "https://metadata.azure.com"],
    ["empty string", ""],
    ["not a URL", "api.example.com"],
    ["over 2048 characters", `https://${"a".repeat(2050)}.example.com`],
  ])("refuses %s", (_label, input) => {
    expect(codeOf(() => parseHttpsOrigin(input))).toBe("blocked_destination");
  });

  it("refuses a non-string input", () => {
    expect(codeOf(() => parseHttpsOrigin(undefined as unknown as string))).toBe("blocked_destination");
  });

  it("never lets userinfo or a backslash tricks move the host", () => {
    // `user@host` is userinfo, which is refused outright.
    expect(codeOf(() => parseHttpsOrigin("https://api.example.com@evil.com"))).toBe("blocked_destination");
    // WHATWG treats `\\` as a path separator, so the host stays the first one and the rest is not part of the origin.
    expect(parseHttpsOrigin("https://api.example.com\\@evil.com").hostname).toBe("api.example.com");
    // a fragment or query cannot introduce a second host either
    expect(parseHttpsOrigin("https://api.example.com#@evil.com").hostname).toBe("api.example.com");
    expect(parseHttpsOrigin("https://api.example.com?x=@evil.com").origin).toBe("https://api.example.com");
  });

  it("allows private hosts, http and any port only with the deployment switch", () => {
    const origin = parseHttpsOrigin("http://127.0.0.1:4010", { allowPrivateHosts: true });
    expect(origin).toMatchObject({ hostname: "127.0.0.1", port: 4010, protocol: "http:", origin: "http://127.0.0.1:4010" });
    expect(codeOf(() => parseHttpsOrigin("http://127.0.0.1:4010"))).toBe("blocked_destination");
    // the switch never permits userinfo or a non-http(s) scheme
    expect(codeOf(() => parseHttpsOrigin("http://u:p@127.0.0.1", { allowPrivateHosts: true }))).toBe("blocked_destination");
    expect(codeOf(() => parseHttpsOrigin("ftp://127.0.0.1", { allowPrivateHosts: true }))).toBe("blocked_destination");
  });
});

describe("privateHostsAllowed", () => {
  it("is on only for the exact value 1", () => {
    expect(privateHostsAllowed({ CUSTOM_PROVIDER_ALLOW_PRIVATE_HOSTS: "1" })).toBe(true);
    for (const value of [undefined, "", "0", "true", "yes", " 1"]) {
      expect(privateHostsAllowed({ CUSTOM_PROVIDER_ALLOW_PRIVATE_HOSTS: value })).toBe(false);
    }
  });
});

describe("assertAllowedHostname", () => {
  it("returns the lowercased name and refuses bracketed and numeric forms", () => {
    expect(assertAllowedHostname("API.Example.COM")).toBe("api.example.com");
    expect(codeOf(() => assertAllowedHostname("[::1]"))).toBe("blocked_destination");
    expect(codeOf(() => assertAllowedHostname("::1"))).toBe("blocked_destination");
    expect(codeOf(() => assertAllowedHostname(""))).toBe("blocked_destination");
  });
});

describe("assertSameOrigin and buildUrl: a variable can never change the origin", () => {
  const base = parseHttpsOrigin("https://api.example.com");

  it("accepts a same-origin absolute URL and normalizes a trailing dot", () => {
    expect(assertSameOrigin(base, "https://api.example.com/v2/tickets?cursor=a").pathname).toBe("/v2/tickets");
    expect(assertSameOrigin(base, "https://api.example.com./v2").hostname).toBe("api.example.com");
  });

  it.each([
    ["another host", "https://evil.com/v2"],
    ["a sibling subdomain", "https://other.example.com/v2"],
    ["a different scheme", "http://api.example.com/v2"],
    ["a different port", "https://api.example.com:8443/v2"],
    ["userinfo", "https://u:p@api.example.com/v2"],
    ["a protocol-relative URL", "//evil.com/v2"],
    ["garbage", "not a url"],
    ["a URL over 2048 characters", `https://api.example.com/${"a".repeat(2100)}`],
  ])("refuses %s as a next URL", (_label, input) => {
    expect(codeOf(() => assertSameOrigin(base, input))).toBe("invalid_request");
  });

  it("builds a URL by encoding each segment and every query value", () => {
    const url = buildUrl(base, "/v2/tickets/T 1/comments", { q: "a&b=c#d", "x y": "é" });
    expect(url.origin).toBe("https://api.example.com");
    expect(url.pathname).toBe("/v2/tickets/T%201/comments");
    expect(url.searchParams.get("q")).toBe("a&b=c#d");
    expect(url.hash).toBe("");
    expect(url.searchParams.get("x y")).toBe("é");
  });

  it("encodes an id that looks like a host, and refuses one that tries to add a path segment", () => {
    const hostLike = buildUrl(base, `/v2/tickets/${encodeURIComponent("@evil.com")}`);
    expect(hostLike.hostname).toBe("api.example.com");
    expect(hostLike.pathname).toBe("/v2/tickets/%40evil.com");
    expect(codeOf(() => buildUrl(base, `/v2/tickets/${encodeURIComponent("@evil.com/../x")}`))).toBe("invalid_request");
  });

  it.each([
    ["no leading slash", "v2/tickets"],
    ["a protocol-relative path", "//evil.com/x"],
    ["a backslash", "/v2\\tickets"],
    ["a control character", "/v2/tick\u0001ets"],
    ["a dot segment", "/v2/./tickets"],
    ["a parent segment", "/v2/../admin"],
    ["an encoded parent segment", "/v2/%2e%2e/admin"],
    ["an encoded slash inside a segment", "/v2/a%2Fb"],
    ["a malformed percent escape", "/v2/%E0%A4%A"],
  ])("refuses a path with %s", (_label, path) => {
    expect(codeOf(() => buildUrl(base, path))).toBe("invalid_request");
  });
});

describe("validateHeaders: header injection and routing headers", () => {
  it("lowercases names and keeps values", () => {
    expect(validateHeaders({ "X-Api-Key": "abc", Accept: "application/json" })).toEqual({ "x-api-key": "abc", accept: "application/json" });
  });

  it.each(["Host", "Content-Length", "Transfer-Encoding", "Connection", "Cookie", "Set-Cookie", "Upgrade", "TE", "Trailer", "Proxy-Authorization", "Proxy-Connection", "X-Forwarded-For", "x-forwarded-host"])(
    "refuses the %s header",
    (name) => {
      expect(codeOf(() => validateHeaders({ [name]: "v" }))).toBe("invalid_request");
    },
  );

  it.each([
    ["CR in a value", "a\rb"],
    ["LF in a value", "a\nb"],
    ["CRLF header splitting", "a\r\nInjected: 1"],
    ["NUL in a value", "a\u0000b"],
  ])("refuses %s", (_label, value) => {
    expect(codeOf(() => validateHeaders({ "X-Custom": value }))).toBe("invalid_request");
  });

  it("refuses invalid header names and non-string values", () => {
    expect(codeOf(() => validateHeaders({ "Bad Name": "v" }))).toBe("invalid_request");
    expect(codeOf(() => validateHeaders({ "X:Colon": "v" }))).toBe("invalid_request");
    expect(codeOf(() => validateHeaders({ "X-Num": 5 as unknown as string }))).toBe("invalid_request");
  });
});

describe("isCredentialLookingQueryKey", () => {
  it.each(["key", "api_key", "api-key", "apikey", "token", "access_token", "access-token", "secret", "password", "passwd", "auth", "authorization", "signature", "sig", "credential", "credentials", "API_KEY", "Token"])(
    "flags %s",
    (key) => {
      expect(isCredentialLookingQueryKey(key)).toBe(true);
    },
  );

  it.each(["page", "cursor", "per_page", "updated_after", "keyword", "tokens_used", "monkey", "author"])("does not flag %s", (key) => {
    expect(isCredentialLookingQueryKey(key)).toBe(false);
  });
});
