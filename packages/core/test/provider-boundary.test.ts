/**
 * N1.4 — architecture / import-boundary ratchet (V14). Reads package.json
 * files and source; no DB.
 *
 * The provider-neutral core (N1) moves every provider decision out of
 * `@sla/core`, `@sla/commitments` and `@sla/notifications` and behind the
 * adapter packages. This test pins that boundary:
 *
 *   1. the three domain packages depend on no provider package;
 *   2. no provider package depends on `@sla/commitments` (V8);
 *   3. the domain packages' source holds no provider-name string literal;
 *   4. the Jira, Linear and GitHub packages hold no Zendesk/Intercom host
 *      literal and no `provider: "zendesk" | "intercom"` lookup (V9).
 *
 * It is a ratchet. `ALLOWLIST` lists today's violations, each tagged with the
 * N1 task that removes it. The test fails on a NEW violation, and also when an
 * allowlisted entry no longer violates, so the list can only shrink. N1 exits
 * with an empty allowlist, except entries explicitly deferred to N2.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

const PROVIDER_PACKAGES = ["zendesk", "intercom", "jira", "linear", "github"] as const;
const DOMAIN_PACKAGES = ["core", "commitments", "notifications"] as const;
const TRACKER_PACKAGES = ["jira", "linear", "github"] as const;

type Rule =
  | "domain-depends-on-provider"
  | "provider-depends-on-commitments"
  | "provider-literal-in-domain"
  | "ticket-source-host-or-lookup-in-tracker";

interface Violation {
  rule: Rule;
  /** Repo-relative path of the offending file. */
  file: string;
}

interface AllowedViolation extends Violation {
  /** The N1 (or N2) task that removes it. */
  removedBy: string;
}

/**
 * Today's violations. Remove an entry in the same change that fixes it: the
 * test fails if a listed violation is gone.
 */
const ALLOWLIST: AllowedViolation[] = [
  // The Zendesk package imports `@sla/commitments`.
  { rule: "provider-depends-on-commitments", file: "packages/zendesk/package.json", removedBy: "N1.12" },
  // Jira and Linear resolve links with a Zendesk host check and a Zendesk integration lookup.
  { rule: "ticket-source-host-or-lookup-in-tracker", file: "packages/jira/src/correlate.ts", removedBy: "N1.13" },
  { rule: "ticket-source-host-or-lookup-in-tracker", file: "packages/linear/src/correlate.ts", removedBy: "N1.13" },
];

// ---- Helpers --------------------------------------------------------------------

/**
 * Removes `//` and block comments, leaving string and template literals
 * intact and preserving newlines. Enough for this codebase's TypeScript; it
 * does not model regex literals, which contain no quote characters here.
 */
function stripComments(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const c = source[i]!;
    const next = source[i + 1];
    if (c === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i++;
    } else if (c === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        if (source[i] === "\n") out += "\n";
        i++;
      }
      i += 2;
    } else if (c === '"' || c === "'" || c === "`") {
      out += c;
      i++;
      while (i < source.length && source[i] !== c) {
        if (source[i] === "\\") {
          out += source[i]! + (source[i + 1] ?? "");
          i += 2;
        } else {
          out += source[i];
          i++;
        }
      }
      out += source[i] ?? "";
      i++;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) files.push(...sourceFiles(path));
    else if (/\.(ts|tsx)$/.test(entry) && !/\.d\.ts$/.test(entry)) files.push(path);
  }
  return files.sort();
}

const repoPath = (absolute: string) => relative(ROOT, absolute).split("\\").join("/");

function dependencyNames(packageName: string): string[] {
  const pkg = JSON.parse(readFileSync(join(ROOT, "packages", packageName, "package.json"), "utf8")) as Record<
    string,
    Record<string, string> | undefined
  >;
  return ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"].flatMap((field) =>
    Object.keys(pkg[field] ?? {}),
  );
}

const PROVIDER_LITERAL = new RegExp(`["'\`](${PROVIDER_PACKAGES.join("|")})["'\`]`);
const TICKET_SOURCE_HOST = /\b(zendesk|intercom)\.com\b/;
const TICKET_SOURCE_LOOKUP = /\bprovider\s*:\s*["'`](zendesk|intercom)["'`]/;

function scanSources(packages: readonly string[], test: (code: string) => boolean): string[] {
  return packages.flatMap((name) =>
    sourceFiles(join(ROOT, "packages", name, "src"))
      .filter((file) => test(stripComments(readFileSync(file, "utf8"))))
      .map(repoPath),
  );
}

function findViolations(): Violation[] {
  const violations: Violation[] = [];

  for (const name of DOMAIN_PACKAGES) {
    const providerDeps = dependencyNames(name).filter((dep) =>
      PROVIDER_PACKAGES.some((p) => dep === `@sla/${p}`),
    );
    if (providerDeps.length > 0) {
      violations.push({ rule: "domain-depends-on-provider", file: `packages/${name}/package.json` });
    }
  }

  for (const name of PROVIDER_PACKAGES) {
    if (dependencyNames(name).includes("@sla/commitments")) {
      violations.push({ rule: "provider-depends-on-commitments", file: `packages/${name}/package.json` });
    }
  }

  for (const file of scanSources(DOMAIN_PACKAGES, (code) => PROVIDER_LITERAL.test(code))) {
    violations.push({ rule: "provider-literal-in-domain", file });
  }

  for (const file of scanSources(
    TRACKER_PACKAGES,
    (code) => TICKET_SOURCE_HOST.test(code) || TICKET_SOURCE_LOOKUP.test(code),
  )) {
    violations.push({ rule: "ticket-source-host-or-lookup-in-tracker", file });
  }

  return violations;
}

const key = (v: Violation) => `${v.rule} :: ${v.file}`;

// ---- Tests ------------------------------------------------------------------------

describe("provider boundary ratchet", () => {
  it("scans real files (guards against a vacuous pass)", () => {
    for (const name of [...DOMAIN_PACKAGES, ...TRACKER_PACKAGES]) {
      expect(sourceFiles(join(ROOT, "packages", name, "src")).length, name).toBeGreaterThan(0);
    }
    for (const name of [...DOMAIN_PACKAGES, ...PROVIDER_PACKAGES]) {
      expect(dependencyNames(name), name).toEqual(expect.any(Array));
    }
  });

  it("has no violation outside the allowlist", () => {
    const allowed = new Set(ALLOWLIST.map(key));
    const added = findViolations()
      .filter((v) => !allowed.has(key(v)))
      .map(key);
    expect(added, "New provider-boundary violation(s). Fix them; do not extend the allowlist.").toEqual([]);
  });

  it("has no stale allowlist entry", () => {
    const current = new Set(findViolations().map(key));
    const stale = ALLOWLIST.filter((a) => !current.has(key(a))).map((a) => `${key(a)} (removed by ${a.removedBy})`);
    expect(stale, "These entries no longer violate. Remove them from ALLOWLIST.").toEqual([]);
  });

  it("lists each violation once", () => {
    const keys = ALLOWLIST.map(key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("stripComments", () => {
  it("drops line and block comments but keeps line count", () => {
    const code = 'const a = 1; // "zendesk"\n/* "jira"\n"linear" */\nconst b = 2;';
    const stripped = stripComments(code);
    expect(stripped).not.toMatch(PROVIDER_LITERAL);
    expect(stripped.split("\n")).toHaveLength(code.split("\n").length);
  });

  it("keeps string contents, including comment markers inside strings", () => {
    expect(stripComments('const url = "https://x.zendesk.com/a"; // trailing')).toBe(
      'const url = "https://x.zendesk.com/a"; ',
    );
    expect(stripComments("const s = `a//b ${x} \\` c`;")).toBe("const s = `a//b ${x} \\` c`;");
  });

  it("matches provider literals in code and not in comments", () => {
    expect(PROVIDER_LITERAL.test(stripComments('if (x === "zendesk") {}'))).toBe(true);
    expect(PROVIDER_LITERAL.test(stripComments('// x === "zendesk"'))).toBe(false);
    expect(TICKET_SOURCE_LOOKUP.test(stripComments('where: { provider: "intercom" }'))).toBe(true);
    expect(TICKET_SOURCE_HOST.test(stripComments("`${s}.zendesk.com`"))).toBe(true);
  });
});

describe("NormalizedEvent writers", () => {
  it("every create / createMany sets sourceRole (N1.5)", () => {
    const packagesDir = join(ROOT, "packages");
    const files = readdirSync(packagesDir).flatMap((name) => sourceFiles(join(packagesDir, name, "src")));
    const call = /normalizedEvent\.create(?:Many)?\(/g;
    let sites = 0;
    const missing: string[] = [];
    for (const file of files) {
      const code = stripComments(readFileSync(file, "utf8"));
      for (const match of code.matchAll(call)) {
        sites += 1;
        // The write's `data` object sits right after the call; a role set further away is not this write's.
        const window = code.slice(match.index, match.index + 700);
        // `createMany({ data: rows })` builds its rows elsewhere in the file (the seed script).
        const dataIsVariable = /^\(\{\s*data:\s*\w+\s*\}\)/.test(code.slice(match.index + match[0].length - 1));
        if (!window.includes("sourceRole") && !(dataIsVariable && code.includes("sourceRole"))) {
          missing.push(`${repoPath(file)}:${code.slice(0, match.index).split("\n").length}`);
        }
      }
    }
    expect(sites).toBeGreaterThanOrEqual(14);
    expect(missing).toEqual([]);
  });
});
