import type { IntegrationProvider, PrismaClient } from "../generated/prisma/client";
import { generateSecureToken, hashToken } from "./secure-token";

/** Short-lived on purpose: the link is for one hand-off to a tracker admin, not a standing credential. */
export const CONNECT_LINK_TTL_MS = 72 * 60 * 60 * 1000;

/** Only work trackers can be connected this way (D26): the point is a tracker admin who is not an Elapsed member. */
export const CONNECT_LINK_PROVIDERS = ["jira", "linear"] as const satisfies readonly IntegrationProvider[];

export type ConnectLinkProvider = (typeof CONNECT_LINK_PROVIDERS)[number];

export function isConnectLinkProvider(value: unknown): value is ConnectLinkProvider {
  return typeof value === "string" && (CONNECT_LINK_PROVIDERS as readonly string[]).includes(value);
}

export type ConnectLinkFailure = "not_found" | "expired" | "consumed";

export class ConnectLinkError extends Error {
  constructor(readonly reason: ConnectLinkFailure) {
    super(
      reason === "expired"
        ? "This connect link has expired"
        : reason === "consumed"
          ? "This connect link has already been used"
          : "Connect link not found",
    );
    this.name = "ConnectLinkError";
  }
}

export interface ValidConnectLink {
  id: string;
  organizationId: string;
  organizationName: string;
  provider: ConnectLinkProvider;
  intendedFor: string | null;
  expiresAt: Date;
}

/** Returns the raw token exactly once; only its hash is stored. */
export async function createConnectLink(
  prisma: PrismaClient,
  input: {
    organizationId: string;
    provider: ConnectLinkProvider;
    intendedFor?: string | null;
    createdByUserId: string;
    now?: Date;
  },
): Promise<{ token: string; id: string; expiresAt: Date }> {
  const now = input.now ?? new Date();
  const token = generateSecureToken();
  const expiresAt = new Date(now.getTime() + CONNECT_LINK_TTL_MS);
  const intendedFor = input.intendedFor?.trim().slice(0, 120) || null;
  const row = await prisma.integrationConnectLink.create({
    data: {
      organizationId: input.organizationId,
      provider: input.provider,
      tokenHash: hashToken(token),
      intendedFor,
      createdByUserId: input.createdByUserId,
      expiresAt,
    },
    select: { id: true },
  });
  return { token, id: row.id, expiresAt };
}

/** Throws `ConnectLinkError` unless the link exists, is unexpired and unconsumed. Read-only. */
export async function resolveConnectLink(
  prisma: PrismaClient,
  token: string,
  now: Date = new Date(),
): Promise<ValidConnectLink> {
  const row = await prisma.integrationConnectLink.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { organization: { select: { name: true } } },
  });
  if (!row || !isConnectLinkProvider(row.provider)) throw new ConnectLinkError("not_found");
  return assertUsable(row, now);
}

/** Same checks, by link id (the OAuth callback only carries the id inside its signed state). */
export async function resolveConnectLinkById(
  prisma: PrismaClient,
  id: string,
  now: Date = new Date(),
): Promise<ValidConnectLink> {
  const row = await prisma.integrationConnectLink.findUnique({
    where: { id },
    include: { organization: { select: { name: true } } },
  });
  if (!row || !isConnectLinkProvider(row.provider)) throw new ConnectLinkError("not_found");
  return assertUsable(row, now);
}

function assertUsable(
  row: {
    id: string;
    organizationId: string;
    provider: string;
    intendedFor: string | null;
    expiresAt: Date;
    consumedAt: Date | null;
    organization: { name: string };
  },
  now: Date,
): ValidConnectLink {
  if (row.consumedAt) throw new ConnectLinkError("consumed");
  if (row.expiresAt.getTime() <= now.getTime()) throw new ConnectLinkError("expired");
  return {
    id: row.id,
    organizationId: row.organizationId,
    organizationName: row.organization.name,
    provider: row.provider as ConnectLinkProvider,
    intendedFor: row.intendedFor,
    expiresAt: row.expiresAt,
  };
}

/**
 * Atomically marks the link used. Returns false if it was already consumed or
 * has expired, so of two concurrent callbacks exactly one wins. Scoped by
 * organization and provider as well as id: a link can never be spent on
 * anything but the grant it was made for.
 */
export async function consumeConnectLink(
  prisma: PrismaClient,
  input: { id: string; organizationId: string; provider: ConnectLinkProvider; now?: Date },
): Promise<boolean> {
  const now = input.now ?? new Date();
  const { count } = await prisma.integrationConnectLink.updateMany({
    where: {
      id: input.id,
      organizationId: input.organizationId,
      provider: input.provider,
      consumedAt: null,
      expiresAt: { gt: now },
    },
    data: { consumedAt: now },
  });
  return count === 1;
}

/** Label recorded on `Integration.connectedBy`. */
export function connectLinkLabel(link: { intendedFor: string | null }): string {
  return `connect link${link.intendedFor ? `: ${link.intendedFor}` : ""}`;
}

export async function listActiveConnectLinks(prisma: PrismaClient, organizationId: string, now: Date = new Date()) {
  return prisma.integrationConnectLink.findMany({
    where: { organizationId, consumedAt: null, expiresAt: { gt: now } },
    orderBy: { createdAt: "desc" },
    select: { id: true, provider: true, intendedFor: true, expiresAt: true, createdAt: true },
  });
}

export async function revokeConnectLink(prisma: PrismaClient, organizationId: string, id: string): Promise<boolean> {
  const { count } = await prisma.integrationConnectLink.deleteMany({
    where: { id, organizationId, consumedAt: null },
  });
  return count === 1;
}
