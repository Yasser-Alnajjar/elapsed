import { afterEach, describe, expect, it, vi } from "vitest";
import { buildAuthorizeUrl, exchangeCodeForToken, IntercomOAuthError } from "../src/oauth";

const config = { clientId: "client-123", clientSecret: "secret-xyz" };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("buildAuthorizeUrl", () => {
  it("targets Intercom's authorize endpoint with no scope param, and no redirect_uri unless one is given", () => {
    const url = new URL(buildAuthorizeUrl({ clientId: "client-123" }, "state-abc"));

    expect(url.origin).toBe("https://app.intercom.com");
    expect(url.pathname).toBe("/oauth");
    expect(url.searchParams.get("client_id")).toBe("client-123");
    expect(url.searchParams.get("state")).toBe("state-abc");
    expect(url.searchParams.get("redirect_uri")).toBeNull();
    expect(url.searchParams.get("scope")).toBeNull();
  });

  it("sends redirect_uri when the config carries one", () => {
    const redirectUri = "https://app.example.com/api/integrations/intercom/callback";
    const url = new URL(buildAuthorizeUrl({ clientId: "client-123", redirectUri }, "state-abc"));

    expect(url.searchParams.get("redirect_uri")).toBe(redirectUri);
  });
});

describe("exchangeCodeForToken", () => {
  it("posts a JSON body and returns the access token from the `token` field", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { token: "access-1", token_type: "Bearer" }));
    vi.stubGlobal("fetch", fetchMock);

    const credentials = await exchangeCodeForToken("code-1", config);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.intercom.io/auth/eagle/token",
      expect.objectContaining({ method: "POST" }),
    );
    const sentBody = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(sentBody).toEqual({ code: "code-1", client_id: "client-123", client_secret: "secret-xyz" });

    expect(credentials.accessToken).toBe("access-1");
    expect(credentials.tokenType).toBe("Bearer");
    expect(credentials.reauthRequired).toBeUndefined();
  });

  it("throws a structured error when the response has no token", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(400, { error: "invalid_code" })));

    await expect(exchangeCodeForToken("bad-code", config)).rejects.toMatchObject({
      name: "IntercomOAuthError",
      status: 400,
    });
  });

  it("never includes the client secret or code in the thrown error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(400, { error: "invalid_code" })));

    const error = await exchangeCodeForToken("super-secret-code", config).catch((e: Error) => e);
    expect(error).toBeInstanceOf(IntercomOAuthError);
    expect(String(error)).not.toContain("super-secret-code");
    expect(String(error)).not.toContain(config.clientSecret);
  });
});
