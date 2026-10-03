/**
 * Prisma's unique-constraint violation (P2002): a concurrent writer inserted
 * the same key first. Matched on the error code rather than the error class
 * so it holds for errors raised inside a transaction client too.
 */
export function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}
