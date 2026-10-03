import type { PrismaClient } from "../generated/prisma/client";
import { aesGcmDecrypt, aesGcmEncrypt, deriveEncryptionKey } from "./crypto";

/**
 * Integrations whose OAuth app credentials are configured per-organization
 * from the Integrations settings UI (roadmap: integration config refactor)
 * rather than a single global `.env` value. Kept a separate, narrower union
 * from `IntegrationProvider` so extending it doesn't touch that enum.
 */
export type ConfigurableIntegrationProvider =
  | "zendesk"
  | "jira"
  | "slack"
  | "linear"
  | "intercom"
  | "github";

const CONFIGURABLE_PROVIDERS: ConfigurableIntegrationProvider[] = [
  "zendesk",
  "jira",
  "linear",
  "slack",
  "intercom",
  "github",
];

export function isConfigurableIntegrationProvider(
  value: string,
): value is ConfigurableIntegrationProvider {
  return (CONFIGURABLE_PROVIDERS as string[]).includes(value);
}

export interface IntegrationOAuthCredentials {
  clientId: string;
  clientSecret: string;
}

export interface IntegrationConfigStatus {
  configured: boolean;
  clientId: string | null;
}

/**
 * Thrown by `getIntegrationConfig` when a row exists but its `clientSecret`
 * can't be decrypted (wrong/rotated `INTEGRATION_CONFIG_ENCRYPTION_KEY`, or
 * corrupted ciphertext) — distinct from "not configured" (no row), which is
 * a normal state and returns `null` instead of throwing. The message is
 * deliberately generic and stable: several callers surface `error.message`
 * directly in a 5xx response, so it must never carry ciphertext, the
 * underlying crypto error, or a stack trace. `cause` keeps the real error
 * available for server-side logging only.
 */
export class IntegrationConfigUnreadableError extends Error {
  constructor(cause: unknown) {
    super(
      "Integration configuration is unavailable. Please re-enter the configuration.",
    );
    this.name = "IntegrationConfigUnreadableError";
    this.cause = cause;
  }
}

const ENCRYPTION_SALT = "elapsed/integration-config";

/**
 * Derives a stable AES-256 key from the dedicated INTEGRATION_CONFIG_ENCRYPTION_KEY secret —
 * kept separate from NEXTAUTH_SECRET so rotating one never invalidates the other.
 */
function getEncryptionKey(): Buffer {
  const secret = process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY;

  if (!secret) {
    throw new Error(
      "INTEGRATION_CONFIG_ENCRYPTION_KEY must be set to encrypt or decrypt integration configuration",
    );
  }
  return deriveEncryptionKey(secret, ENCRYPTION_SALT);
}

export function encryptSecret(plaintext: string): string {
  return aesGcmEncrypt(getEncryptionKey(), plaintext);
}

export function decryptSecret(encoded: string): string {
  return aesGcmDecrypt(getEncryptionKey(), encoded);
}

/**
 * Resolves the OAuth app credentials for one organization's integration from
 * its own configuration (saved via the settings UI), or null when the
 * organization hasn't configured this integration yet.
 */
export async function getIntegrationConfig(
  prisma: PrismaClient,
  organizationId: string,
  provider: ConfigurableIntegrationProvider,
): Promise<IntegrationOAuthCredentials | null> {
  const row = await prisma.integrationConfig.findUnique({
    where: { organizationId_provider: { organizationId, provider } },
  });

  if (!row) return null;

  try {
    return {
      clientId: row.clientId,
      clientSecret: decryptSecret(row.clientSecret),
    };
  } catch (error) {
    throw new IntegrationConfigUnreadableError(error);
  }
}

/** Status-only read for the settings UI — never exposes the secret itself. */
export async function getIntegrationConfigStatus(
  prisma: PrismaClient,
  organizationId: string,
  provider: ConfigurableIntegrationProvider,
): Promise<IntegrationConfigStatus> {
  const row = await prisma.integrationConfig.findUnique({
    where: { organizationId_provider: { organizationId, provider } },
    select: { clientId: true },
  });
  return row
    ? { configured: true, clientId: row.clientId }
    : { configured: false, clientId: null };
}

/**
 * Saves one organization's OAuth app configuration. `clientSecret` is
 * optional on an update so the settings form can let an admin change the
 * client id without having to re-paste a secret it never echoes back.
 */
export async function saveIntegrationConfig(
  prisma: PrismaClient,
  organizationId: string,
  provider: ConfigurableIntegrationProvider,
  input: { clientId: string; clientSecret?: string },
): Promise<void> {
  const existing = await prisma.integrationConfig.findUnique({
    where: { organizationId_provider: { organizationId, provider } },
    select: { id: true },
  });

  if (!existing && !input.clientSecret) {
    throw new Error("clientSecret is required to configure this integration");
  }

  const encryptedSecret = input.clientSecret
    ? encryptSecret(input.clientSecret)
    : undefined;

  // Deliberately two separate calls rather than one `upsert`: Prisma
  // validates an `upsert`'s `create` *and* `update` argument shapes before
  // deciding which one to run against the DB, so a `create.clientSecret` of
  // `undefined` throws "Argument clientSecret is missing" even when the row
  // already exists and `update` (whose `clientSecret` is optional) is the
  // one that would actually execute. Branching here means each call only
  // ever sends the one shape Prisma needs to validate.
  if (existing) {
    await prisma.integrationConfig.update({
      where: { organizationId_provider: { organizationId, provider } },
      data: {
        clientId: input.clientId,
        ...(encryptedSecret ? { clientSecret: encryptedSecret } : {}),
      },
    });
  } else {
    await prisma.integrationConfig.create({
      data: {
        organizationId,
        provider,
        clientId: input.clientId,
        // Guaranteed defined here: the guard above throws when neither an
        // existing row nor a secret is present, so reaching this branch (no
        // existing row) always has one.
        clientSecret: encryptedSecret as string,
      },
    });
  }
}

/** Outcome of `deleteIntegrationConfig`. */
export type DeleteIntegrationConfigResult =
  | "deleted"
  | "not_configured"
  /** Refused: the integration is connected and must be disconnected first. */
  | "connected";

/**
 * Permanently removes one organization's OAuth app configuration for a
 * provider, returning the integration to its unconfigured state — unlike
 * disconnect, which keeps this row so the integration can be reconnected.
 *
 * Only allowed while the integration is not connected ("connected" means
 * live credentials, matching the settings UI: a `SlackIntegration` row, or
 * an `Integration` row whose `credentials` aren't null). A connected
 * integration goes through disconnect first, so this never has to tear
 * down a live connection. A disconnected `Integration` row is kept as-is —
 * `RawEvent.integrationId` cascades on delete and would destroy the
 * immutable replay log. Unused connect links for the provider are revoked
 * in the same transaction, since they could no longer complete without a
 * configuration.
 */
export async function deleteIntegrationConfig(
  prisma: PrismaClient,
  organizationId: string,
  provider: ConfigurableIntegrationProvider,
): Promise<DeleteIntegrationConfigResult> {
  const existing = await prisma.integrationConfig.findUnique({
    where: { organizationId_provider: { organizationId, provider } },
    select: { id: true },
  });
  if (!existing) return "not_configured";

  const deleteConfig = prisma.integrationConfig.deleteMany({
    where: { organizationId, provider },
  });

  if (provider === "slack") {
    const slack = await prisma.slackIntegration.findUnique({
      where: { organizationId },
      select: { id: true },
    });
    if (slack) return "connected";

    await prisma.$transaction([deleteConfig]);
    return "deleted";
  }

  // Checked in JS rather than with a Prisma JSON filter: disconnect stores
  // `Prisma.JsonNull`, which Prisma reads back as `null` either way.
  const integration = await prisma.integration.findUnique({
    where: { organizationId_provider: { organizationId, provider } },
    select: { credentials: true },
  });
  if (integration && integration.credentials !== null) return "connected";

  await prisma.$transaction([
    deleteConfig,
    prisma.integrationConnectLink.deleteMany({
      where: { organizationId, provider, consumedAt: null },
    }),
  ]);
  return "deleted";
}
