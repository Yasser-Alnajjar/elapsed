import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@sla/db";
import { upsertPolicyVersion } from "../src/policies";

interface VersionRow {
  id: string;
  policyId: string;
  version: number;
  match: unknown;
  targets: unknown;
  calendarVersionId: string;
  source: "imported" | "override";
  pauseOnStates?: string[];
}

/** In-memory `sLAPolicy`/`sLAPolicyVersion` delegates honoring the `where`/`orderBy` shapes `upsertPolicyVersion` passes. */
function fakePrisma(versions: VersionRow[]) {
  const prisma = {
    sLAPolicy: {
      upsert: async () => ({ id: "pol_1" }),
    },
    sLAPolicyVersion: {
      findFirst: async ({ where }: { where: { policyId: string; source?: VersionRow["source"] } }) =>
        versions
          .filter((v) => v.policyId === where.policyId && (where.source === undefined || v.source === where.source))
          .sort((a, b) => b.version - a.version)[0] ?? null,
      create: async ({ data }: { data: Omit<VersionRow, "id"> }) => {
        const row = { ...data, id: `ver_${versions.length + 1}` } as VersionRow;
        versions.push(row);
        return row;
      },
    },
  };
  return prisma as unknown as PrismaClient;
}

const match = { priority: ["urgent"] };
const zendeskTargets = [{ kind: "first_response" as const, minutes: 30 }];

function row(version: number, source: VersionRow["source"], minutes: number): VersionRow {
  return {
    id: `ver_${version}`,
    policyId: "pol_1",
    version,
    match,
    targets: [{ kind: "first_response", minutes }],
    calendarVersionId: "calv_1",
    source,
  };
}

describe("upsertPolicyVersion with a manual override on top", () => {
  it("leaves the override as the latest version when Zendesk's policy is unchanged", async () => {
    const versions = [row(1, "imported", 30), row(2, "override", 10)];

    const created = await upsertPolicyVersion(fakePrisma(versions), "org_1", "123:urgent", "Urgent", {
      match,
      targets: zendeskTargets,
      calendarVersionId: "calv_1",
    });

    expect(created).toBe(false);
    expect(versions.map((v) => [v.version, v.source])).toEqual([
      [1, "imported"],
      [2, "override"],
    ]);
  });

  it("writes a new imported version above the override once Zendesk's targets actually change", async () => {
    const versions = [row(1, "imported", 30), row(2, "override", 10)];

    const created = await upsertPolicyVersion(fakePrisma(versions), "org_1", "123:urgent", "Urgent", {
      match,
      targets: [{ kind: "first_response", minutes: 45 }],
      calendarVersionId: "calv_1",
    });

    expect(created).toBe(true);
    expect(versions.at(-1)).toMatchObject({
      version: 3,
      source: "imported",
      targets: [{ kind: "first_response", minutes: 45 }],
    });
  });

  it("creates the first imported version for a new policy", async () => {
    const versions: VersionRow[] = [];

    const created = await upsertPolicyVersion(fakePrisma(versions), "org_1", "123:urgent", "Urgent", {
      match,
      targets: zendeskTargets,
      calendarVersionId: "calv_1",
    });

    expect(created).toBe(true);
    expect(versions).toMatchObject([{ version: 1, source: "imported" }]);
  });

  it("stamps no pause states on an imported version: Zendesk never pauses Resolution on Pending (H-12)", async () => {
    const versions: VersionRow[] = [];
    await upsertPolicyVersion(fakePrisma(versions), "org_1", "123:urgent", "Urgent", {
      match,
      targets: [{ kind: "resolution" as const, minutes: 20 }],
      calendarVersionId: "calv_1",
    });
    expect(versions[0]!.pauseOnStates).toEqual([]);
  });

  it("leaves a next_reply override as the latest version when Zendesk's policy is unchanged", async () => {
    const importedNextReply = [{ kind: "next_reply" as const, minutes: 60 }];
    const overriddenNextReply = [{ kind: "next_reply" as const, minutes: 15 }];
    const versions: VersionRow[] = [
      { id: "ver_1", policyId: "pol_1", version: 1, match, targets: importedNextReply, calendarVersionId: "calv_1", source: "imported" },
      { id: "ver_2", policyId: "pol_1", version: 2, match, targets: overriddenNextReply, calendarVersionId: "calv_1", source: "override" },
    ];

    const created = await upsertPolicyVersion(fakePrisma(versions), "org_1", "123:urgent", "Urgent", {
      match,
      targets: importedNextReply,
      calendarVersionId: "calv_1",
    });

    expect(created).toBe(false);
    expect(versions.map((v) => [v.version, v.source])).toEqual([
      [1, "imported"],
      [2, "override"],
    ]);
  });
});
