/**
 * N4.1 acceptance: a member or an org owner who is not a platform operator
 * gets 404 on every `/admin` page read and 403 on every admin API route, and
 * nothing is queried or written for them.
 *
 * The API routes are discovered from disk, so a new admin
 * route is covered the moment it exists; it cannot be forgotten here.
 * Fully mocked, no Postgres: every check runs before anything touches the
 * database, and the test asserts exactly that.
 */
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { Session } from "next-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ctx = vi.hoisted(() => ({
  session: null as Session | null,
  getPrismaClient: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
}));
vi.mock("next-auth", () => ({ getServerSession: vi.fn(async () => ctx.session) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/request-context", () => ({
  getRequestContext: vi.fn(async () => {
    if (!ctx.session) throw new Error("NEXT_REDIRECT:/sign-in");
    return { session: ctx.session, userId: "u", organizationId: "org_1", role: ctx.session.user.role };
  }),
}));
vi.mock("@sla/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sla/db")>()),
  getPrismaClient: ctx.getPrismaClient,
}));

function sessionFor(email: string, role: "owner" | "member"): Session {
  return {
    expires: new Date(Date.now() + 3_600_000).toISOString(),
    user: { id: "user-1", organizationId: "org-1", email, emailVerifiedAt: new Date(), name: null, image: null, role, createdAt: new Date() },
  } as Session;
}

const OPERATOR = "ops@watchtower.test";

beforeEach(() => {
  process.env.PLATFORM_ADMIN_EMAILS = OPERATOR;
  ctx.session = null;
  ctx.getPrismaClient.mockReset();
  ctx.getPrismaClient.mockImplementation(() => {
    throw new Error("the database must not be reached");
  });
});

// ---- Pages and server-side reads -> 404 ------------------------------------------

describe("admin pages and reads: 404 for everyone but a platform operator", () => {
  const reads: [string, (actions: typeof import("../src/actions/admin").AdminActions) => Promise<unknown>][] = [
    ["getOverview", (a) => a.getOverview()],
    ["getTenants", (a) => a.getTenants()],
    ["getTenantDetail", (a) => a.getTenantDetail("org_2")],
    ["getAuditLog", (a) => a.getAuditLog(null)],
  ];

  for (const role of ["owner", "member"] as const) {
    for (const [name, call] of reads) {
      it(`${name}: a ${role} who is not an operator gets not-found, before any query`, async () => {
        ctx.session = sessionFor("someone@tenant.test", role);
        const { AdminActions } = await import("../src/actions/admin");

        await expect(call(AdminActions)).rejects.toThrow("NEXT_NOT_FOUND");
        expect(ctx.getPrismaClient).not.toHaveBeenCalled();
      });
    }
  }

  it("an org owner is not made an operator by their role", async () => {
    ctx.session = sessionFor("owner@tenant.test", "owner");
    const { requirePlatformAdminPage } = await import("../src/lib/admin-auth");
    await expect(requirePlatformAdminPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("a signed-out visitor is sent to sign in, not shown the admin area", async () => {
    ctx.session = null;
    const { AdminActions } = await import("../src/actions/admin");
    await expect(AdminActions.getTenants()).rejects.toThrow("NEXT_REDIRECT:/sign-in");
    expect(ctx.getPrismaClient).not.toHaveBeenCalled();
  });

  it("the operator is let through, matched case-insensitively, and reaches the database", async () => {
    process.env.PLATFORM_ADMIN_EMAILS = "Ops@Watchtower.TEST";
    ctx.session = sessionFor(OPERATOR, "member");
    ctx.getPrismaClient.mockReturnValue({
      adminAuditLog: { findMany: vi.fn(async () => []) },
      organization: { findMany: vi.fn(async () => []) },
    });
    const { AdminActions } = await import("../src/actions/admin");

    await expect(AdminActions.getAuditLog(null)).resolves.toEqual({ rows: [], nextCursor: null });
  });

  it("the admin layout guard is the same gate", async () => {
    ctx.session = sessionFor("owner@tenant.test", "owner");
    const { default: AdminLayout } = await import("../src/app/(admin)/admin/layout");
    await expect(AdminLayout({ children: null })).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

// ---- API routes -> 401 / 403 -----------------------------------------------------

type Handler = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response> | Response;
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

const API_DIR = fileURLToPath(new URL("../src/app/api/", import.meta.url));

/** Every `route.ts` under `dir`, as a path relative to `app/api`. */
function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return routeFiles(path);
    return name === "route.ts" ? [relative(API_DIR, path).split("\\").join("/")] : [];
  });
}

// The worker-settings API predates `/api/admin` but is operator-only and audited all the same.
const ALL_ROUTES = [...routeFiles(join(API_DIR, "admin")).map((p) => `admin/${p.replace(/^admin\//, "")}`), "settings/worker/route.ts"];
const loadRoute = (path: string) => import(/* @vite-ignore */ join(API_DIR, path)) as Promise<Record<string, Handler | undefined>>;

describe("admin API routes: 401 signed out, 403 for a non-operator, nothing written", () => {
  it("finds the admin routes on disk", () => {
    expect(ALL_ROUTES).toEqual(
      expect.arrayContaining([
        "admin/tenants/[organizationId]/plan/route.ts",
        "admin/integrations/[integrationId]/route.ts",
        "settings/worker/route.ts",
      ]),
    );
  });

  for (const path of ALL_ROUTES) {
    const name = path.replace("/route.ts", "");

    it(`${name}: every handler denies signed-out (401) and non-operators (403) without touching the database`, async () => {
      const mod = await loadRoute(path);
      const handlers = METHODS.flatMap((method) => (mod[method] ? [[method, mod[method]!] as const] : []));
      expect(handlers.length, `${name} exports no handler`).toBeGreaterThan(0);

      for (const [method, handler] of handlers) {
        const request = () =>
          new Request("http://localhost/api/admin", {
            method,
            headers: { "content-type": "application/json" },
            body: method === "GET" ? undefined : JSON.stringify({ action: "pause_polling", planStatus: "active" }),
          });
        const context = { params: Promise.resolve({ organizationId: "org_2", integrationId: "int_1" }) };

        ctx.session = null;
        expect((await handler(request(), context)).status, `${method} signed out`).toBe(401);

        for (const role of ["owner", "member"] as const) {
          ctx.session = sessionFor("someone@tenant.test", role);
          expect((await handler(request(), context)).status, `${method} as ${role}`).toBe(403);
        }
      }
      expect(ctx.getPrismaClient).not.toHaveBeenCalled();
    });
  }
});
