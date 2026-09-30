import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { getPrismaClient, type PrismaClient } from "@sla/db";
import {
  REPLAY_FORMAT_VERSION,
  buildOrgReplayRecords,
  loadOrgReplayInput,
  serializeReplay,
  summarizeDrift,
  type ReplayRecord,
} from "../replay";

/**
 * L1 evaluation replay, capture side (N1.1). Re-evaluates every stored
 * commitment and case with the CURRENT code at a fixed `--as-of` and writes a
 * deterministic JSONL file. Capture before a change and after it, then diff
 * with `replay:compare`. Run via `pnpm --filter @sla/commitments
 * replay:capture -- --as-of <ISO> --out <file.jsonl> [--org <id> ...]`.
 *
 * Strictly read-only: everything runs in one `READ ONLY` transaction. Point
 * `DATABASE_URL` at the `sla_restore_drill` scratch database, never the live
 * one; the script refuses any other database unless `--allow-non-scratch`.
 * The output holds customer data: keep it in the scratch directory, never git.
 */

const SCRATCH_DATABASE = "sla_restore_drill";

function databaseName(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  } catch {
    return null;
  }
}

function gitSha(): string {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

export async function captureReplay(prisma: PrismaClient, asOf: string, organizationIds?: string[]) {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      const db = tx as unknown as PrismaClient;
      const orgIds =
        organizationIds ??
        (await db.organization.findMany({ select: { id: true }, orderBy: { id: "asc" } })).map((o) => o.id);
      const records: ReplayRecord[] = [];
      for (const organizationId of [...orgIds].sort()) {
        records.push(...buildOrgReplayRecords(await loadOrgReplayInput(db, organizationId, asOf)));
      }
      return { organizationIds: [...orgIds].sort(), records };
    },
    { timeout: 30 * 60 * 1000, maxWait: 60 * 1000 },
  );
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((a) => a !== "--"),
    options: {
      "as-of": { type: "string" },
      out: { type: "string" },
      org: { type: "string", multiple: true },
      "allow-non-scratch": { type: "boolean", default: false },
    },
  });
  const asOfRaw = values["as-of"];
  if (!asOfRaw || !values.out || Number.isNaN(Date.parse(asOfRaw))) {
    console.error("usage: replay:capture -- --as-of <ISO> --out <file.jsonl> [--org <id> ...]");
    process.exit(2);
  }
  const asOf = new Date(asOfRaw).toISOString();

  const db = databaseName(process.env.DATABASE_URL);
  if (db !== SCRATCH_DATABASE && !values["allow-non-scratch"]) {
    console.error(
      `replay:capture refuses to run against database "${db ?? "unknown"}". Point DATABASE_URL at the ` +
        `${SCRATCH_DATABASE} scratch database (or pass --allow-non-scratch for a local dev database).`,
    );
    process.exit(2);
  }

  const { organizationIds, records } = await captureReplay(getPrismaClient(), asOf, values.org);
  writeFileSync(
    values.out,
    serializeReplay(
      { type: "header", formatVersion: REPLAY_FORMAT_VERSION, gitSha: gitSha(), asOf, organizationIds },
      records,
    ),
  );

  const commitments = records.filter((r) => r.type === "commitment").length;
  const drift = summarizeDrift(records);
  console.log(
    `Captured ${commitments} commitment(s) and ${records.length - commitments} case(s) across ` +
      `${organizationIds.length} organization(s) as of ${asOf} -> ${values.out}`,
  );
  console.log(
    `C-class drift (recomputed vs persisted): ${drift.statusDrift} status, ${drift.breachedAtDrift} breachedAt ` +
      `of ${drift.commitments} commitment(s)`,
  );
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main()
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      console.error("replay-capture failed:", error);
      process.exit(1);
    });
}
