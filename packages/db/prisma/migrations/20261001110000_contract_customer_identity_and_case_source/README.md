# N2.10 — contract migration (ships with N10-F1 in one release)

Owner decision 2026-10-16 (Decision 8, option B): N2.10 and N10-F1
(`20261011120000_n10_f1_drop_custom_provider_enabled`) ship together in one
release. The release procedure is ledger check **C-16** in
`docs/validation/server-validation-master.md`.

- `migration.sql` drops `Customer.zendeskOrgId` / `intercomCompanyId` / `intercomContactId` (and their keys) and `cases_organizationId_externalId_key`, and makes `Case.sourceIntegrationId` NOT NULL. It first re-runs the two expand backfills and aborts if any case still has no source integration.
- `rollback.sql` re-expands (apply by hand; see below).
- The matching `schema.prisma` change is applied in this release (it was `schema.patch` while the directory was held out in `prisma/contract/`).

**Order on purpose.** The directory keeps its original name, so `prisma migrate deploy` applies it **before** N10-F1 on a database that has neither (production). If N2.10's precondition aborts, its transaction rolls back and N10-F1 is not attempted: the database is unchanged apart from a failed `_prisma_migrations` row. Recover with `prisma migrate resolve --rolled-back 20261001110000_contract_customer_identity_and_case_source`, keep the previous release running, and fix the reported cases. A fresh install applies it in name order too; no later migration depends on the dropped columns (rehearsed: 70 migrations, `migrate diff` empty).

**Rollback after a successful release** (restoring the pre-release backup is the first choice): apply this `rollback.sql`, then `../20261011120000_n10_f1_drop_custom_provider_enabled/rollback.sql`, delete both rows from `_prisma_migrations`, and deploy the previous release. Rehearsed 2026-10-16: the result equals the previous release's schema (`migrate diff` empty) and its code reads it with 0 L1 differences.
