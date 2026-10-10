import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Session } from "next-auth";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isGuardOverrideOperator, requireGuardOverrideOperator } from "@/lib/authz";

const session = (email: string) => ({ user: { email } }) as unknown as Session;
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = { a: process.env.PLATFORM_ADMIN_EMAILS, g: process.env.GUARD_OVERRIDE_OPERATOR_EMAILS };
});
afterEach(() => {
  for (const [k, key] of [["a", "PLATFORM_ADMIN_EMAILS"], ["g", "GUARD_OVERRIDE_OPERATOR_EMAILS"]] as const) {
    if (saved[k] === undefined) delete process.env[key];
    else process.env[key] = saved[k];
  }
});

describe("support-assisted guard override permission (U6)", () => {
  it("is a separate permission: a platform operator alone is refused with 403", async () => {
    process.env.PLATFORM_ADMIN_EMAILS = "ops@elapsed.test";
    delete process.env.GUARD_OVERRIDE_OPERATOR_EMAILS;
    expect(isGuardOverrideOperator(session("ops@elapsed.test"))).toBe(false);
    expect(requireGuardOverrideOperator(session("ops@elapsed.test"))?.status).toBe(403);
  });

  it("an empty value means nobody (the Compose default)", () => {
    process.env.PLATFORM_ADMIN_EMAILS = "ops@elapsed.test";
    process.env.GUARD_OVERRIDE_OPERATOR_EMAILS = "";
    expect(isGuardOverrideOperator(session("ops@elapsed.test"))).toBe(false);
  });

  it("needs both lists, matched case-insensitively and trimmed", () => {
    process.env.PLATFORM_ADMIN_EMAILS = "ops@elapsed.test, Other@Elapsed.test";
    process.env.GUARD_OVERRIDE_OPERATOR_EMAILS = " OPS@elapsed.test ,x@y.test";
    expect(isGuardOverrideOperator(session("ops@elapsed.test"))).toBe(true);
    expect(requireGuardOverrideOperator(session("ops@elapsed.test"))).toBeNull();
    expect(isGuardOverrideOperator(session("other@elapsed.test"))).toBe(false); // platform operator, not on the override list
    expect(isGuardOverrideOperator(session("x@y.test"))).toBe(false); // on the override list, not a platform operator
  });

  it("no session is refused (401)", () => {
    expect(requireGuardOverrideOperator(null)?.status).toBe(401);
  });
});

describe("docker-compose.yml wiring of the Custom REST settings", () => {
  const compose = readFileSync(fileURLToPath(new URL("../../../docker-compose.yml", import.meta.url)), "utf8");
  const service = (name: string): string => {
    const match = new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-z-]+:\\n|^volumes:|$(?![\\s\\S]))`, "m").exec(compose);
    if (!match) throw new Error(`service ${name} not found`);
    return match[1]!;
  };

  it("passes the override allowlist to the web service only, empty by default", () => {
    expect(service("web")).toContain("GUARD_OVERRIDE_OPERATOR_EMAILS: ${GUARD_OVERRIDE_OPERATOR_EMAILS:-}");
    expect(service("worker")).not.toContain("GUARD_OVERRIDE_OPERATOR_EMAILS");
  });

  it("passes the live-case ceiling to the worker only, defaulting to 1000", () => {
    expect(service("worker")).toContain("CUSTOM_PROVIDER_LIVE_CASE_CEILING: ${CUSTOM_PROVIDER_LIVE_CASE_CEILING:-1000}");
    expect(service("web")).not.toContain("CUSTOM_PROVIDER_LIVE_CASE_CEILING");
  });

  it("never enables private hosts in the production compose file", () => {
    expect(compose).not.toContain("CUSTOM_PROVIDER_ALLOW_PRIVATE_HOSTS");
  });
});
