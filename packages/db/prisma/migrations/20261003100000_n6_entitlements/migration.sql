-- N6: entitlements. Additive only; the new column has a default and the new
-- table is new, so the previous release keeps running unchanged against this
-- schema and reverting the code leaves everything here inert.

-- N6.3: operator switch, off by default.
ALTER TABLE "worker_settings" ADD COLUMN "entitlementsEnforced" BOOLEAN NOT NULL DEFAULT false;

-- N6.3 / N6.4: what an entitlement check found. The unique key makes each
-- write idempotent per organization, kind and dedupe key.
CREATE TABLE "entitlement_events" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "resource" TEXT,
  "dedupeKey" TEXT NOT NULL,
  "used" INTEGER,
  "limit" INTEGER,
  "notifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "entitlement_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "entitlement_events_organizationId_kind_dedupeKey_key"
  ON "entitlement_events"("organizationId", "kind", "dedupeKey");
CREATE INDEX "entitlement_events_organizationId_createdAt_idx"
  ON "entitlement_events"("organizationId", "createdAt");

ALTER TABLE "entitlement_events"
  ADD CONSTRAINT "entitlement_events_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
