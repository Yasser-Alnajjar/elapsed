import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import {
  compareReplays,
  parseReplay,
  summarizeDrift,
  type ApprovedDifference,
  type CompareResult,
} from "../replay";

/**
 * L1 evaluation replay, compare side (N1.1). Diffs two `replay:capture` files
 * taken at the same `asOf`. Any difference not listed in the `--approved`
 * allowlist is class A (unintended) and makes the exit code 1. Run via
 * `pnpm --filter @sla/commitments replay:compare -- <before.jsonl>
 * <after.jsonl> [--approved <file.json>]`.
 *
 * `--approved` is a JSON array of `{ type, id, fields?, decision? }`. Omit
 * `fields` to approve every field of that record. It is a class-B
 * allowlist: each entry must also be recorded in the plan's §13. The
 * allowlist and the captures hold customer data and stay out of git.
 */

export function formatReport(result: CompareResult, before: string, after: string): string {
  const lines = [
    `Compared ${result.recordsCompared} record(s) present in both captures (${before} -> ${after}).`,
    `Differences: ${result.differences.length} (class A unapproved: ${result.unapproved}, class B approved: ${result.approved})`,
  ];
  const fields = Object.entries(result.byField).sort(([a], [b]) => a.localeCompare(b));
  if (fields.length > 0) {
    lines.push("Per field:");
    for (const [field, n] of fields) lines.push(`  ${field}: ${n.unapproved} unapproved, ${n.approved} approved`);
  }
  return lines.join("\n");
}

function main(): number {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2).filter((a) => a !== "--"),
    options: { approved: { type: "string" }, verbose: { type: "boolean", default: false } },
    allowPositionals: true,
  });
  const [beforePath, afterPath] = positionals;
  if (!beforePath || !afterPath || positionals.length !== 2) {
    console.error("usage: replay:compare -- <before.jsonl> <after.jsonl> [--approved <file.json>] [--verbose]");
    return 2;
  }

  const before = parseReplay(readFileSync(beforePath, "utf8"));
  const after = parseReplay(readFileSync(afterPath, "utf8"));
  if (before.header.asOf !== after.header.asOf) {
    console.error(
      `The captures use different asOf values (${before.header.asOf} vs ${after.header.asOf}); ` +
        "a comparison across times is meaningless. Re-capture at the same asOf.",
    );
    return 2;
  }
  const approved: ApprovedDifference[] = values.approved
    ? (JSON.parse(readFileSync(values.approved, "utf8")) as ApprovedDifference[])
    : [];

  const result = compareReplays(before.records, after.records, approved);
  console.log(`before: ${before.header.gitSha}  after: ${after.header.gitSha}  asOf: ${before.header.asOf}`);
  console.log(formatReport(result, beforePath, afterPath));
  for (const [label, capture] of [["before", before], ["after", after]] as const) {
    const drift = summarizeDrift(capture.records);
    console.log(
      `C-class drift (${label}): ${drift.statusDrift} status, ${drift.breachedAtDrift} breachedAt of ${drift.commitments} commitment(s)`,
    );
  }
  if (values.verbose) {
    for (const d of result.differences) {
      console.log(
        `${d.approved ? "B" : "A"} ${d.type} ${d.id} ${d.field}: ${JSON.stringify(d.before)} -> ${JSON.stringify(d.after)}`,
      );
    }
  }
  return result.unapproved > 0 ? 1 : 0;
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  try {
    process.exit(main());
  } catch (error) {
    console.error("replay-compare failed:", error);
    process.exit(2);
  }
}
