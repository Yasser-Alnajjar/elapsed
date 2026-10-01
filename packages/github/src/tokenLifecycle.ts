import { decryptCredentials, encryptCredentials, type Prisma, type PrismaClient } from "@sla/db";
import { GithubOAuthError, refreshAccessToken, type GithubOAuthConfig } from "./oauth";
import type { GithubCredentials } from "./types";
import { ReauthRequiredError } from "@sla/ingestion";

/** Refresh this far ahead of the recorded expiry, to absorb request latency. */
const EXPIRY_SAFETY_MARGIN_MS = 2 * 60 * 1000;

/**
 * Thrown when GitHub rejects the access token and it can't be refreshed:
 * there is no refresh token (a non-expiring token), or GitHub rejected the
 * refresh token. Distinguishes "the integration needs the user to reconnect"
 * from a transient/network failure. Callers should surface this rather than
 * retrying, and never delete the integration for it.
 */
export class GithubReauthRequiredError extends ReauthRequiredError {
  constructor(message = "GitHub integration requires reauthorization") {
    super(message);
    this.name = "GithubReauthRequiredError";
  }
}

function isExpiringSoon(credentials: GithubCredentials): boolean {
  if (credentials.expiresAt === undefined) return false; // non-expiring token
  return credentials.expiresAt - EXPIRY_SAFETY_MARGIN_MS <= Date.now();
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
): Promise<{ raw: GithubCredentials; plaintext: GithubCredentials }> {
  const integration = await prisma.integration.findUniqueOrThrow({ where: { id: integrationId } });
  const raw = integration.credentials as unknown as GithubCredentials;
  return { raw, plaintext: decryptCredentials(raw) };
}

/**
 * Compare-and-swap on the whole credentials JSON blob: only writes if the row
 * still holds exactly `expectedRaw` (Postgres jsonb equality is deep, so key
 * order doesn't matter). If another process already rotated the tokens, marked
 * reauthRequired, or the user reconnected in the meantime, we lose the race
 * harmlessly and defer to whatever it wrote instead of clobbering it.
 *
 * `expectedRaw` must be the literal raw value read moments earlier — never a
 * decrypt-then-re-encrypt round-trip of it, since AES-GCM's random IV means
 * that would never equal what's actually in the row. `next` is plaintext;
 * only the value being written is freshly encrypted.
 */
async function persistCredentialsIfUnchanged(
  prisma: PrismaClient,
  integrationId: string,
  expectedRaw: GithubCredentials,
  next: GithubCredentials,
): Promise<GithubCredentials> {
  const nextRaw = encryptCredentials(next);
  const result = await prisma.integration.updateMany({
    where: { id: integrationId, credentials: { equals: expectedRaw as unknown as Prisma.InputJsonValue } },
    data: { credentials: nextRaw as unknown as Prisma.InputJsonValue },
  });

  if (result.count > 0) return next;
  return (await readCredentials(prisma, integrationId)).plaintext;
}

/**
 * Per-process de-dup only, mirroring Jira's tokenLifecycle. GitHub refresh
 * tokens are single-use, so two refreshes racing in one process would burn
 * the token for the loser. Across instances, the DB compare-and-swap above
 * keeps the winner's rotated tokens.
 */
const inFlightRefreshes = new Map<string, Promise<GithubCredentials>>();

async function doRefresh(
  prisma: PrismaClient,
  integrationId: string,
  config: Pick<GithubOAuthConfig, "clientId" | "clientSecret">,
  current: GithubCredentials,
  currentRaw: GithubCredentials,
  options: { onMissingRefreshToken: "returnUnchanged" | "requireReauth" },
): Promise<GithubCredentials> {
  if (current.reauthRequired) throw new GithubReauthRequiredError();

  if (!current.refreshToken) {
    if (options.onMissingRefreshToken === "returnUnchanged") return current;
    // A 401 with nothing to refresh with is unambiguous: this token is dead and
    // unrecoverable without the user reconnecting.
    await persistCredentialsIfUnchanged(prisma, integrationId, currentRaw, { ...current, reauthRequired: true });
    throw new GithubReauthRequiredError();
  }

  let refreshed;
  try {
    refreshed = await refreshAccessToken(current.refreshToken, config);
  } catch (error) {
    if (error instanceof GithubOAuthError && error.requiresReauth) {
      // Another instance may have used this single-use refresh token first.
      // If the row has moved on, adopt its tokens instead of marking reauth.
      const latest = await readCredentials(prisma, integrationId);
      if (latest.plaintext.refreshToken !== current.refreshToken || latest.plaintext.accessToken !== current.accessToken) {
        if (latest.plaintext.reauthRequired) throw new GithubReauthRequiredError();
        return latest.plaintext;
      }
      await persistCredentialsIfUnchanged(prisma, integrationId, currentRaw, { ...current, reauthRequired: true });
      throw new GithubReauthRequiredError();
    }
    throw error;
  }

  // The token response carries only the token fields; keep owner/repo, but
  // don't let a stale expiry or refresh token survive a response without one.
  const next: GithubCredentials = { ...current, ...refreshed };
  if (refreshed.expiresAt === undefined) delete next.expiresAt;
  if (refreshed.refreshToken === undefined) delete next.refreshToken;
  return persistCredentialsIfUnchanged(prisma, integrationId, currentRaw, next);
}

function refreshWithSingleFlight(
  prisma: PrismaClient,
  integrationId: string,
  config: Pick<GithubOAuthConfig, "clientId" | "clientSecret">,
  current: GithubCredentials,
  currentRaw: GithubCredentials,
  options: { onMissingRefreshToken: "returnUnchanged" | "requireReauth" },
): Promise<GithubCredentials> {
  const existing = inFlightRefreshes.get(integrationId);
  if (existing) return existing;

  const promise = doRefresh(prisma, integrationId, config, current, currentRaw, options).finally(() => {
    inFlightRefreshes.delete(integrationId);
  });
  inFlightRefreshes.set(integrationId, promise);
  return promise;
}

/** Loads current credentials, refreshing first if the access token is near expiry. */
export async function loadFreshGithubCredentials(
  prisma: PrismaClient,
  integrationId: string,
  config: Pick<GithubOAuthConfig, "clientId" | "clientSecret">,
): Promise<GithubCredentials> {
  const { raw, plaintext } = await readCredentials(prisma, integrationId);
  if (plaintext.reauthRequired) throw new GithubReauthRequiredError();
  if (!isExpiringSoon(plaintext)) return plaintext;
  return refreshWithSingleFlight(prisma, integrationId, config, plaintext, raw, { onMissingRefreshToken: "returnUnchanged" });
}

/**
 * GithubClient's 401 fallback. Re-reads current credentials first: if another
 * process already refreshed or reconnected since our request was made with
 * `failedCredentials`, we adopt that instead of refreshing again. Otherwise it
 * refreshes, or marks the integration for reauth when there's no refresh token.
 */
export async function refreshAfterUnauthorized(
  prisma: PrismaClient,
  integrationId: string,
  config: Pick<GithubOAuthConfig, "clientId" | "clientSecret">,
  failedCredentials: GithubCredentials,
): Promise<GithubCredentials> {
  const { raw, plaintext } = await readCredentials(prisma, integrationId);
  if (plaintext.reauthRequired) throw new GithubReauthRequiredError();
  if (plaintext.accessToken !== failedCredentials.accessToken) return plaintext;
  return refreshWithSingleFlight(prisma, integrationId, config, plaintext, raw, { onMissingRefreshToken: "requireReauth" });
}
