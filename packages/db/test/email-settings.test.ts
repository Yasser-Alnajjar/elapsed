import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "../generated/prisma/client";
import {
  decryptSmtpPassword,
  encryptSmtpPassword,
  EmailSettingsUnreadableError,
  getEmailSettings,
  getEmailSettingsStatus,
  saveEmailSettings,
} from "../src/email-settings";
import { decryptSecret } from "../src/integration-config";

const ORIGINAL_SECRET = process.env.SMTP_ENCRYPTION_KEY;

beforeEach(() => {
  process.env.SMTP_ENCRYPTION_KEY = "test-smtp-encryption-key";
});

afterEach(() => {
  process.env.SMTP_ENCRYPTION_KEY = ORIGINAL_SECRET;
});

describe("encryptSmtpPassword / decryptSmtpPassword", () => {
  it("round-trips a plaintext password", () => {
    const ciphertext = encryptSmtpPassword("super-secret-password");
    expect(ciphertext).not.toContain("super-secret-password");
    expect(decryptSmtpPassword(ciphertext)).toBe("super-secret-password");
  });

  it("produces a different ciphertext each time (random IV)", () => {
    const first = encryptSmtpPassword("same-value");
    const second = encryptSmtpPassword("same-value");
    expect(first).not.toBe(second);
    expect(decryptSmtpPassword(first)).toBe("same-value");
    expect(decryptSmtpPassword(second)).toBe("same-value");
  });

  it("throws when SMTP_ENCRYPTION_KEY is missing", () => {
    delete process.env.SMTP_ENCRYPTION_KEY;
    expect(() => encryptSmtpPassword("value")).toThrow(/SMTP_ENCRYPTION_KEY/);
  });

  it("throws on tampered ciphertext instead of returning garbage", () => {
    const ciphertext = encryptSmtpPassword("value");
    const [iv, authTag, body] = ciphertext.split(".");
    const tampered = [iv, authTag, `${body}xx`].join(".");
    expect(() => decryptSmtpPassword(tampered)).toThrow();
  });

  it("derives a different key than @sla/db's integration-config encryption, even given the identical secret value — rotating one key never invalidates the other feature's ciphertext", () => {
    process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY = "test-smtp-encryption-key";
    const ciphertext = encryptSmtpPassword("cross-feature-value");
    expect(() => decryptSecret(ciphertext)).toThrow();
    delete process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY;
  });
});

/**
 * Minimal in-memory stand-in for `PrismaClient`, scoped to exactly the
 * `organizationEmailSettings` operations `getEmailSettings`/
 * `getEmailSettingsStatus`/`saveEmailSettings` call.
 */
function createFakePrisma() {
  type Row = {
    id: string;
    organizationId: string;
    host: string;
    port: number;
    security: "none" | "starttls" | "ssl_tls";
    username: string;
    password: string;
    fromEmail: string;
    fromName: string | null;
    updatedAt: Date;
  };
  const rows = new Map<string, Row>();
  let nextId = 0;

  const organizationEmailSettings = {
    async findUnique({
      where,
      select,
    }: {
      where: { organizationId: string };
      select?: Partial<Record<keyof Row, boolean>>;
    }) {
      const row = rows.get(where.organizationId);
      if (!row) return null;
      if (!select) return { ...row };
      const projected: Partial<Row> = {};
      for (const field of Object.keys(select) as (keyof Row)[]) {
        if (select[field]) projected[field] = row[field];
      }
      return projected;
    },
    // `create`/`update` (not `upsert`) — mirrors real Prisma, which
    // validates a `create` argument's required fields (`password` included)
    // even when an `upsert` would actually run its `update` branch. A fake
    // that only modeled `upsert` couldn't have caught that: it let
    // `create.password` be `undefined` and merged it into `update`'s
    // result unnoticed, silently passing while real Prisma threw "Argument
    // password is missing." at runtime.
    async create({ data }: { data: Omit<Row, "id" | "updatedAt"> }) {
      if (data.password === undefined) {
        throw new Error("Argument `password` is missing.");
      }
      const row: Row = { id: `es-${++nextId}`, updatedAt: new Date(), ...data };
      rows.set(data.organizationId, row);
      return { ...row };
    },
    async update({ where, data }: { where: { organizationId: string }; data: Partial<Row> }) {
      const existing = rows.get(where.organizationId);
      if (!existing) throw new Error("Record to update not found.");
      const next: Row = { ...existing, ...data, updatedAt: new Date() };
      rows.set(where.organizationId, next);
      return { ...next };
    },
  };

  return { prisma: { organizationEmailSettings } as unknown as PrismaClient, rows };
}

const baseInput = {
  host: "smtp.example.com",
  port: 587,
  security: "starttls" as const,
  username: "sla@example.com",
  password: "hunter2",
  fromEmail: "alerts@example.com",
  fromName: "SLA Alerts",
};

describe("saveEmailSettings / getEmailSettings", () => {
  it("creates a configuration and reads back the decrypted password", async () => {
    const { prisma } = createFakePrisma();
    await saveEmailSettings(prisma, "org-a", baseInput);

    const settings = await getEmailSettings(prisma, "org-a");
    expect(settings).toEqual({
      host: "smtp.example.com",
      port: 587,
      security: "starttls",
      username: "sla@example.com",
      password: "hunter2",
      fromEmail: "alerts@example.com",
      fromName: "SLA Alerts",
    });
  });

  it("requires a password to create the first row", async () => {
    const { prisma } = createFakePrisma();
    await expect(
      saveEmailSettings(prisma, "org-a", { ...baseInput, password: undefined }),
    ).rejects.toThrow(/password is required/i);
  });

  it("updates an existing configuration without a password, keeping the old one, while the host and username are unchanged", async () => {
    const { prisma } = createFakePrisma();
    await saveEmailSettings(prisma, "org-a", baseInput);

    await saveEmailSettings(prisma, "org-a", {
      ...baseInput,
      host: baseInput.host.toUpperCase() + ".",
      port: 465,
      password: undefined,
    });

    const settings = await getEmailSettings(prisma, "org-a");
    expect(settings?.port).toBe(465);
    expect(settings?.password).toBe("hunter2");
  });

  it("refuses a new host or username without a password, and leaves the saved row alone (H-10 F-D)", async () => {
    const { prisma } = createFakePrisma();
    await saveEmailSettings(prisma, "org-a", baseInput);

    for (const change of [{ host: "smtp2.example.com" }, { username: "someone-else" }]) {
      await expect(
        saveEmailSettings(prisma, "org-a", { ...baseInput, ...change, password: undefined }),
      ).rejects.toThrow(/re-enter the smtp password/i);
    }
    const settings = await getEmailSettings(prisma, "org-a");
    expect(settings?.host).toBe(baseInput.host);
    expect(settings?.username).toBe(baseInput.username);
    expect(settings?.password).toBe("hunter2");
  });

  it("accepts a new host when the password is provided again", async () => {
    const { prisma } = createFakePrisma();
    await saveEmailSettings(prisma, "org-a", baseInput);
    await saveEmailSettings(prisma, "org-a", { ...baseInput, host: "smtp2.example.com", password: "again" });
    expect((await getEmailSettings(prisma, "org-a"))?.host).toBe("smtp2.example.com");
  });

  it("updates the password when one is provided", async () => {
    const { prisma } = createFakePrisma();
    await saveEmailSettings(prisma, "org-a", baseInput);
    await saveEmailSettings(prisma, "org-a", { ...baseInput, password: "new-password" });

    const settings = await getEmailSettings(prisma, "org-a");
    expect(settings?.password).toBe("new-password");
  });

  it("stores a null fromName when omitted", async () => {
    const { prisma } = createFakePrisma();
    await saveEmailSettings(prisma, "org-a", { ...baseInput, fromName: undefined });
    const settings = await getEmailSettings(prisma, "org-a");
    expect(settings?.fromName).toBeNull();
  });

  it("returns null when the organization hasn't configured email — a normal state, not an error", async () => {
    const { prisma } = createFakePrisma();
    await expect(getEmailSettings(prisma, "org-a")).resolves.toBeNull();
  });

  it("throws EmailSettingsUnreadableError, not the raw crypto error, when the encryption key is missing", async () => {
    const { prisma } = createFakePrisma();
    await saveEmailSettings(prisma, "org-a", baseInput);

    delete process.env.SMTP_ENCRYPTION_KEY;

    const error = await getEmailSettings(prisma, "org-a").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EmailSettingsUnreadableError);
    expect((error as Error).message).not.toMatch(/SMTP_ENCRYPTION_KEY/);
    expect((error as Error).message).toBe(
      "Email configuration is unavailable. Please re-enter the configuration.",
    );
  });

  it("throws EmailSettingsUnreadableError on corrupted ciphertext", async () => {
    const { prisma, rows } = createFakePrisma();
    await saveEmailSettings(prisma, "org-a", baseInput);

    const row = rows.get("org-a")!;
    const [iv, authTag, body] = row.password.split(".");
    rows.set("org-a", { ...row, password: [iv, authTag, `${body}xx`].join(".") });

    const error = await getEmailSettings(prisma, "org-a").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EmailSettingsUnreadableError);
  });
});

describe("getEmailSettingsStatus", () => {
  it("reports not configured when no row exists", async () => {
    const { prisma } = createFakePrisma();
    await expect(getEmailSettingsStatus(prisma, "org-a")).resolves.toEqual({
      configured: false,
      host: null,
      port: null,
      security: null,
      username: null,
      fromEmail: null,
      fromName: null,
      updatedAt: null,
    });
  });

  it("reports configured, without the password field at all, even when the encryption key is missing", async () => {
    const { prisma } = createFakePrisma();
    await saveEmailSettings(prisma, "org-a", baseInput);

    delete process.env.SMTP_ENCRYPTION_KEY;

    const status = await getEmailSettingsStatus(prisma, "org-a");
    expect(status.configured).toBe(true);
    expect(status.host).toBe("smtp.example.com");
    expect(status).not.toHaveProperty("password");
  });
});

describe("tenant isolation", () => {
  it("keeps two organizations' configuration completely separate", async () => {
    const { prisma } = createFakePrisma();

    await saveEmailSettings(prisma, "org-a", { ...baseInput, host: "a.example.com", password: "pw-a" });
    await saveEmailSettings(prisma, "org-b", { ...baseInput, host: "b.example.com", password: "pw-b" });

    const settingsA = await getEmailSettings(prisma, "org-a");
    const settingsB = await getEmailSettings(prisma, "org-b");

    expect(settingsA?.host).toBe("a.example.com");
    expect(settingsA?.password).toBe("pw-a");
    expect(settingsB?.host).toBe("b.example.com");
    expect(settingsB?.password).toBe("pw-b");
  });

  it("never lets writing one organization's config mutate another's row", async () => {
    const { prisma } = createFakePrisma();
    await saveEmailSettings(prisma, "org-a", { ...baseInput, password: "pw-a" });

    // "org-b" stands in for an attacker-controlled organizationId — the route
    // layer only ever passes `session.user.organizationId`, never a value
    // from the request body.
    await saveEmailSettings(prisma, "org-b", { ...baseInput, password: "pw-b" });

    const settingsA = await getEmailSettings(prisma, "org-a");
    expect(settingsA?.password).toBe("pw-a");
  });
});
