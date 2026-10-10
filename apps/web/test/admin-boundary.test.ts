/**
 * N4.6 (and N4.2's append-only guarantee): the platform-admin code is
 * unreachable from tenant code, and the audit log has no update or delete
 * path. Reads source files only; no database.
 *
 * Why a test: authorization (`isPlatformOperator`) protects each route, but
 * the thing that keeps a tenant surface from ever *rendering* or *calling*
 * platform-level code is that it cannot import it. This fails the moment a
 * tenant module imports an admin module, even if the call would be denied.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const WEB_SRC = join(ROOT, "apps/web/src");

function walk(dir: string, files: string[] = []): string[] {
  if (!existsSync(dir)) return files;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name === "dist" || name === "generated") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, files);
    else if (/\.(ts|tsx)$/.test(name)) files.push(path);
  }
  return files;
}

const rel = (path: string) => relative(ROOT, path).split("\\").join("/");
const webRel = (path: string) => relative(WEB_SRC, path).split("\\").join("/");

/** Every source file that ships: the web app, the worker and the packages. Tests are not scanned. */
const SOURCE_DIRS = [
  WEB_SRC,
  join(ROOT, "apps/worker/src"),
  ...readdirSync(join(ROOT, "packages")).map((name) => join(ROOT, "packages", name, "src")),
];
const SOURCE_FILES = SOURCE_DIRS.flatMap((dir) => walk(dir));
const WEB_FILES = walk(WEB_SRC);

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Static and dynamic import specifiers of a file. */
function importsOf(file: string): string[] {
  const source = stripComments(readFileSync(file, "utf8"));
  const specs: string[] = [];
  for (const m of source.matchAll(/(?:import|export)\s[^"']*?from\s*["']([^"']+)["']/g)) specs.push(m[1]!);
  for (const m of source.matchAll(/import\s*\(\s*["']([^"']+)["']\s*\)/g)) specs.push(m[1]!);
  for (const m of source.matchAll(/^import\s+["']([^"']+)["']/gm)) specs.push(m[1]!);
  return specs;
}

/** Resolves an import of a web file to a path under `apps/web/src` (no extension), or null if it is a package. */
function resolveWebImport(fromFile: string, spec: string): string | null {
  if (spec.startsWith("@/")) return join(WEB_SRC, spec.slice(2));
  if (spec.startsWith("@modules/")) return join(WEB_SRC, "modules", spec.slice("@modules/".length));
  if (spec.startsWith(".")) return resolve(dirname(fromFile), spec);
  return null;
}

// ---- What is admin-only, and who may import it ---------------------------------

/** Paths (relative to `apps/web/src`, no extension) that only the admin area may import. */
function isAdminOnly(path: string): boolean {
  return (
    /^lib\/admin-[^/]+$/.test(path) ||
    path === "actions/admin" ||
    path === "actions/admin-client" ||
    path === "components/admin" ||
    path.startsWith("components/admin/") ||
    path === "modules/admin" ||
    path.startsWith("modules/admin/")
  );
}

/** Where admin-only code may be imported from (relative to `apps/web/src`). */
function isAdminArea(path: string): boolean {
  return (
    path.startsWith("app/(admin)/") ||
    path.startsWith("modules/admin/") ||
    path.startsWith("components/admin/") ||
    path.startsWith("app/api/admin/") ||
    // The existing operator-only worker-settings API route (audited since N4.2).
    path.startsWith("app/api/settings/worker/") ||
    // Admin files import each other.
    /^lib\/admin-[^/]+\.tsx?$/.test(path) ||
    /^actions\/admin(-client)?\.tsx?$/.test(path)
  );
}

describe("admin boundary (N4.6)", () => {
  it("scans a meaningful set of files", () => {
    expect(WEB_FILES.length).toBeGreaterThan(100);
    expect(WEB_FILES.map(webRel)).toContain("actions/admin.ts");
    expect(WEB_FILES.map(webRel)).toContain("lib/admin-audit.ts");
  });

  it("admin-only modules are imported only from the admin area", () => {
    const violations: string[] = [];
    for (const file of WEB_FILES) {
      const from = webRel(file);
      if (isAdminArea(from)) continue;
      for (const spec of importsOf(file)) {
        const target = resolveWebImport(file, spec);
        if (target && isAdminOnly(relative(WEB_SRC, target).split("\\").join("/"))) {
          violations.push(`${from} imports ${spec}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("the tenant `Actions` barrel does not include any admin read", () => {
    const barrel = readFileSync(join(WEB_SRC, "actions/index.ts"), "utf8");
    expect(stripComments(barrel)).not.toMatch(/admin|operator/i);
  });

  it("no other package or app imports the web app's admin code", () => {
    const offenders = SOURCE_FILES.filter((file) => !file.startsWith(WEB_SRC)).filter((file) =>
      importsOf(file).some((spec) => /apps\/web|admin-(audit|auth|tenants|tenant|monitoring)/.test(spec)),
    );
    expect(offenders.map(rel)).toEqual([]);
  });

  it("the old operator routes and modules are gone (only redirects remain)", () => {
    expect(existsSync(join(WEB_SRC, "app/(main)/operator"))).toBe(false);
    expect(existsSync(join(WEB_SRC, "modules/operator"))).toBe(false);
    expect(existsSync(join(WEB_SRC, "actions/operator.ts"))).toBe(false);
    expect(existsSync(join(WEB_SRC, "lib/operator-monitoring-data.ts"))).toBe(false);

    const config = readFileSync(join(ROOT, "apps/web/next.config.mjs"), "utf8");
    expect(config).toMatch(/source:\s*"\/operator",\s*destination:\s*"\/admin"/);
    expect(config).toMatch(/source:\s*"\/operator\/monitoring",\s*destination:\s*"\/admin\/monitoring"/);
  });

  it("no tenant surface renders worker or monitoring controls, or knows the admin URLs", () => {
    const offenders: string[] = [];
    for (const file of WEB_FILES) {
      const from = webRel(file);
      if (isAdminArea(from)) continue;
      const source = stripComments(readFileSync(file, "utf8"));
      // The route handlers themselves live under app/api and are the allowed exception above.
      if (/\/api\/settings\/worker|\/api\/admin\b|["'`]\/admin\b|getMonitoringData|MonitoringView|IntervalSettingRow/.test(source)) {
        offenders.push(from);
      }
    }
    // `worker-settings.ts` defines `getMonitoringData` (operator-gated) and `worker-settings-data.ts` its read model.
    expect(offenders.sort()).toEqual(
      ["actions/worker-settings.ts", "components/layout/nav-items.ts"].sort(),
    );
  });

  it("every admin page is a thin wrapper around an admin module", () => {
    const pages = WEB_FILES.filter((file) => /app\/\(admin\)\/.*\/page\.tsx$/.test(rel(file)));
    expect(pages.length).toBeGreaterThanOrEqual(5);
    for (const page of pages) {
      const specs = importsOf(page);
      expect(specs.every((spec) => spec.startsWith("@modules/admin/") || spec === "@/lib/seo/metadata"), `${webRel(page)} imports ${specs.join(", ")}`).toBe(true);
    }
  });

  it("the admin layout is guarded, and every admin read goes through the guard first", () => {
    const layout = readFileSync(join(WEB_SRC, "app/(admin)/admin/layout.tsx"), "utf8");
    expect(layout).toContain("requirePlatformAdminPage()");

    const actions = readFileSync(join(WEB_SRC, "actions/admin.ts"), "utf8");
    const methods = [...actions.matchAll(/^ {2}async (\w+)\([^)]*\)[^{]*\{\n([\s\S]*?)\n {2}\},?$/gm)];
    expect(methods.map((m) => m[1])).toEqual([
      "getOverview",
      "getUsage",
      "getIntegrations",
      "getTenants",
      "getTenantDetail",
      "getAuditLog",
      "getBillingOverview",
      "getTenantBilling",
    ]);
    for (const [, name, body] of methods) {
      expect(body!.trimStart().startsWith("const { user } = await requirePlatformAdminPage()") ||
        body!.trimStart().startsWith("await requirePlatformAdminPage()"), `${name} must call the guard first`).toBe(true);
    }
  });
});

// ---- The audit log is append-only (N4.2) ---------------------------------------

describe("admin audit log is append-only (N4.2)", () => {
  it("only lib/admin-audit.ts touches the AdminAuditLog delegate", () => {
    const users = SOURCE_FILES.filter((file) => /adminAuditLog/.test(readFileSync(file, "utf8"))).map(rel);
    expect(users).toEqual(["apps/web/src/lib/admin-audit.ts"]);
  });

  it("that module uses only create and findMany on it", () => {
    const source = stripComments(readFileSync(join(WEB_SRC, "lib/admin-audit.ts"), "utf8"));
    const used = [...source.matchAll(/adminAuditLog\s*\.\s*(\w+)/g)].map((m) => m[1]).sort();
    expect(used).toEqual(["create", "findMany"]);
    expect(source).not.toMatch(/adminAuditLog\s*\.\s*(update|updateMany|upsert|delete|deleteMany|createMany)\b/);
  });

  it("no source file or migration updates, deletes or truncates the table in SQL", () => {
    const statement = /(UPDATE|DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?|DROP\s+TABLE|ALTER\s+TABLE)\s+(?:ONLY\s+)?"?(?:public"?\.)?"?admin_audit_logs/i;
    const offenders = SOURCE_FILES.filter((file) => statement.test(readFileSync(file, "utf8"))).map(rel);

    const migrations = join(ROOT, "packages/db/prisma/migrations");
    for (const dir of readdirSync(migrations)) {
      const sql = join(migrations, dir, "migration.sql");
      if (existsSync(sql) && statement.test(readFileSync(sql, "utf8"))) offenders.push(rel(sql));
    }
    expect(offenders).toEqual([]);
  });

  it("the audit module exports only a writer and a reader", () => {
    const source = readFileSync(join(WEB_SRC, "lib/admin-audit.ts"), "utf8");
    const exported = [...source.matchAll(/^export (?:async )?(?:function|const) (\w+)/gm)].map((m) => m[1]).sort();
    expect(exported).toEqual(["listAdminAuditLog", "recordAdminAudit"]);
  });
});
