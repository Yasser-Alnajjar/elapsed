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
 * N2.9 extends it to the apps and to what provider packages may import:
 *
 *   5. `apps/worker/src` holds no `provider === "…"` comparison outside the
 *      registry (`providers.ts`);
 *   6. provider-name literals in `apps/web/src` appear only in the registry,
 *      the OAuth/env, webhook, concierge, integration-settings and internal
 *      surfaces (and the onboarding wizard, until N5 rebuilds it from the
 *      adapters' capabilities);
 *   7. provider packages import only types and error classes from
 *      `@sla/ingestion`, never the projector;
 *   8. no provider package writes a `Case`, `Customer`, `CustomerIdentity`,
 *      `CaseLink` or `NormalizedEvent` row: the projector does.
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
  | "ticket-source-host-or-lookup-in-tracker"
  | "worker-provider-comparison"
  | "web-provider-literal"
  | "provider-imports-projector"
  | "provider-writes-domain-table";

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
const ALLOWLIST: AllowedViolation[] = [];

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

const WORKER_PROVIDER_COMPARISON = /\bprovider\s*[!=]==\s*["'`](zendesk|jira|intercom|linear|github)["'`]/;

/** Where `apps/web/src` may name a provider (paths relative to it). */
const WEB_PROVIDER_NAME_ALLOWED: RegExp[] = [
  /^lib\/providers\.ts$/,
  /^lib\/[^/]*-env\.ts$/,
  // Concierge export: `lib/*concierge*`, wherever under lib.
  /^lib\/(?:.*\/)?[^/]*concierge[^/]*$/,
  /^modules\/settings\/integrations\//,
  /^modules\/settings\/integration-detail\//,
  /^modules\/internal\//,
  /^app\/api\/integrations\//,
  /^app\/api\/webhooks\//,
  /^app\/api\/concierge\//,
  /^app\/\(main\)\/internal\//,
  // The integration-settings read models and their view types.
  /^lib\/integrations-data\.ts$/,
  /^lib\/integration-detail-data\.ts$/,
  /^lib\/types\/integrations\.ts$/,
  // The onboarding wizard is built around two ticket sources and two trackers.
  // N5 rebuilds it from the adapters' capabilities, which is when these go.
  /^modules\/onboarding\//,
  /^lib\/onboarding-[^/]*\.ts$/,
  /^lib\/types\/onboarding\.ts$/,
  /^actions\/onboarding\.ts$/,
];

/** What a provider package may import from `@sla/ingestion` as a value: error classes and their brand. */
const INGESTION_VALUE_EXPORTS_FOR_PROVIDERS = new Set([
  "ReauthRequiredError",
  "PermissionDeniedError",
  "ProviderUnavailableError",
  "IntegrationNotConfiguredError",
  "PERMISSION_DENIED_BRAND",
]);

const DOMAIN_TABLE_WRITE =
  /\.(?:case|customer|customerIdentity|caseLink|normalizedEvent)\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\(|\bupsertCustomerByIdentity\b/;

/** `@sla/ingestion` imports that are not a type or an error class. */
function badIngestionImports(code: string): string[] {
  const bad: string[] = [];
  for (const match of code.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s+from\s+["']@sla\/ingestion(\/[^"']*)?["']/g)) {
    if (match[3]) bad.push(`deep import @sla/ingestion${match[3]}`);
    if (match[1]) continue; // `import type { … }`
    for (const part of match[2]!.split(",")) {
      const name = part.trim();
      if (name === "" || name.startsWith("type ")) continue;
      if (!INGESTION_VALUE_EXPORTS_FOR_PROVIDERS.has(name.split(/\s+as\s+/)[0]!)) bad.push(name);
    }
  }
  for (const match of code.matchAll(/import\s+(?:\*\s+as\s+\w+|\w+)\s+from\s+["']@sla\/ingestion["']/g)) bad.push(match[0]);
  return bad;
}

function findViolations(): Violation[] {
  const violations: Violation[] = [];

  for (const file of sourceFiles(join(ROOT, "apps", "worker", "src"))) {
    if (file.endsWith("/providers.ts")) continue;
    if (WORKER_PROVIDER_COMPARISON.test(stripComments(readFileSync(file, "utf8")))) {
      violations.push({ rule: "worker-provider-comparison", file: repoPath(file) });
    }
  }

  const webSrc = join(ROOT, "apps", "web", "src");
  for (const file of sourceFiles(webSrc)) {
    const inWeb = relative(webSrc, file).split("\\").join("/");
    if (WEB_PROVIDER_NAME_ALLOWED.some((allowed) => allowed.test(inWeb))) continue;
    if (PROVIDER_LITERAL.test(stripComments(readFileSync(file, "utf8")))) {
      violations.push({ rule: "web-provider-literal", file: repoPath(file) });
    }
  }

  for (const name of PROVIDER_PACKAGES) {
    for (const file of sourceFiles(join(ROOT, "packages", name, "src"))) {
      const code = stripComments(readFileSync(file, "utf8"));
      if (badIngestionImports(code).length > 0) violations.push({ rule: "provider-imports-projector", file: repoPath(file) });
      if (DOMAIN_TABLE_WRITE.test(code)) violations.push({ rule: "provider-writes-domain-table", file: repoPath(file) });
    }
  }

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
    for (const name of [...DOMAIN_PACKAGES, ...PROVIDER_PACKAGES]) {
      expect(sourceFiles(join(ROOT, "packages", name, "src")).length, name).toBeGreaterThan(0);
    }
    expect(sourceFiles(join(ROOT, "apps", "worker", "src")).length).toBeGreaterThan(0);
    expect(sourceFiles(join(ROOT, "apps", "web", "src")).length).toBeGreaterThan(100);
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

describe("N2.9 rule helpers", () => {
  it("flags a provider comparison and an ingestion import that is not a type or an error", () => {
    expect(WORKER_PROVIDER_COMPARISON.test('if (integration.provider === "zendesk") {}')).toBe(true);
    expect(WORKER_PROVIDER_COMPARISON.test('if (provider !== "linear") {}')).toBe(true);
    expect(WORKER_PROVIDER_COMPARISON.test('const x = PROVIDERS[integration.provider];')).toBe(false);

    expect(badIngestionImports('import { projectCanonicalBatch } from "@sla/ingestion";')).toEqual(["projectCanonicalBatch"]);
    expect(badIngestionImports('import { ReauthRequiredError, type ProviderAdapter } from "@sla/ingestion";')).toEqual([]);
    expect(badIngestionImports('import type { projectLinkFacts } from "@sla/ingestion";')).toEqual([]);
    expect(badIngestionImports('import { x } from "@sla/ingestion/src/projector";')).toContain("deep import @sla/ingestion/src/projector");
  });

  it("recognises a domain-table write", () => {
    expect(DOMAIN_TABLE_WRITE.test("await prisma.case.updateMany({})")).toBe(true);
    expect(DOMAIN_TABLE_WRITE.test("await prisma.rawEvent.createMany({})")).toBe(false);
    expect(DOMAIN_TABLE_WRITE.test("prisma.caseLink.findMany({})")).toBe(false);
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
    // The writers are the projector (events, links, sweeps, removals) and the seed scripts.
    expect(sites).toBeGreaterThanOrEqual(4);
    expect(missing).toEqual([]);
  });
});
