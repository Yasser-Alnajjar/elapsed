# N2.10 — contract migration (held back, not deployable yet)

Not in `prisma/migrations`, so `prisma migrate deploy` never applies it by accident.

- `migration.sql` drops `Customer.zendeskOrgId` / `intercomCompanyId` / `intercomContactId` (and their keys) and `cases_organizationId_externalId_key`, and makes `Case.sourceIntegrationId` NOT NULL.
- `schema.patch` is the matching `schema.prisma` change (`git apply` from the repo root).
- `rollback.sql` re-expands (apply by hand).

Preconditions (roadmap N2.10): one production release on the N1/N2 dual-write code, a verified backup, and a clean production-backup L1/L2 replay. To ship: move this directory into `prisma/migrations/`, apply `schema.patch`, run `pnpm --filter @sla/db generate`, deploy it as its own release. Everything else in N2 runs against either schema.
