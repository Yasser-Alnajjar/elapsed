import { CASE_SOURCE_CONNECTED, type PrismaClient } from "@sla/db";
import { describe, expect, it, vi } from "vitest";
import { getCaseTitleData } from "../src/lib/case-detail-data";

function prismaReturning(row: unknown) {
  const findFirst = vi.fn(async () => row);
  return { prisma: { case: { findFirst } } as unknown as PrismaClient, findFirst };
}

describe("getCaseTitleData", () => {
  it("reads only the title columns, scoped to the organization, not-deleted and connected-source cases", async () => {
    const row = { system: "zendesk", externalId: "8921", subject: "Login fails after SSO" };
    const { prisma, findFirst } = prismaReturning(row);

    await expect(getCaseTitleData(prisma, "org-1", "case-1")).resolves.toEqual(row);

    expect(findFirst).toHaveBeenCalledWith({
      where: { id: "case-1", organizationId: "org-1", deletedAt: null, ...CASE_SOURCE_CONNECTED },
      select: { system: true, externalId: true, subject: true },
    });
  });

  it("returns null for a case that is not this organization's, so the title falls back to the generic one", async () => {
    const { prisma } = prismaReturning(null);
    await expect(getCaseTitleData(prisma, "org-1", "someone-elses-case")).resolves.toBeNull();
  });
});
