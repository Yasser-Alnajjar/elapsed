-- N6.5 (internal): billing account, subscription, invoices and billing
-- history. Additive only: four new tables and one new enum. Nothing existing
-- is altered, so the previous release runs unchanged against this schema.

CREATE TYPE "BillingInvoiceStatus" AS ENUM ('open', 'paid', 'void');

CREATE TABLE "billing_accounts" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "billingEmail" TEXT,
  "legalName" TEXT,
  "addressLines" TEXT[],
  "country" TEXT,
  "taxId" TEXT,
  "ccEmails" TEXT[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "billing_accounts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "billing_accounts_organizationId_key" ON "billing_accounts"("organizationId");
ALTER TABLE "billing_accounts"
  ADD CONSTRAINT "billing_accounts_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "billing_subscriptions" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "billingAccountId" TEXT NOT NULL,
  "plan" TEXT NOT NULL,
  "status" "PlanStatus" NOT NULL,
  "seatQuantity" INTEGER NOT NULL,
  "unitPriceCents" INTEGER,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "currentPeriodStart" TIMESTAMP(3) NOT NULL,
  "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
  "trialEndsAt" TIMESTAMP(3),
  "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
  "cancelRequestedAt" TIMESTAMP(3),
  "endedAt" TIMESTAMP(3),
  "pendingPlan" TEXT,
  "version" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "billing_subscriptions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_subscriptions_seatQuantity_check" CHECK ("seatQuantity" >= 1),
  CONSTRAINT "billing_subscriptions_period_check" CHECK ("currentPeriodEnd" > "currentPeriodStart")
);
CREATE UNIQUE INDEX "billing_subscriptions_organizationId_key" ON "billing_subscriptions"("organizationId");
CREATE UNIQUE INDEX "billing_subscriptions_billingAccountId_key" ON "billing_subscriptions"("billingAccountId");
ALTER TABLE "billing_subscriptions"
  ADD CONSTRAINT "billing_subscriptions_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "billing_subscriptions"
  ADD CONSTRAINT "billing_subscriptions_billingAccountId_fkey"
  FOREIGN KEY ("billingAccountId") REFERENCES "billing_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "billing_invoices" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "subscriptionId" TEXT NOT NULL,
  "number" TEXT NOT NULL,
  "status" "BillingInvoiceStatus" NOT NULL DEFAULT 'open',
  "reason" TEXT NOT NULL,
  "plan" TEXT NOT NULL,
  "seatQuantity" INTEGER NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "lines" JSONB NOT NULL,
  "totalCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "idempotencyKey" TEXT NOT NULL,
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dueAt" TIMESTAMP(3) NOT NULL,
  "paidAt" TIMESTAMP(3),
  "voidedAt" TIMESTAMP(3),

  CONSTRAINT "billing_invoices_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_invoices_totalCents_check" CHECK ("totalCents" >= 0)
);
CREATE UNIQUE INDEX "billing_invoices_organizationId_number_key" ON "billing_invoices"("organizationId", "number");
CREATE UNIQUE INDEX "billing_invoices_organizationId_idempotencyKey_key" ON "billing_invoices"("organizationId", "idempotencyKey");
CREATE INDEX "billing_invoices_organizationId_issuedAt_idx" ON "billing_invoices"("organizationId", "issuedAt");
CREATE INDEX "billing_invoices_subscriptionId_idx" ON "billing_invoices"("subscriptionId");
ALTER TABLE "billing_invoices"
  ADD CONSTRAINT "billing_invoices_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "billing_invoices"
  ADD CONSTRAINT "billing_invoices_subscriptionId_fkey"
  FOREIGN KEY ("subscriptionId") REFERENCES "billing_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "billing_events" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "actorType" TEXT NOT NULL,
  "actorEmail" TEXT,
  "data" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "billing_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "billing_events_organizationId_createdAt_idx" ON "billing_events"("organizationId", "createdAt");
ALTER TABLE "billing_events"
  ADD CONSTRAINT "billing_events_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
