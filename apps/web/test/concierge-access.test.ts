/**
 * Authorization for the Concierge exports (Jira and Zendesk): the listing
 * and export routes against an in-memory Prisma double with two tenants. The
 * user belongs to org A only; org B's ids must be rejected wherever they're
 * sent, and neither provider's API may be reached for them.
 */
import type { Session } from "next-auth";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ session: null as Session | null }));
const db = vi.hoisted(() => ({ prisma: null as unknown }));
const providerCalls = vi.hoisted(() => ({ credentialsLoadedFor: [] as string[] }));

vi.mock("next-auth", () => ({ getServerSession: vi.fn(async () => auth.session) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("server-only", () => ({}));
vi.mock("@sla/db", () => ({
  getPrismaClient: () => db.prisma,
  // D33: every provider available; these fakes have no availability tables.
  resolveIntegrationAvailability: vi.fn(async (_db: unknown, _org: string, provider: string) => ({ available: true, provider, releaseStage: "stable" })),
}));
const oauthConfig = vi.hoisted(() => async () => ({ clientId: "id", clientSecret: "secret", redirectUri: "http://x" }));
vi.mock("@/lib/jira-env", () => ({ getJiraOAuthConfig: vi.fn(oauthConfig) }));
vi.mock("@/lib/zendesk-env", () => ({ getZendeskOAuthConfig: vi.fn(oauthConfig) }));

vi.mock("@sla/jira", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sla/jira")>();
  class FakeJiraClient {
    async fetchStatuses() {
      return [{ id: "1", name: "To Do", statusCategory: { key: "new", name: "To Do" } }, { id: "3", name: "Done", statusCategory: { key: "done", name: "Done" } }];
    }
    async searchIssues() {
      return {
        isLast: true,
        issues: [
          {
            id: "10001",
            key: "A-1",
            self: "",
            fields: {
              summary: "Org A issue",
              status: { id: "3", name: "Done" },
              priority: null,
              project: { id: "1", key: "A", name: "A" },
              created: "2026-09-01T10:00:00.000+0000",
              updated: "2026-09-02T10:00:00.000+0000",
              reporter: null,
              assignee: null,
            },
          },
        ],
      };
    }
    async fetchChangelogPage() {
      return {
        startAt: 0,
        maxResults: 100,
        total: 1,
        isLast: true,
        values: [{ id: "1", author: null, created: "2026-09-02T10:00:00.000+0000", items: [{ field: "status", fieldtype: "jira", from: "1", fromString: "To Do", to: "3", toString: "Done" }] }],
      };
    }
    async fetchRemoteLinks() {
      return [];
    }
  }
  return {
    ...actual,
    JiraClient: FakeJiraClient,
    loadFreshJiraCredentials: vi.fn(async (_prisma: unknown, integrationId: string) => {
      providerCalls.credentialsLoadedFor.push(integrationId);
      return { cloudId: "c", siteUrl: "https://alpha.atlassian.net", accessToken: "t", tokenType: "bearer", scope: "" };
    }),
  };
});

vi.mock("@sla/zendesk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sla/zendesk")>();
  class FakeZendeskClient {
    async fetchTicketsPage() {
      return {
        count: 1,
        end_time: 0,
        next_page: null,
        tickets: [{ id: 7, url: "", external_id: null, subject: "Org A ticket", created_at: "2026-09-01T10:00:00Z", updated_at: "2026-09-02T10:00:00Z", status: "solved", priority: "high", organization_id: null }],
      };
    }
    async fetchTicketsNextPage() {
      throw new Error("unexpected");
    }
    async fetchOrganizationsPage() {
      return { count: 0, end_time: 0, next_page: null, organizations: [] };
    }
    async fetchOrganizationsNextPage() {
      throw new Error("unexpected");
    }
    async fetchTicketAuditsPage() {
      return {
        next_page: null,
        audits: [{ id: 1, ticket_id: 7, created_at: "2026-09-02T10:00:00Z", author_id: 5, events: [{ id: 1, type: "Change", field_name: "status", previous_value: "open", value: "solved" }] }],
      };
    }
    async fetchJiraLinksPage() {
      return { links: [], meta: { has_more: false, after_cursor: null } };
    }
  }
  return {
    ...actual,
    ZendeskClient: FakeZendeskClient,
    loadFreshZendeskCredentials: vi.fn(async (_prisma: unknown, integrationId: string) => {
      providerCalls.credentialsLoadedFor.push(integrationId);
      return { subdomain: "alpha", accessToken: "t", tokenType: "bearer", scope: "" };
    }),
  };
});

import { GET as listJiraIntegrations } from "@/app/api/concierge/jira/integrations/route";
import { POST as exportJira } from "@/app/api/concierge/jira/export/route";
import { GET as listZendeskIntegrations } from "@/app/api/concierge/zendesk/integrations/route";
import { POST as exportZendesk } from "@/app/api/concierge/zendesk/export/route";
import { authorizeSourceExport, listAuthorizedOrganizations, listSourceIntegrations } from "@/lib/concierge-access";
import { readStoredZip } from "@/lib/zip";

interface Row {
  id: string;
  organizationId: string;
  provider: string;
  status: string;
  credentials: unknown;
  connectedAt: Date;
}

function fakePrisma() {
  const organizations = [
    { id: "org-a", name: "Alpha" },
    { id: "org-b", name: "Bravo" },
  ];
  const users = [
    { id: "user-a", organizationId: "org-a" },
    { id: "user-b", organizationId: "org-b" },
  ];
  const jira = (host: string) => ({ cloudId: host, siteUrl: `https://${host}.atlassian.net`, accessToken: `${host}-secret-token`, refreshToken: "refresh", tokenType: "bearer", scope: "" });
  const zendesk = (subdomain: string) => ({ subdomain, accessToken: `${subdomain}-secret-token`, refreshToken: "refresh", tokenType: "bearer", scope: "read" });
  const integrations: Row[] = [
    { id: "jira-a", organizationId: "org-a", provider: "jira", status: "connected", credentials: jira("alpha"), connectedAt: new Date(1) },
    { id: "zendesk-a", organizationId: "org-a", provider: "zendesk", status: "connected", credentials: zendesk("alpha"), connectedAt: new Date(1) },
    { id: "jira-b", organizationId: "org-b", provider: "jira", status: "connected", credentials: jira("bravo"), connectedAt: new Date(1) },
    { id: "zendesk-b", organizationId: "org-b", provider: "zendesk", status: "connected", credentials: zendesk("bravo"), connectedAt: new Date(1) },
  ];
  const pick = (row: Row, select?: Record<string, boolean>) =>
    select ? Object.fromEntries(Object.keys(select).map((key) => [key, row[key as keyof Row]])) : row;
  const matches = (row: Row, where: Partial<Row>) =>
    Object.entries(where).every(([key, value]) => row[key as keyof Row] === value);

  return {
    organization: {
      findMany: async ({ where }: { where: { id: string; users: { some: { id: string } } } }) =>
        organizations.filter(
          (org) => org.id === where.id && users.some((user) => user.id === where.users.some.id && user.organizationId === org.id),
        ),
    },
    integration: {
      findMany: async ({ where, select }: { where: Partial<Row>; select?: Record<string, boolean> }) =>
        integrations.filter((row) => matches(row, where)).map((row) => pick(row, select)),
      findFirst: async ({ where, select }: { where: Partial<Row>; select?: Record<string, boolean> }) => {
        const row = integrations.find((candidate) => matches(candidate, where));
        return row ? pick(row, select) : null;
      },
    },
    integrations,
  };
}

function sessionFor(userId: string, organizationId: string): Session {
  return {
    expires: new Date(Date.now() + 3_600_000).toISOString(),
    user: { id: userId, organizationId, email: `${userId}@example.test`, name: null, image: null, role: "owner" },
  } as Session;
}

function post(url: string, body: unknown) {
  return new NextRequest(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

const PROVIDERS = [
  {
    provider: "jira" as const,
    idField: "jiraIntegrationId",
    list: listJiraIntegrations,
    exportRoute: exportJira,
    listUrl: "http://localhost/api/concierge/jira/integrations",
    exportUrl: "http://localhost/api/concierge/jira/export",
    ownName: "Jira Cloud (alpha.atlassian.net)",
    files: ["jira-issues.csv", "jira-changelog.csv", "metadata.json"],
  },
  {
    provider: "zendesk" as const,
    idField: "zendeskIntegrationId",
    list: listZendeskIntegrations,
    exportRoute: exportZendesk,
    listUrl: "http://localhost/api/concierge/zendesk/integrations",
    exportUrl: "http://localhost/api/concierge/zendesk/export",
    ownName: "Zendesk (alpha.zendesk.com)",
    files: ["zendesk-tickets.csv", "zendesk-audits.csv", "metadata.json"],
  },
];

let prisma: ReturnType<typeof fakePrisma>;

beforeEach(() => {
  prisma = fakePrisma();
  db.prisma = prisma;
  auth.session = sessionFor("user-a", "org-a");
  providerCalls.credentialsLoadedFor = [];
});

describe("organizations", () => {
  it("returns only the user's own organization", async () => {
    expect(await listAuthorizedOrganizations(prisma as never, auth.session!)).toEqual([{ id: "org-a", name: "Alpha" }]);
  });

  it("returns nothing when the session's organization doesn't match the user row", async () => {
    expect(await listAuthorizedOrganizations(prisma as never, sessionFor("user-a", "org-b"))).toEqual([]);
  });
});

describe.each(PROVIDERS)("$provider", ({ provider, idField, list, exportRoute, listUrl, exportUrl, ownName, files }) => {
  const own = `${provider}-a`;
  const other = `${provider}-b`;
  const otherProvider = provider === "jira" ? "zendesk-a" : "jira-a";

  describe("listing", () => {
    it("lists the organization's integrations of this provider, with a display name and no credentials", async () => {
      const integrations = await listSourceIntegrations(prisma as never, "org-a", provider);
      expect(integrations).toEqual([{ id: own, organizationId: "org-a", name: ownName, exportable: true, unavailableReason: null }]);
      expect(JSON.stringify(integrations)).not.toContain("secret");
    });

    it("GET for another organization is rejected", async () => {
      const response = await list(new NextRequest(`${listUrl}?organizationId=org-b`));
      expect(response.status).toBe(403);
    });

    it("GET for the user's organization works and exposes no tokens", async () => {
      const response = await list(new NextRequest(`${listUrl}?organizationId=org-a`));
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(JSON.parse(text).integrations.map((i: { id: string }) => i.id)).toEqual([own]);
      expect(text).not.toContain("token");
    });

    it("GET without a session is 401", async () => {
      auth.session = null;
      expect((await list(new NextRequest(`${listUrl}?organizationId=org-a`))).status).toBe(401);
    });
  });

  describe("authorizeSourceExport", () => {
    it("allows the user's organization with its own integration", async () => {
      const result = await authorizeSourceExport(prisma as never, auth.session!, provider, { organizationId: "org-a", integrationId: own });
      expect(result).toMatchObject({ ok: true, organizationId: "org-a", integrationId: own });
    });

    it("rejects another organization together with its integration", async () => {
      const result = await authorizeSourceExport(prisma as never, auth.session!, provider, { organizationId: "org-b", integrationId: other });
      expect(result).toMatchObject({ ok: false, status: 403 });
    });

    it("rejects another organization's integration under the user's organization", async () => {
      const result = await authorizeSourceExport(prisma as never, auth.session!, provider, { organizationId: "org-a", integrationId: other });
      expect(result).toMatchObject({ ok: false, status: 404 });
    });

    it("rejects the other provider's integration", async () => {
      const result = await authorizeSourceExport(prisma as never, auth.session!, provider, { organizationId: "org-a", integrationId: otherProvider });
      expect(result).toMatchObject({ ok: false, status: 404 });
    });

    it("rejects a disconnected integration", async () => {
      const row = prisma.integrations.find((candidate) => candidate.id === own)!;
      row.status = "disconnected";
      row.credentials = null;
      const result = await authorizeSourceExport(prisma as never, auth.session!, provider, { organizationId: "org-a", integrationId: own });
      expect(result).toMatchObject({ ok: false, status: 409 });
    });

    it("rejects missing ids", async () => {
      const result = await authorizeSourceExport(prisma as never, auth.session!, provider, { organizationId: "org-a" });
      expect(result).toMatchObject({ ok: false, status: 400 });
    });
  });

  describe("POST export", () => {
    it("exports the authorized organization's integration as a ZIP", async () => {
      const response = await exportRoute(post(exportUrl, { organizationId: "org-a", [idField]: own }));
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("application/zip");
      expect(response.headers.get("X-Export-Record-Count")).toBe("1");
      expect(response.headers.get("X-Export-History-Count")).toBe("1");
      expect(providerCalls.credentialsLoadedFor).toEqual([own]);

      const zip = readStoredZip(new Uint8Array(await response.arrayBuffer()));
      expect([...zip.keys()]).toEqual(files);
      const metadata = JSON.parse(new TextDecoder().decode(zip.get("metadata.json")));
      expect(metadata).toMatchObject({ organizationId: "org-a", [idField]: own });
    });

    it("rejects org B with org B's integration and never calls the provider", async () => {
      const response = await exportRoute(post(exportUrl, { organizationId: "org-b", [idField]: other }));
      expect(response.status).toBe(403);
      expect(providerCalls.credentialsLoadedFor).toEqual([]);
    });

    it("rejects org B's integration submitted under org A", async () => {
      const response = await exportRoute(post(exportUrl, { organizationId: "org-a", [idField]: other }));
      expect(response.status).toBe(404);
      expect(providerCalls.credentialsLoadedFor).toEqual([]);
    });

    it("rejects an unauthenticated request", async () => {
      auth.session = null;
      expect((await exportRoute(post(exportUrl, { organizationId: "org-a", [idField]: own }))).status).toBe(401);
    });

    it("rejects an out-of-range window", async () => {
      expect((await exportRoute(post(exportUrl, { organizationId: "org-a", [idField]: own, sinceDays: 0 }))).status).toBe(400);
    });
  });
});
