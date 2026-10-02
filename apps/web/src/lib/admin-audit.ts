import type { Prisma, PrismaClient } from "@sla/db";
import type { AdminAuditAction, AdminAuditData, AdminAuditFilters } from "./types/admin";

/**
 * The admin audit log (N4.2) is append-only, and this module is how that is
 * enforced: it is the only code that touches `AdminAuditLog`, and it exposes
 * exactly two operations, `recordAdminAudit` (a `create`) and
 * `listAdminAuditLog` (a read). There is no update or delete path anywhere in
 * the codebase; `admin-boundary.test.ts` fails if one appears.
 */

/** Anything with an `adminAuditLog` delegate: the client, or a `$transaction` client. */
type AuditDb = Pick<Prisma.TransactionClient, "adminAuditLog">;

export interface AdminAuditEntry {
  actorEmail: string;
  action: AdminAuditAction;
  organizationId?: string | null;
  integrationId?: string | null;
  /** What changed. Never a credential or a secret. */
  metadata?: Prisma.InputJsonValue;
}

/**
 * Writes one audit row. Mutations call this with the same transaction client
 * as the change itself, so a change and its audit row commit or fail together.
 */
export async function recordAdminAudit(db: AuditDb, entry: AdminAuditEntry): Promise<void> {
  await db.adminAuditLog.create({
    data: {
      actorEmail: entry.actorEmail,
      action: entry.action,
      organizationId: entry.organizationId ?? null,
      integrationId: entry.integrationId ?? null,
      metadata: entry.metadata,
    },
  });
}

const DEFAULT_PAGE_SIZE = 50;

/** The `where` for a set of filters. Filters only choose which rows to read; nothing here can alter or hide a row's contents. */
function whereForFilters(filters: AdminAuditFilters): Prisma.AdminAuditLogWhereInput {
  const actor = filters.actor?.trim();
  return {
    // An explicit action wins over "hide views": asking for one action is already a narrower question.
    ...(filters.action ? { action: filters.action } : filters.hideViews ? { action: { not: "view_tenant" } } : {}),
    ...(actor ? { actorEmail: { contains: actor, mode: "insensitive" } } : {}),
    ...(filters.organizationId ? { organizationId: filters.organizationId } : {}),
  };
}

/**
 * Newest first, cursor-paginated by row id. `before` is the previous page's
 * `nextCursor`. `filters` narrows what is read (see `whereForFilters`).
 */
export async function listAdminAuditLog(
  prisma: PrismaClient,
  options: { limit?: number; before?: string | null; filters?: AdminAuditFilters } = {},
): Promise<AdminAuditData> {
  const limit = options.limit ?? DEFAULT_PAGE_SIZE;
  const rows = await prisma.adminAuditLog.findMany({
    where: whereForFilters(options.filters ?? {}),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(options.before ? { cursor: { id: options.before }, skip: 1 } : {}),
  });
  const page = rows.slice(0, limit);

  // The log outlives the organizations it names, so names are looked up, not joined.
  const organizationIds = [...new Set(page.flatMap((row) => (row.organizationId ? [row.organizationId] : [])))];
  const organizations = organizationIds.length
    ? await prisma.organization.findMany({ where: { id: { in: organizationIds } }, select: { id: true, name: true } })
    : [];
  const nameById = new Map(organizations.map((organization) => [organization.id, organization.name]));

  return {
    rows: page.map((row) => ({
      id: row.id,
      actorEmail: row.actorEmail,
      action: row.action,
      organizationId: row.organizationId,
      organizationName: row.organizationId ? (nameById.get(row.organizationId) ?? null) : null,
      integrationId: row.integrationId,
      metadata: row.metadata,
      createdAt: row.createdAt.toISOString(),
    })),
    nextCursor: rows.length > limit ? (page[page.length - 1]?.id ?? null) : null,
  };
}
