import { parseArgs } from "node:util";
import { deleteOrganization } from "../organization-deletion";

/**
 * Deletes one organization and everything it owns. Describes only, unless
 * `--execute` is given. Runbook: `docs/data-retention-and-on-call.md`,
 * "Deleting an organization".
 *
 *   tsx src/scripts/delete-organization.ts --organization-id=<id> --database=<name>
 *   tsx src/scripts/delete-organization.ts --organization-id=<id> --database=<name> \
 *     --confirm-name="<exact name>" --actor=<operator email> --execute
 *
 * Prints one JSON report. Exit 0: dry run, deleted, or already deleted.
 * Exit 1: refused, not found, or failed (nothing deleted; see `followUps`).
 */
const { values } = parseArgs({
  options: {
    "organization-id": { type: "string" },
    database: { type: "string" },
    "confirm-name": { type: "string" },
    actor: { type: "string" },
    execute: { type: "boolean", default: false },
    "lease-wait-ms": { type: "string" },
    "lock-timeout-ms": { type: "string" },
    "statement-timeout-ms": { type: "string" },
  },
  strict: true,
  allowPositionals: false,
});

const fail = (message: string) => {
  console.error(`delete-organization: ${message}`);
  process.exit(1);
};
const number = (value: string | undefined, name: string) => {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) fail(`--${name} must be a positive number of milliseconds`);
  return n;
};

if (!values["organization-id"]) fail("--organization-id is required (there is no default)");
if (!values.database) fail("--database is required: the name of the database DATABASE_URL must point at");
if (!process.env.DATABASE_URL) fail("DATABASE_URL is not set");

const report = await deleteOrganization({
  connectionString: process.env.DATABASE_URL!,
  organizationId: values["organization-id"]!,
  expectDatabase: values.database!,
  confirmName: values["confirm-name"],
  actorEmail: values.actor,
  execute: values.execute,
  leaseWaitMs: number(values["lease-wait-ms"], "lease-wait-ms"),
  lockTimeoutMs: number(values["lock-timeout-ms"], "lock-timeout-ms"),
  statementTimeoutMs: number(values["statement-timeout-ms"], "statement-timeout-ms"),
  log: (event, fields) => console.error(JSON.stringify({ event, ...fields })),
});

console.log(JSON.stringify(report, null, 2));
process.exit(["dry_run", "deleted", "already_deleted"].includes(report.status) ? 0 : 1);
