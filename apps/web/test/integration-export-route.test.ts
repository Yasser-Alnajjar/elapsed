/**
 * `POST /api/integrations/{provider}/export` — the separate, read-only download
 * of an integration's stored data in a chosen format (a cleanup never makes
 * one). Covers the route's own gates, status mapping and the per-format
 * response; the serializers have their own tests (data-export-serialize.test.ts)
 * and what an export contains, and that it covers exactly what a cleanup deletes,
 * is covered against a real Postgres in integration-data-cleanup.test.ts.
 *
 * `@sla/db`'s Prisma access, `next-auth` and `@/lib/auth` are mocked — no
 * Postgres needed — while the real serializers run over a fake record stream.
 */
import { gunzipSync } from "node:zlib";
import type { Session } from "next-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readStoredZip } from "../src/lib/zip";

const auth = vi.hoisted(() => ({ session: null as Session | null }));
const db = vi.hoisted(() => ({ startIntegrationExport: vi.fn(), startIntegrationReport: vi.fn() }));

vi.mock("next-auth", () => ({ getServerSession: vi.fn(async () => auth.session) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@sla/db", async (importActual) => ({
  ...(await importActual<typeof import("@sla/db")>()),
  getPrismaClient: vi.fn(() => ({})),
  startIntegrationExport: db.startIntegrationExport,
  startIntegrationReport: db.startIntegrationReport,
}));

function sessionFor(organizationId: string, role: "owner" | "member" = "owner"): Session {
  return {
    expires: new Date(Date.now() + 3_600_000).toISOString(),
    user: { id: "user-1", organizationId, email: "owner@tenant.test", emailVerifiedAt: new Date(), name: null, image: null, role, createdAt: new Date() },
  };
}

const NO_BODY = Symbol("no body");

async function post(provider: string, format: string | typeof NO_BODY = NO_BODY) {
  const { POST } = await import("../src/app/api/integrations/[provider]/export/route");
  const body = format === NO_BODY ? undefined : new URLSearchParams({ format });
  return POST(new Request("http://localhost/api", { method: "POST", body }), { params: Promise.resolve({ provider }) });
}

const MANIFEST = { formatVersion: 1, provider: "intercom", scope: {} };

function readyExport() {
  async function* records() {
    yield { type: "integration", data: { id: "int-1", provider: "intercom" } };
    yield { type: "case", data: { id: "c1", subject: "=cmd" } };
    yield { type: "raw_event", data: { id: "r1", payload: { a: 1 } } };
  }
  return { status: "ready", stamp: "20261006T101500Z", manifest: MANIFEST, records: records() };
}

describe("POST /api/integrations/[provider]/export", () => {
  beforeEach(() => {
    vi.resetModules();
    db.startIntegrationExport.mockReset();
    db.startIntegrationReport.mockReset();
    auth.session = null;
  });

  it("rejects a signed-out request with 401 and never starts an export", async () => {
    expect((await post("zendesk")).status).toBe(401);
    expect(db.startIntegrationExport).not.toHaveBeenCalled();
    expect(db.startIntegrationReport).not.toHaveBeenCalled();
  });

  it("rejects a non-owner with 403 — an export carries raw provider records", async () => {
    auth.session = sessionFor("org-1", "member");
    expect((await post("zendesk", "csv")).status).toBe(403);
    expect(db.startIntegrationExport).not.toHaveBeenCalled();
  });

  it("returns 404 for a provider that is not an integration", async () => {
    auth.session = sessionFor("org-1");
    expect((await post("slack")).status).toBe(404);
    expect(db.startIntegrationExport).not.toHaveBeenCalled();
  });

  it("returns 400 for a format it does not offer, before touching the database", async () => {
    auth.session = sessionFor("org-1");
    expect((await post("zendesk", "xlsx")).status).toBe(400);
    expect(db.startIntegrationExport).not.toHaveBeenCalled();
    expect(db.startIntegrationReport).not.toHaveBeenCalled();
  });

  it("returns 404 when the integration has no row, for a backup format and for the report", async () => {
    auth.session = sessionFor("org-1");
    db.startIntegrationExport.mockResolvedValue({ status: "not_found" });
    db.startIntegrationReport.mockResolvedValue({ status: "not_found" });
    expect((await post("jira", "json")).status).toBe(404);
    expect((await post("jira", "pdf")).status).toBe(404);
  });

  it("defaults to a gzip JSON Lines download, for the signed-in organization and user only", async () => {
    auth.session = sessionFor("org-a");
    db.startIntegrationExport.mockResolvedValue(readyExport());
    const response = await post("intercom");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/gzip");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="elapsed-intercom-backup-20261006T101500Z.ndjson.gz"');
    expect(response.headers.get("cache-control")).toBe("no-store");
    const lines = gunzipSync(Buffer.from(await response.arrayBuffer())).toString("utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(lines.map((l) => l.type)).toEqual(["manifest", "integration", "case", "raw_event"]);
    expect(db.startIntegrationExport).toHaveBeenCalledWith(expect.anything(), "org-a", "intercom", { userId: "user-1", email: "owner@tenant.test" }, "ndjson");
  });

  it("serves JSON as one document", async () => {
    auth.session = sessionFor("org-a");
    db.startIntegrationExport.mockResolvedValue(readyExport());
    const response = await post("intercom", "json");

    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="elapsed-intercom-backup-20261006T101500Z.json"');
    const doc = JSON.parse(await response.text());
    expect(doc.integration).toEqual({ id: "int-1", provider: "intercom" });
    expect(doc.cases).toEqual([{ id: "c1", subject: "=cmd" }]);
    expect(doc.rawEvents).toEqual([{ id: "r1", payload: { a: 1 } }]);
    expect(db.startIntegrationExport).toHaveBeenCalledWith(expect.anything(), "org-a", "intercom", expect.anything(), "json");
  });

  it("serves CSV as a zip of one file per record type", async () => {
    auth.session = sessionFor("org-a");
    db.startIntegrationExport.mockResolvedValue(readyExport());
    const response = await post("intercom", "csv");

    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="elapsed-intercom-backup-20261006T101500Z.zip"');
    const files = readStoredZip(new Uint8Array(await response.arrayBuffer()));
    expect([...files.keys()].sort()).toEqual(["README.txt", "cases.csv", "integration.csv", "manifest.json", "raw_events.csv"]);
    expect(new TextDecoder().decode(files.get("cases.csv"))).toBe("id,subject\r\nc1,'=cmd\r\n");
  });

  it("builds the PDF report from the report data and finishes its audit record only once built", async () => {
    auth.session = sessionFor("org-a");
    const complete = vi.fn(async () => {});
    const fail = vi.fn(async () => {});
    db.startIntegrationReport.mockResolvedValue({ status: "ready", data: reportData(), complete, fail });
    const response = await post("intercom", "pdf");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="elapsed-intercom-report-20261006T101500Z.pdf"');
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(Buffer.from(bytes).toString("latin1").startsWith("%PDF-1.4")).toBe(true);
    expect(response.headers.get("content-length")).toBe(String(bytes.length));
    expect(complete).toHaveBeenCalledTimes(1);
    expect(fail).not.toHaveBeenCalled();
    expect(db.startIntegrationReport).toHaveBeenCalledWith(expect.anything(), "org-a", "intercom", { userId: "user-1", email: "owner@tenant.test" });
  });

  it("records the report as failed, and does not send a file, when building it throws", async () => {
    auth.session = sessionFor("org-a");
    const complete = vi.fn(async () => {});
    const fail = vi.fn(async () => {});
    // Data the layout cannot read makes it throw.
    db.startIntegrationReport.mockResolvedValue({ status: "ready", data: { ...reportData(), counts: undefined }, complete, fail });

    await expect(post("intercom", "pdf")).rejects.toThrow();
    expect(fail).toHaveBeenCalledTimes(1);
    expect(complete).not.toHaveBeenCalled();
  });
});

function reportData() {
  const counts = { rawEvents: 3, cases: 2, normalizedEvents: 5, commitments: 1, evaluations: 1, caseLinks: 0, customerIdentities: 0, other: 0 };
  return {
    generatedAt: new Date("2026-10-06T10:15:00Z"),
    generatedBy: "owner@tenant.test",
    organizationName: "Acme",
    provider: "intercom",
    integrationId: "int-1",
    status: "connected",
    connectedAt: new Date("2026-09-01T00:00:00Z"),
    disconnectedAt: null,
    lastSyncAt: null,
    lastSuccessfulSyncAt: null,
    lastSyncError: null,
    counts,
    total: 12,
    span: { firstRawEventAt: null, lastRawEventAt: null, firstCaseOpenedAt: null, lastCaseOpenedAt: null },
    cases: { total: 2, open: 1, closed: 1, deleted: 0 },
    commitmentsByStatus: { on_track: 1 },
    recentCases: [],
    recentOperations: [],
  };
}
