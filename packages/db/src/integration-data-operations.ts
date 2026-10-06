import type {
  IntegrationDataOperationKind,
  IntegrationDataOperationStatus,
  IntegrationProvider,
  Prisma,
  PrismaClient,
} from "../generated/prisma/client";

/** Who ran a Settings → Data operation. The email is kept as text so the record still names them after they are removed. */
export interface DataOperationActor {
  userId: string | null;
  email: string;
}

/**
 * The tenant-visible audit trail for backups and cleanups (see the
 * `IntegrationDataOperation` model). Rows are created `started` and finished
 * once; nothing edits or deletes them afterwards.
 */
export async function startIntegrationDataOperation(
  prisma: PrismaClient,
  input: {
    organizationId: string;
    integrationId: string;
    provider: IntegrationProvider;
    kind: IntegrationDataOperationKind;
    actor: DataOperationActor;
    details?: Prisma.InputJsonValue;
  },
): Promise<string> {
  const row = await prisma.integrationDataOperation.create({
    data: {
      organizationId: input.organizationId,
      integrationId: input.integrationId,
      provider: input.provider,
      kind: input.kind,
      actorUserId: input.actor.userId,
      actorEmail: input.actor.email,
      details: input.details,
    },
    select: { id: true },
  });
  return row.id;
}

/** Finishes a `started` operation once; a second call, or one for an already finished row, changes nothing. */
export async function finishIntegrationDataOperation(
  prisma: PrismaClient,
  id: string,
  outcome: { status: Exclude<IntegrationDataOperationStatus, "started">; details?: Prisma.InputJsonValue; error?: string },
): Promise<void> {
  await prisma.integrationDataOperation.updateMany({
    where: { id, status: "started" },
    data: { status: outcome.status, details: outcome.details, error: outcome.error, finishedAt: new Date() },
  });
}

export interface IntegrationDataOperationView {
  id: string;
  provider: IntegrationProvider;
  kind: IntegrationDataOperationKind;
  status: IntegrationDataOperationStatus;
  actorEmail: string;
  details: Prisma.JsonValue | null;
  error: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}

export async function listIntegrationDataOperations(
  prisma: PrismaClient,
  organizationId: string,
  limit = 20,
): Promise<IntegrationDataOperationView[]> {
  return prisma.integrationDataOperation.findMany({
    where: { organizationId },
    orderBy: { startedAt: "desc" },
    take: limit,
    select: {
      id: true,
      provider: true,
      kind: true,
      status: true,
      actorEmail: true,
      details: true,
      error: true,
      startedAt: true,
      finishedAt: true,
    },
  });
}
