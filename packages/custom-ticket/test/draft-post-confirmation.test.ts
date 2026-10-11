/** A draft is kept only without an unconfirmed POST (plan 09 §6.2); every other incomplete draft is still saved. */
import { describe, expect, it, vi } from "vitest";
import { DraftInputError, saveDraft } from "../src/drafts";

function stubPrisma() {
  const upsert = vi.fn(async ({ create }: { create: { displayName: string; config: unknown; secrets: unknown; expiresAt: Date } }) => ({ ...create }));
  const findUnique = vi.fn(async () => null);
  return { prisma: { customProviderDraft: { findUnique, upsert } } as never, upsert, findUnique };
}
const doc = (request: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ displayName: "Acme", tickets: { request }, ...extra });
const save = (config: unknown) => {
  const stub = stubPrisma();
  return { ...stub, result: saveDraft(stub.prisma, "org_1", { config }) };
};

describe("saveDraft and the POST confirmation", () => {
  it("refuses a POST without the confirmation, names the endpoint and writes nothing", async () => {
    const { result, upsert, findUnique } = save(doc({ method: "POST", path: "/v2/search" }));
    await expect(result).rejects.toMatchObject({ code: "post_requires_read_only_designation", endpoints: ["tickets.request"] });
    await expect(result).rejects.toBeInstanceOf(DraftInputError);
    expect(upsert).not.toHaveBeenCalled();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("refuses `readOnlySearch: false` and an unconfirmed POST in any request section", async () => {
    await expect(save(doc({ method: "POST", path: "/s", readOnlySearch: false })).result).rejects.toMatchObject({ code: "post_requires_read_only_designation" });
    const other = save(doc({ method: "GET", path: "/t" }, { comments: { request: { method: "POST", path: "/c" } }, statusHistory: { request: { method: "POST", path: "/h" } } }));
    await expect(other.result).rejects.toMatchObject({ endpoints: ["comments.request", "statusHistory.request"] });
  });

  it("refuses it even when the rest of the draft is incomplete or would not parse", async () => {
    await expect(save({ tickets: { request: { method: "POST" } } }).result).rejects.toMatchObject({ code: "post_requires_read_only_designation" });
  });

  it("saves a confirmed POST", async () => {
    const { result, upsert } = save(doc({ method: "POST", path: "/v2/search", readOnlySearch: true }));
    await expect(result).resolves.toMatchObject({ displayName: "Acme" });
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it("GET is unchanged: a GET and an incomplete GET draft are still saved", async () => {
    const complete = save(doc({ method: "GET", path: "/v2/tickets" }));
    await expect(complete.result).resolves.toBeDefined();
    const incomplete = save({ displayName: "Acme" });
    await expect(incomplete.result).resolves.toBeDefined();
    expect(complete.upsert).toHaveBeenCalledTimes(1);
    expect(incomplete.upsert).toHaveBeenCalledTimes(1);
  });
});
