import { decryptCredentials, encryptCredentials, type Prisma, type PrismaClient } from "@sla/db";
import type { LinearCredentials } from "./types";
import { ReauthRequiredError } from "@sla/ingestion";

/**
 * Thrown when Linear rejects the access token and there is no refresh path
 * (Linear's OAuth tokens carry no refresh token — see oauth.ts). Distinguishes
 * "the integration needs the user to reconnect" from a transient/network
 * failure — callers should surface this rather than retrying, and never
 * delete the integration for it.
 */
export class LinearReauthRequiredError extends ReauthRequiredError {
  constructor(message = "Linear integration requires reauthorization") {
    super(message);
    this.name = "LinearReauthRequiredError";
  }
}

/**
 * Returns both the raw (possibly still-encrypted) JSON exactly as stored —
 * the only value ever valid as `expected` in the CAS below, since re-running
 * it through encrypt/decrypt would produce a different ciphertext (random
 * IV) and the compare-and-swap would then always lose — and the decrypted
 * plaintext, which is what every caller actually reads/compares/uses.
 */
async function readCredentials(
  prisma: PrismaClient,
  integrationId: string,
): Promise<{ raw: LinearCredentials; plaintext: LinearCredentials }> {
  const integration = await prisma.integration.findUniqueOrThrow({ where: { id: integrationId } });
  const raw = integration.credentials as unknown as LinearCredentials;
  return { raw, plaintext: decryptCredentials(raw) };
}

/**
 * Compare-and-swap on the whole credentials JSON blob: only writes if the row
 * still holds exactly `expectedRaw` (Postgres jsonb equality is deep, so key
 * order doesn't matter). If another process already marked reauthRequired (or
 * the user already reconnected) in the meantime, we lose the race harmlessly
 * and defer to whatever it wrote instead of clobbering it.
 *
 * `expectedRaw` must be the literal raw value read moments earlier — never a
 * decrypt-then-re-encrypt round-trip of it, since AES-GCM's random IV means
 * that would never equal what's actually in the row. `next` is plaintext;
 * only the value being written is freshly encrypted.
 */
async function persistCredentialsIfUnchanged(
  prisma: PrismaClient,
  integrationId: string,
  expectedRaw: LinearCredentials,
  next: LinearCredentials,
): Promise<LinearCredentials> {
  const nextRaw = encryptCredentials(next);
  const result = await prisma.integration.updateMany({
    where: { id: integrationId, credentials: { equals: expectedRaw as unknown as Prisma.InputJsonValue } },
    data: { credentials: nextRaw as unknown as Prisma.InputJsonValue },
  });

  if (result.count > 0) return next;
  return (await readCredentials(prisma, integrationId)).plaintext;
}

/** Loads current credentials, throwing if the integration is already known to need reconnection. */
export async function loadFreshLinearCredentials(
  prisma: PrismaClient,
  integrationId: string,
): Promise<LinearCredentials> {
  const { plaintext } = await readCredentials(prisma, integrationId);
  if (plaintext.reauthRequired) throw new LinearReauthRequiredError();
  return plaintext;
}

/**
 * LinearClient's 401 fallback. Re-reads current credentials first: if another
 * process already reconnected the integration since our request was made
 * with `failedCredentials`, we just adopt that instead of marking it dead a
 * second time. Since Linear issues no refresh token, a 401 is unambiguous —
 * there is no path back except the user reconnecting.
 */
export async function markReauthRequired(
  prisma: PrismaClient,
  integrationId: string,
  failedCredentials: LinearCredentials,
): Promise<LinearCredentials> {
  const { raw, plaintext } = await readCredentials(prisma, integrationId);
  if (plaintext.reauthRequired) throw new LinearReauthRequiredError();
  if (plaintext.accessToken !== failedCredentials.accessToken) return plaintext;

  await persistCredentialsIfUnchanged(prisma, integrationId, raw, { ...plaintext, reauthRequired: true });
  throw new LinearReauthRequiredError();
}
