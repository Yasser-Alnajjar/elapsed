import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "../generated/prisma/client";
import {
  decryptSecret,
  deleteIntegrationConfig,
  encryptSecret,
  getIntegrationConfig,
  getIntegrationConfigStatus,
  isConfigurableIntegrationProvider,
  IntegrationConfigUnreadableError,
  saveIntegrationConfig,
} from "../src/integration-config";

const ORIGINAL_SECRET = process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY;

beforeEach(() => {
  process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY = "test-nextauth-secret";
});

afterEach(() => {
  process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY = ORIGINAL_SECRET;
});

describe("isConfigurableIntegrationProvider", () => {
  it("accepts zendesk, jira, linear, slack, intercom, and github", () => {
    expect(isConfigurableIntegrationProvider("zendesk")).toBe(true);
    expect(isConfigurableIntegrationProvider("jira")).toBe(true);
    expect(isConfigurableIntegrationProvider("linear")).toBe(true);
    expect(isConfigurableIntegrationProvider("slack")).toBe(true);
    expect(isConfigurableIntegrationProvider("intercom")).toBe(true);
    expect(isConfigurableIntegrationProvider("github")).toBe(true);
  });

  it("rejects unknown values", () => {
    expect(isConfigurableIntegrationProvider("bogus")).toBe(false);
  });
});

describe("encryptSecret / decryptSecret", () => {
  it("round-trips a plaintext secret", () => {
    const ciphertext = encryptSecret("super-secret-value");
    expect(ciphertext).not.toContain("super-secret-value");
    expect(decryptSecret(ciphertext)).toBe("super-secret-value");
  });

  it("produces a different ciphertext each time (random IV)", () => {
    const first = encryptSecret("same-value");
    const second = encryptSecret("same-value");
    expect(first).not.toBe(second);
    expect(decryptSecret(first)).toBe("same-value");
    expect(decryptSecret(second)).toBe("same-value");
  });

  it("throws when INTEGRATION_CONFIG_ENCRYPTION_KEY is missing", () => {
    delete process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY;
    expect(() => encryptSecret("value")).toThrow(
      /INTEGRATION_CONFIG_ENCRYPTION_KEY/,
    );
  });

  it("throws on tampered ciphertext instead of returning garbage", () => {
    const ciphertext = encryptSecret("value");
    const [iv, authTag, body] = ciphertext.split(".");
    const tampered = [iv, authTag, `${body}xx`].join(".");
    expect(() => decryptSecret(tampered)).toThrow();
  });
});

/**
 * Minimal in-memory stand-in for `PrismaClient`, scoped to exactly the
 * `integrationConfig` operations `getIntegrationConfig`/
 * `getIntegrationConfigStatus`/`saveIntegrationConfig` call — a fake
 * injected at the same seam these functions already take `prisma` through,
 * not a new test-infrastructure layer.
 */
function createFakePrisma() {
  type Row = { id: string; organizationId: string; provider: string; clientId: string; clientSecret: string };
  const rows = new Map<string, Row>();
  let nextId = 0;

  function key(organizationId: string, provider: string): string {
    return `${organizationId}:${provider}`;
  }

  const integrationConfig = {
    async findUnique({ where, select }: { where: { organizationId_provider: { organizationId: string; provider: string } }; select?: Partial<Record<keyof Row, boolean>> }) {
      const row = rows.get(key(where.organizationId_provider.organizationId, where.organizationId_provider.provider));
      if (!row) return null;
      if (!select) return { ...row };
      const projected: Partial<Row> = {};
      for (const field of Object.keys(select) as (keyof Row)[]) {
        if (select[field]) projected[field] = row[field];
      }
      return projected;
    },
    // `create`/`update` (not `upsert`) — mirrors real Prisma, which
    // validates a `create` argument's required fields (`clientSecret`
    // included) even when an `upsert` would actually run its `update`
    // branch. A fake that only modeled `upsert` couldn't have caught that:
    // it let `create.clientSecret` be `undefined` and merged it into
    // `update`'s result unnoticed, silently passing while real Prisma threw
    // "Argument clientSecret is missing." at runtime.
    async create({ data }: { data: Omit<Row, "id"> }) {
      if (data.clientSecret === undefined) {
        throw new Error("Argument `clientSecret` is missing.");
      }
      const k = key(data.organizationId, data.provider);
      const row: Row = { id: `cfg-${++nextId}`, ...data };
      rows.set(k, row);
      return { ...row };
    },
    async update({
      where,
      data,
    }: {
      where: { organizationId_provider: { organizationId: string; provider: string } };
      data: Partial<Row>;
    }) {
      const k = key(where.organizationId_provider.organizationId, where.organizationId_provider.provider);
      const existing = rows.get(k);
      if (!existing) throw new Error("Record to update not found.");
      const next: Row = { ...existing, ...data };
      rows.set(k, next);
      return { ...next };
    },
  };

  return { prisma: { integrationConfig } as unknown as PrismaClient, rows };
}

describe("tenant isolation", () => {
  it("keeps two organizations' configuration completely separate", async () => {
    const { prisma } = createFakePrisma();

    await saveIntegrationConfig(prisma, "org-a", "jira", { clientId: "client-a", clientSecret: "secret-a" });
    await saveIntegrationConfig(prisma, "org-b", "jira", { clientId: "client-b", clientSecret: "secret-b" });

    const configA = await getIntegrationConfig(prisma, "org-a", "jira");
    const configB = await getIntegrationConfig(prisma, "org-b", "jira");

    expect(configA).toEqual({ clientId: "client-a", clientSecret: "secret-a" });
    expect(configB).toEqual({ clientId: "client-b", clientSecret: "secret-b" });
  });

  it("never lets writing one organization's config mutate another's row", async () => {
    const { prisma } = createFakePrisma();

    await saveIntegrationConfig(prisma, "org-a", "zendesk", { clientId: "client-a", clientSecret: "secret-a" });

    // "org-b" here stands in for an attacker-controlled organizationId — the
    // route layer (integration-config-route.ts) only ever passes
    // `session.user.organizationId`, never a value from the request body,
    // a query param, a URL segment, or a header, so this call shape is what
    // a compromised or buggy caller would have to produce to reach another
    // tenant's row. Even then, the `@@unique([organizationId, provider])`
    // key keeps it from touching org-a's row.
    await saveIntegrationConfig(prisma, "org-b", "zendesk", { clientId: "client-b", clientSecret: "secret-b" });

    const configA = await getIntegrationConfig(prisma, "org-a", "zendesk");
    expect(configA).toEqual({ clientId: "client-a", clientSecret: "secret-a" });
  });

  it("saves a second provider for the same organization without disturbing the first", async () => {
    const { prisma } = createFakePrisma();

    await saveIntegrationConfig(prisma, "org-a", "jira", { clientId: "jira-client", clientSecret: "jira-secret" });
    await saveIntegrationConfig(prisma, "org-a", "slack", { clientId: "slack-client", clientSecret: "slack-secret" });

    expect(await getIntegrationConfig(prisma, "org-a", "jira")).toEqual({
      clientId: "jira-client",
      clientSecret: "jira-secret",
    });
    expect(await getIntegrationConfig(prisma, "org-a", "slack")).toEqual({
      clientId: "slack-client",
      clientSecret: "slack-secret",
    });
  });
});

describe("saveIntegrationConfig", () => {
  it("updates clientId on an existing row without a clientSecret, keeping the old secret", async () => {
    const { prisma } = createFakePrisma();
    await saveIntegrationConfig(prisma, "org-a", "jira", { clientId: "client-a", clientSecret: "secret-a" });

    await saveIntegrationConfig(prisma, "org-a", "jira", { clientId: "client-a-renamed" });

    expect(await getIntegrationConfig(prisma, "org-a", "jira")).toEqual({
      clientId: "client-a-renamed",
      clientSecret: "secret-a",
    });
  });
});

describe("getIntegrationConfig", () => {
  it("returns null when the organization hasn't configured this provider — a normal state, not an error", async () => {
    const { prisma } = createFakePrisma();
    await expect(getIntegrationConfig(prisma, "org-a", "jira")).resolves.toBeNull();
  });

  it("throws IntegrationConfigUnreadableError, not the raw crypto error, when the encryption key is missing", async () => {
    const { prisma } = createFakePrisma();
    await saveIntegrationConfig(prisma, "org-a", "jira", { clientId: "client-a", clientSecret: "secret-a" });

    delete process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY;

    const error = await getIntegrationConfig(prisma, "org-a", "jira").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(IntegrationConfigUnreadableError);
    expect((error as Error).message).not.toMatch(/INTEGRATION_CONFIG_ENCRYPTION_KEY/);
    expect((error as Error).message).toBe("Integration configuration is unavailable. Please re-enter the configuration.");
  });

  it("throws IntegrationConfigUnreadableError, not the raw crypto error, on corrupted ciphertext", async () => {
    const { prisma, rows } = createFakePrisma();
    await saveIntegrationConfig(prisma, "org-a", "jira", { clientId: "client-a", clientSecret: "secret-a" });

    const row = rows.get("org-a:jira")!;
    const [iv, authTag, body] = row.clientSecret.split(".");
    rows.set("org-a:jira", { ...row, clientSecret: [iv, authTag, `${body}xx`].join(".") });

    const error = await getIntegrationConfig(prisma, "org-a", "jira").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(IntegrationConfigUnreadableError);
    expect((error as Error).message).toBe("Integration configuration is unavailable. Please re-enter the configuration.");
  });
});

describe("getIntegrationConfigStatus", () => {
  it("reports not configured when no row exists", async () => {
    const { prisma } = createFakePrisma();
    await expect(getIntegrationConfigStatus(prisma, "org-a", "slack")).resolves.toEqual({
      configured: false,
      clientId: null,
    });
  });

  it("reports configured, without ever decrypting, even when the encryption key is missing", async () => {
    const { prisma } = createFakePrisma();
    await saveIntegrationConfig(prisma, "org-a", "slack", { clientId: "client-a", clientSecret: "secret-a" });

    delete process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY;

    await expect(getIntegrationConfigStatus(prisma, "org-a", "slack")).resolves.toEqual({
      configured: true,
      clientId: "client-a",
    });
  });
});

/**
 * `deleteIntegrationConfig` reads connection state, then queues its writes
 * in one `$transaction`, so this fake answers the reads from its options
 * and records each queued write's model, method and args instead of
 * modelling the tables — the assertions are about *what* the transaction
 * asks the database to do, which is the contract that matters.
 */
function createRecordingPrisma({
  configured = true,
  integrationCredentials = undefined as Record<string, unknown> | null | undefined,
  slackConnected = false,
} = {}) {
  const transactions: { model: string; method: string; args: unknown }[][] = [];
  const op = (model: string, method: string) => (args: unknown) => ({ model, method, args });

  const prisma = {
    integrationConfig: {
      findUnique: async () => (configured ? { id: "cfg-1" } : null),
      deleteMany: op("integrationConfig", "deleteMany"),
    },
    slackIntegration: {
      findUnique: async () => (slackConnected ? { id: "slack-1" } : null),
    },
    integration: {
      findUnique: async () =>
        integrationCredentials === undefined ? null : { credentials: integrationCredentials },
    },
    integrationConnectLink: { deleteMany: op("integrationConnectLink", "deleteMany") },
    async $transaction(ops: { model: string; method: string; args: unknown }[]) {
      transactions.push(ops);
      return ops.map(() => ({ count: 1 }));
    },
  };

  return { prisma: prisma as unknown as PrismaClient, transactions };
}

describe("deleteIntegrationConfig", () => {
  it("returns not_configured and changes nothing when the provider isn't configured", async () => {
    const { prisma, transactions } = createRecordingPrisma({ configured: false });

    await expect(deleteIntegrationConfig(prisma, "org-a", "jira")).resolves.toBe("not_configured");
    expect(transactions).toHaveLength(0);
  });

  it("refuses while a source integration is connected, leaving the configuration in place", async () => {
    const { prisma, transactions } = createRecordingPrisma({ integrationCredentials: { accessToken: "x" } });

    await expect(deleteIntegrationConfig(prisma, "org-a", "zendesk")).resolves.toBe("connected");
    expect(transactions).toHaveLength(0);
  });

  it("refuses while Slack is connected", async () => {
    const { prisma, transactions } = createRecordingPrisma({ slackConnected: true });

    await expect(deleteIntegrationConfig(prisma, "org-a", "slack")).resolves.toBe("connected");
    expect(transactions).toHaveLength(0);
  });

  it("deletes the config of a disconnected source integration and revokes its unused connect links, never touching the Integration row", async () => {
    const { prisma, transactions } = createRecordingPrisma({ integrationCredentials: null });

    await expect(deleteIntegrationConfig(prisma, "org-a", "zendesk")).resolves.toBe("deleted");

    expect(transactions).toEqual([
      [
        { model: "integrationConfig", method: "deleteMany", args: { where: { organizationId: "org-a", provider: "zendesk" } } },
        {
          model: "integrationConnectLink",
          method: "deleteMany",
          args: { where: { organizationId: "org-a", provider: "zendesk", consumedAt: null } },
        },
      ],
    ]);
  });

  it("deletes the config of a source integration that was never connected", async () => {
    const { prisma, transactions } = createRecordingPrisma();

    await expect(deleteIntegrationConfig(prisma, "org-a", "linear")).resolves.toBe("deleted");
    expect(transactions[0]![0]).toMatchObject({ model: "integrationConfig", method: "deleteMany" });
  });

  it("deletes only the config for slack when it isn't connected", async () => {
    const { prisma, transactions } = createRecordingPrisma();

    await expect(deleteIntegrationConfig(prisma, "org-a", "slack")).resolves.toBe("deleted");
    expect(transactions).toEqual([
      [{ model: "integrationConfig", method: "deleteMany", args: { where: { organizationId: "org-a", provider: "slack" } } }],
    ]);
  });
});
