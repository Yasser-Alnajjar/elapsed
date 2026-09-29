/**
 * H-10 guard: every Prisma model must declare how it is tenant-scoped.
 *
 * A new model with no entry fails this test, so "tenant isolation covers every
 * model" cannot silently go stale. This is a static check of the schema: it
 * proves each model has a path to an organization (a direct `organizationId`,
 * or a foreign key to a parent that has one). It does NOT prove that every
 * query filters on that path; the behavioural proof is
 * `tenant-isolation.test.ts` (real Postgres). The last test here fails when a
 * model is not even seeded by that suite, so a new model cannot skip it.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const schema = readFileSync(
  fileURLToPath(new URL("../../../packages/db/prisma/schema.prisma", import.meta.url)),
  "utf8",
);

type Scope =
  | { kind: "self" }
  | { kind: "direct" } // has organizationId
  | { kind: "via"; fk: string; parent: string } // scoped through a parent row
  | { kind: "global" }; // no tenant; operator-only

const SCOPES: Record<string, Scope> = {
  Organization: { kind: "self" },
  User: { kind: "direct" },
  OrganizationInvitation: { kind: "direct" },
  Integration: { kind: "direct" },
  Customer: { kind: "direct" },
  Case: { kind: "direct" },
  SLAPolicy: { kind: "direct" },
  SlaImportSummary: { kind: "direct" },
  BusinessCalendar: { kind: "direct" },
  SlackIntegration: { kind: "direct" },
  IntegrationConfig: { kind: "direct" },
  OrganizationEmailSettings: { kind: "direct" },
  PasswordResetToken: { kind: "via", fk: "userId", parent: "User" },
  EmailVerificationToken: { kind: "via", fk: "userId", parent: "User" },
  RawEvent: { kind: "via", fk: "integrationId", parent: "Integration" },
  NormalizedEvent: { kind: "via", fk: "caseId", parent: "Case" },
  CaseLink: { kind: "via", fk: "caseId", parent: "Case" },
  LegSpan: { kind: "via", fk: "caseId", parent: "Case" },
  Commitment: { kind: "via", fk: "caseId", parent: "Case" },
  SLAPolicyVersion: { kind: "via", fk: "policyId", parent: "SLAPolicy" },
  BusinessCalendarVersion: { kind: "via", fk: "calendarId", parent: "BusinessCalendar" },
  CommitmentPolicyChange: { kind: "via", fk: "commitmentId", parent: "Commitment" },
  Evaluation: { kind: "via", fk: "commitmentId", parent: "Commitment" },
  Notification: { kind: "via", fk: "commitmentId", parent: "Commitment" },
  NotificationFailure: { kind: "via", fk: "commitmentId", parent: "Commitment" },
  WorkerSettings: { kind: "global" },
};

function parseModels(): Map<string, Set<string>> {
  const models = new Map<string, Set<string>>();
  for (const m of schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
    const [, modelName = "", body = ""] = m;
    const fields = new Set<string>();
    for (const line of body.split("\n")) {
      const f = line.trim().match(/^(\w+)\s+\S+/);
      if (f?.[1] && !line.trim().startsWith("//") && !line.trim().startsWith("@@")) fields.add(f[1]);
    }
    models.set(modelName, fields);
  }
  return models;
}

const isolationSuite = readFileSync(
  fileURLToPath(new URL("./tenant-isolation.test.ts", import.meta.url)),
  "utf8",
);
/** Prisma client accessor for a model: first letter lowercased (`SLAPolicy` -> `sLAPolicy`). */
const accessor = (model: string) => model[0]!.toLowerCase() + model.slice(1);

/** Models the suite creates through a parent's nested `create`, not `prisma.<model>.create`. */
const NESTED_SEED: Record<string, string[]> = {
  NormalizedEvent: ["normalizedEvents: {"],
  CaseLink: ["caseLinks: {"],
  BusinessCalendarVersion: ["versions: {"],
};

describe("tenant scope classification (H-10)", () => {
  const models = parseModels();

  it("classifies every schema model, and only schema models", () => {
    expect([...models.keys()].sort()).toEqual(Object.keys(SCOPES).sort());
  });

  for (const [name, scope] of Object.entries(SCOPES)) {
    it(`${name} has a tenant path (${scope.kind})`, () => {
      const fields = models.get(name)!;
      expect(fields, `${name} missing from schema`).toBeDefined();
      if (scope.kind === "direct") expect(fields.has("organizationId")).toBe(true);
      if (scope.kind === "via") {
        expect(fields.has(scope.fk)).toBe(true);
        expect(models.has(scope.parent)).toBe(true);
      }
      if (scope.kind === "global") expect(fields.has("organizationId")).toBe(false);
    });
  }

  it("every 'via' chain ends at a directly scoped model", () => {
    for (const [name, scope] of Object.entries(SCOPES)) {
      if (scope.kind === "global") continue;
      let cur: Scope = scope;
      let hops = 0;
      while (cur.kind === "via") {
        const next: Scope | undefined = SCOPES[cur.parent];
        if (!next) throw new Error(`${name}: unknown parent ${cur.parent}`);
        cur = next;
        if (++hops > 5) throw new Error(`${name}: chain too long`);
      }
      expect(["direct", "self"]).toContain(cur.kind);
    }
  });

  it("tenant-isolation.test.ts seeds every tenant-scoped model", () => {
    const missing = Object.entries(SCOPES)
      .filter(([, scope]) => scope.kind !== "global")
      .map(([name]) => name)
      .filter(
        (name) =>
          !isolationSuite.includes(`prisma.${accessor(name)}.`) &&
          !(NESTED_SEED[name] ?? []).some((token) => isolationSuite.includes(token)),
      );
    expect(missing).toEqual([]);
  });
});
