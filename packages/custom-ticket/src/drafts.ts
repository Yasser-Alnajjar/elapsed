import type { Prisma, PrismaClient } from "@sla/db";
import { DRAFT_INTEGRATION_ID, customSecretFieldsSet, decryptCustomSecrets, encryptCustomSecret } from "@sla/db";
import { privateHostsAllowed } from "@sla/safe-http";
import { authSchema, parseConfig, secretFieldNames, type ConfigIssue, type CustomConfig } from "./schema";
import { validateConfig, type Diagnostic } from "./validate";

export const DRAFT_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_SECRET_BYTES = 4096;

/** What the wizard may see of a draft: the configuration, which secret fields are set, never a secret. */
export interface DraftView {
  displayName: string;
  config: unknown;
  secretsSet: string[];
  expiresAt: string;
  /** Structural issues when the configuration does not parse; empty when it does. */
  issues: ConfigIssue[];
  /** Semantic diagnostics when it does parse. */
  diagnostics: Diagnostic[];
}

export class DraftInputError extends Error {
  readonly code: "invalid_config" | "invalid_secret" | "unknown_secret_field";
  constructor(code: DraftInputError["code"]) {
    super(code);
    this.name = "DraftInputError";
    this.code = code;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function view(row: { displayName: string; config: unknown; secrets: unknown; expiresAt: Date }): DraftView {
  const parsed = parseConfig(row.config);
  return {
    displayName: row.displayName,
    config: row.config,
    secretsSet: customSecretFieldsSet(row.secrets),
    expiresAt: row.expiresAt.toISOString(),
    issues: parsed.ok ? [] : parsed.issues,
    diagnostics: parsed.ok ? validateConfig(parsed.config, { allowPrivateHosts: privateHostsAllowed() }).diagnostics : [],
  };
}

/** The organization's draft, or null. An expired draft is deleted on read (lazy cleanup beside the worker's). */
export async function getDraft(prisma: PrismaClient, organizationId: string, now = new Date()): Promise<DraftView | null> {
  const row = await prisma.customProviderDraft.findUnique({ where: { organizationId } });
  if (!row) return null;
  if (row.expiresAt <= now) {
    await prisma.customProviderDraft.deleteMany({ where: { organizationId, expiresAt: { lte: now } } });
    return null;
  }
  return view(row);
}

/**
 * Saves the draft's configuration and, write-only, any secret values. The
 * configuration may be incomplete; it is validated again at activation.
 * Secrets are accepted only for the fields the draft's auth type needs, are
 * encrypted at once, bound to the organization and field, and never read back.
 * Changing the auth type drops secrets of fields the new type does not use.
 */
export async function saveDraft(
  prisma: PrismaClient,
  organizationId: string,
  input: { config: unknown; secrets?: Record<string, unknown> },
  now = new Date(),
): Promise<DraftView> {
  if (!isPlainObject(input.config)) throw new DraftInputError("invalid_config");
  let serialized: string;
  try {
    serialized = JSON.stringify(input.config);
  } catch {
    throw new DraftInputError("invalid_config");
  }
  if (serialized.length > 64 * 1024) throw new DraftInputError("invalid_config");

  const auth = authSchema.safeParse(input.config.auth);
  const allowedFields = auth.success ? secretFieldNames(auth.data) : [];
  const existing = await prisma.customProviderDraft.findUnique({ where: { organizationId }, select: { secrets: true } });
  const kept: Record<string, string> = {};
  if (isPlainObject(existing?.secrets)) {
    for (const field of allowedFields) {
      const value = (existing!.secrets as Record<string, unknown>)[field];
      if (typeof value === "string") kept[field] = value;
    }
  }
  for (const [field, value] of Object.entries(input.secrets ?? {})) {
    if (!allowedFields.includes(field)) throw new DraftInputError("unknown_secret_field");
    if (typeof value !== "string" || value.length === 0 || Buffer.byteLength(value, "utf8") > MAX_SECRET_BYTES) throw new DraftInputError("invalid_secret");
    kept[field] = encryptCustomSecret(value, { organizationId, integrationId: DRAFT_INTEGRATION_ID, field });
  }

  const displayName =
    typeof input.config.displayName === "string" && input.config.displayName.trim() !== "" ? input.config.displayName.trim().slice(0, 80) : "Custom REST";
  const data = {
    displayName,
    config: input.config as Prisma.InputJsonValue,
    secrets: kept as Prisma.InputJsonValue,
    expiresAt: new Date(now.getTime() + DRAFT_TTL_MS),
  };
  const row = await prisma.customProviderDraft.upsert({ where: { organizationId }, create: { organizationId, ...data }, update: data });
  return view(row);
}

export async function deleteDraft(prisma: PrismaClient, organizationId: string): Promise<void> {
  await prisma.customProviderDraft.deleteMany({ where: { organizationId } });
}

/** The draft's parsed configuration and decrypted secrets, for an outbound check. Throws a coded error when unusable. */
export class DraftNotReadyError extends Error {
  readonly code: "no_draft" | "config_invalid" | "secrets_missing" | "credentials_unreadable";
  readonly missing: string[];
  constructor(code: DraftNotReadyError["code"], missing: string[] = []) {
    super(code);
    this.name = "DraftNotReadyError";
    this.code = code;
    this.missing = missing;
  }
}

export async function loadReadyDraft(
  prisma: PrismaClient,
  organizationId: string,
  now = new Date(),
): Promise<{ config: CustomConfig; secrets: Record<string, string> }> {
  const row = await prisma.customProviderDraft.findUnique({ where: { organizationId } });
  if (!row || row.expiresAt <= now) throw new DraftNotReadyError("no_draft");
  const parsed = parseConfig(row.config);
  if (!parsed.ok) throw new DraftNotReadyError("config_invalid");
  const fields = secretFieldNames(parsed.config.auth);
  const set = customSecretFieldsSet(row.secrets);
  const missing = fields.filter((field) => !set.includes(field));
  if (missing.length > 0) throw new DraftNotReadyError("secrets_missing", missing);
  try {
    return { config: parsed.config, secrets: decryptCustomSecrets(row.secrets, { organizationId, integrationId: DRAFT_INTEGRATION_ID }, fields) };
  } catch {
    throw new DraftNotReadyError("credentials_unreadable");
  }
}
