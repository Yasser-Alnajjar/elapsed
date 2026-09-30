import { afterEach, describe, expect, it, vi } from "vitest";
import { LinearApiError, LinearClient, LinearPermissionDeniedError } from "../src/client";
import type { LinearCredentials } from "../src/types";

const baseCredentials: LinearCredentials = {
  accessToken: "stale-token",
  tokenType: "Bearer",
  scope: "read",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

const emptyIssuesPage = { data: { issues: { nodes: [], pageInfo: { hasNextPage: false } } } };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LinearClient 401 handling", () => {
  it("refreshes once and retries the request on a single 401", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, { error: "token expired" }))
      .mockResolvedValueOnce(jsonResponse(200, emptyIssuesPage));
    vi.stubGlobal("fetch", fetchMock);

    const onUnauthorized = vi.fn().mockResolvedValue({ ...baseCredentials, accessToken: "fresh-token" });
    const client = new LinearClient(baseCredentials, { onUnauthorized });

    const result = await client.searchIssues("2026-01-01T00:00:00.000Z");

    expect(result).toEqual({ nodes: [], pageInfo: { hasNextPage: false } });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(onUnauthorized).toHaveBeenCalledWith(baseCredentials);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      headers: expect.objectContaining({ Authorization: "Bearer fresh-token" }),
    });
  });

  it("does not retry indefinitely when the refreshed token also gets a 401", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, { error: "still unauthorized" }));
    vi.stubGlobal("fetch", fetchMock);

    const onUnauthorized = vi.fn().mockResolvedValue({ ...baseCredentials, accessToken: "fresh-token" });
    const client = new LinearClient(baseCredentials, { onUnauthorized });

    await expect(client.searchIssues("2026-01-01T00:00:00.000Z")).rejects.toBeInstanceOf(LinearApiError);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("LinearClient 403 handling", () => {
  it("throws LinearPermissionDeniedError on a 403 without attempting a token refresh", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(403, { error: "forbidden" }));
    vi.stubGlobal("fetch", fetchMock);
    const onUnauthorized = vi.fn();
    const client = new LinearClient(baseCredentials, { onUnauthorized });

    const error = await client.searchIssues("2026-01-01T00:00:00.000Z").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(LinearPermissionDeniedError);
    expect(error).toBeInstanceOf(LinearApiError);
    expect((error as LinearApiError).status).toBe(403);
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("LinearClient GraphQL error handling", () => {
  it("throws LinearApiError when the response carries a top-level errors array", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, { errors: [{ message: "Argument Validation Error" }] })),
    );
    const client = new LinearClient(baseCredentials);

    await expect(client.searchIssues("2026-01-01T00:00:00.000Z")).rejects.toBeInstanceOf(LinearApiError);
  });
});

describe("LinearClient empty sub-connections", () => {
  it("returns an empty connection when an issue's history query resolves no issue", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { data: { issue: null } })));
    const client = new LinearClient(baseCredentials);

    const result = await client.fetchIssueHistory("issue-1");

    expect(result).toEqual({ nodes: [], pageInfo: { hasNextPage: false } });
  });

  it("requests the history entry's updatedAt so an in-place rewrite changes the stored payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: { issue: null } }));
    vi.stubGlobal("fetch", fetchMock);

    await new LinearClient(baseCredentials).fetchIssueHistory("issue-1");

    const { query } = JSON.parse(fetchMock.mock.calls[0]?.[1].body as string) as { query: string };
    expect(query).toMatch(/history\([^)]*\)\s*\{\s*nodes\s*\{[^}]*\bupdatedAt\b/);
  });
});
