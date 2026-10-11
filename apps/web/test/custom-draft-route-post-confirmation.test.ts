import { describe, expect, it, vi } from "vitest";

const upsert = vi.hoisted(() => vi.fn(async ({ create }: { create: Record<string, unknown> }) => ({ ...create })));

vi.mock("@/lib/custom-provider/route-guard", async () => {
  const { NextResponse } = await import("next/server");
  return {
    ownerGuard: async () => ({ ok: true, ctx: { prisma: { customProviderDraft: { findUnique: async () => null, upsert } }, organizationId: "org_1" } }),
    failure: (code: string, status: number, extra: Record<string, unknown> = {}) => NextResponse.json({ error: code, code, ...extra }, { status }),
    readJson: async (request: Request) => request.json().catch(() => null),
  };
});

const put = async (config: unknown) => {
  const { PUT } = await import("@/app/api/integrations/custom/draft/route");
  return PUT(new Request("http://localhost/api/integrations/custom/draft", { method: "PUT", body: JSON.stringify({ config }) }));
};

describe("PUT /api/integrations/custom/draft", () => {
  it("returns 422 for a POST without the read-only confirmation and saves nothing", async () => {
    const response = await put({ displayName: "A", tickets: { request: { method: "POST", path: "/s" } } });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "post_requires_read_only_designation", endpoints: ["tickets.request"] });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("saves a confirmed POST and a GET", async () => {
    expect((await put({ displayName: "A", tickets: { request: { method: "POST", path: "/s", readOnlySearch: true } } })).status).toBe(200);
    expect((await put({ displayName: "A", tickets: { request: { method: "GET", path: "/t" } } })).status).toBe(200);
    expect(upsert).toHaveBeenCalledTimes(2);
  });
});
