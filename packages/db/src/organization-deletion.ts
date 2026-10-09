import { hostname } from "node:os";
import pg from "pg";
import { organizationSlaLockKey } from "./organization-lock";

/**
 * The supported way to delete one organization and everything it owns
 * (D34: raw events live as long as their organization and go only with it).
 * Runbook: `docs/data-retention-and-on-call.md`, "Deleting an organization".
 *
 * The database does the deleting: every tenant table cascades from
 * `organizations`, and the four in-tenant `ON DELETE RESTRICT` keys
 * (`normalized_events.sourceRawEventId`, `commitments.policyVersionId`,
 * `commitments.calendarVersionId`, `sla_policy_versions.calendarVersionId`)
 * are satisfied because the referencing rows go in the same statement. No
 * foreign key is weakened. This module only makes that one statement safe to
 * run on a live system:
 *
 *  1. Identify: an explicit id, the organization's exact name and the
 *     database name must all match; nothing has a default.
 *  2. Pause polling on the organization's integrations (the admin console's
 *     `pause_polling`, audited the same way), so no new provider fetch starts.
 *  3. Take the organization's worker lease (`organization_work_states`) the
 *     way a worker claims it, waiting for a running cycle to finish: no worker
 *     can start a cycle for it, and a worker whose lease had already expired
 *     is fenced by the token increment.
 *  4. In one transaction: take the `sla-processing` advisory lock every
 *     projection and pipeline writer takes (worker, webhooks, web backfills),
 *     re-check the lease and the name, record a `delete_organization` audit
 *     row, delete, verify nothing tenant-scoped is left, commit.
 *
 * All-or-nothing: a failure or timeout before COMMIT deletes nothing and
 * writes no deletion audit row; the lease is released and the paused
 * integrations stay paused (reported), so the same command can be re-run.
 * Re-running after success reports `already_deleted`. Raw ingestion
 * (webhook and backfill RawEvent inserts) does not take the advisory lock;
 * foreign keys make it safe: an insert that commits first is deleted by the
 * cascade, one that comes after fails on the missing integration.
 *
 * `admin_audit_logs` is platform data with no foreign key (an audit row
 * outlives what it describes) and is deliberately kept.
 */

export interface DeleteOrganizationOptions {
  connectionString: string;
  organizationId: string;
  /** Must equal `organizations.name` exactly (required to execute). */
  confirmName?: string;
  /** Must equal `current_database()`. Guards against the wrong `DATABASE_URL`. */
  expectDatabase: string;
  /** Operator recorded on the audit rows (required to execute). */
  actorEmail?: string;
  /** False (the default) only describes what would be deleted. */
  execute?: boolean;
  /** How long to wait for a running worker cycle to release the lease. Default 10 minutes. */
  leaseWaitMs?: number;
  /** How long to wait for the `sla-processing` advisory lock. Default 15 minutes, as `withOrganizationSlaLock`. */
  lockTimeoutMs?: number;
  /** Per-statement limit inside the delete transaction. Default 30 minutes. */
  statementTimeoutMs?: number;
  /** Lease held for the deletion; must outlast the lock wait plus the delete. Default 60 minutes. */
  deletionLeaseMs?: number;
  /** Poll interval while waiting for the lease. Default 2 seconds. */
  pollMs?: number;
  /** Structured progress events; never given credentials or payloads. */
  log?: (event: string, fields: Record<string, unknown>) => void;
  /** Test hook, called inside the delete transaction just before the DELETE. */
  beforeDelete?: (client: pg.Client) => Promise<void>;
}

export type DeletionStatus = "dry_run" | "deleted" | "already_deleted" | "not_found" | "refused" | "failed";

export interface DeletionReport {
  status: DeletionStatus;
  organizationId: string;
  database?: string;
  organization?: { name: string; createdAt: string; integrations: { id: string; provider: string; status: string; pollingPaused: boolean }[] };
  /** Rows owned by the organization, by table (`raw_events.ticket_snapshots` counts `ticket:` snapshot rows). */
  counts?: Record<string, number>;
  /** Integrations this run paused (they stay paused if the deletion did not complete). */
  pausedIntegrationIds: string[];
  reason?: string;
  /** What an operator still has to do by hand. */
  followUps: string[];
  durationMs?: number;
}

const DELETE_ACTION = "delete_organization";
/** Retained by design; never counted as left-behind tenant data. */
const RETAINED_TABLES = new Set(["admin_audit_logs"]);

export async function deleteOrganization(options: DeleteOrganizationOptions): Promise<DeletionReport> {
  const leaseWaitMs = options.leaseWaitMs ?? 10 * 60_000;
  const lockTimeoutMs = options.lockTimeoutMs ?? 15 * 60_000;
  const statementTimeoutMs = options.statementTimeoutMs ?? 30 * 60_000;
  const deletionLeaseMs = options.deletionLeaseMs ?? 60 * 60_000;
  const pollMs = options.pollMs ?? 2_000;
  const log = options.log ?? (() => {});
  const { organizationId } = options;
  const report: DeletionReport = { status: "refused", organizationId, pausedIntegrationIds: [], followUps: [] };

  if (!organizationId?.trim()) return { ...report, reason: "organizationId is required" };
  if (deletionLeaseMs <= lockTimeoutMs + statementTimeoutMs) {
    return { ...report, reason: "deletionLeaseMs must exceed lockTimeoutMs + statementTimeoutMs" };
  }
  if (options.execute) {
    if (!options.confirmName) return { ...report, reason: "confirmName is required to execute" };
    if (!options.actorEmail?.includes("@")) return { ...report, reason: "actorEmail is required to execute" };
  }

  const client = new pg.Client({ connectionString: options.connectionString });
  await client.connect();
  const owner = `org-deletion:${hostname()}:${process.pid}`;
  let leaseToken: string | null = null;
  const started = performance.now();
  try {
    const database = (await client.query<{ db: string }>("SELECT current_database() AS db")).rows[0]!.db;
    report.database = database;
    if (database !== options.expectDatabase) {
      return { ...report, reason: `connected to database "${database}", expected "${options.expectDatabase}"` };
    }

    const org = (
      await client.query<{ name: string; createdAt: Date }>(`SELECT name, "createdAt" FROM organizations WHERE id = $1`, [organizationId])
    ).rows[0];
    if (!org) {
      const audited = await client.query(`SELECT 1 FROM admin_audit_logs WHERE action = $1 AND "organizationId" = $2 LIMIT 1`, [
        DELETE_ACTION,
        organizationId,
      ]);
      const status: DeletionStatus = audited.rowCount ? "already_deleted" : "not_found";
      log(`organization_deletion_${status}`, { organizationId });
      return { ...report, status, reason: audited.rowCount ? "a delete_organization audit row exists for this id" : "no such organization" };
    }

    const integrations = (
      await client.query<{ id: string; provider: string; status: string; pollingPausedAt: Date | null }>(
        `SELECT id, provider::text, status::text, "pollingPausedAt" FROM integrations WHERE "organizationId" = $1 ORDER BY id`,
        [organizationId],
      )
    ).rows;
    report.organization = {
      name: org.name,
      createdAt: org.createdAt.toISOString(),
      integrations: integrations.map((i) => ({ id: i.id, provider: i.provider, status: i.status, pollingPaused: i.pollingPausedAt !== null })),
    };
    report.counts = await countOwnedRows(client, organizationId);
    report.followUps = followUps([...integrations.map((i) => i.provider), ...(report.counts.slack_integrations ? ["slack"] : [])]);

    if (!options.execute) return { ...report, status: "dry_run" };
    if (options.confirmName !== org.name) {
      return { ...report, status: "refused", reason: "confirmName does not match the organization's name" };
    }

    log("organization_deletion_started", { organizationId, integrations: integrations.length });

    // 2. Pause polling (idempotent: only integrations not already paused; disconnected ones are never polled).
    await client.query("BEGIN");
    const paused = await client.query<{ id: string; provider: string }>(
      `UPDATE integrations SET "pollingPausedAt" = now()
        WHERE "organizationId" = $1 AND "pollingPausedAt" IS NULL AND status <> 'disconnected'
        RETURNING id, provider::text`,
      [organizationId],
    );
    for (const row of paused.rows) {
      await insertAudit(client, options.actorEmail!, "pause_polling", organizationId, row.id, { provider: row.provider, reason: "organization_deletion" });
    }
    await client.query("COMMIT");
    report.pausedIntegrationIds = paused.rows.map((r) => r.id);
    log("organization_deletion_polling_paused", { organizationId, paused: paused.rowCount ?? 0 });

    // 3. Take the worker lease, waiting for a running cycle to end.
    await client.query(`INSERT INTO organization_work_states ("organizationId") VALUES ($1) ON CONFLICT DO NOTHING`, [organizationId]);
    const waitUntil = performance.now() + leaseWaitMs;
    for (;;) {
      const claimed = await client.query<{ leaseToken: string }>(
        `UPDATE organization_work_states SET "leaseOwner" = $2, "leaseKind" = 'reconciliation', "leaseToken" = "leaseToken" + 1,
                "leaseExpiresAt" = now() + $3::int * interval '1 millisecond', "lastStartedAt" = now()
          WHERE "organizationId" = $1 AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" <= now())
          RETURNING "leaseToken"::text`,
        [organizationId, owner, deletionLeaseMs],
      );
      if (claimed.rowCount) {
        leaseToken = claimed.rows[0]!.leaseToken;
        break;
      }
      if (performance.now() >= waitUntil) throw new DeletionError("a worker still holds this organization's lease; retry when its cycle has finished");
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
    log("organization_deletion_lease_taken", { organizationId });

    // 4. Delete, all or nothing.
    await client.query("BEGIN");
    await client.query(`SET LOCAL lock_timeout = '${Math.floor(lockTimeoutMs)}ms'`);
    await client.query(`SET LOCAL statement_timeout = '${Math.floor(statementTimeoutMs)}ms'`);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [organizationSlaLockKey(organizationId)]);
    const held = await client.query(
      `SELECT 1 FROM organization_work_states
        WHERE "organizationId" = $1 AND "leaseOwner" = $2 AND "leaseToken" = $3::bigint AND "leaseExpiresAt" > now()
        FOR UPDATE`,
      [organizationId, owner, leaseToken],
    );
    if (!held.rowCount) throw new DeletionError("the deletion lease was lost before the delete");
    const still = await client.query<{ name: string }>(`SELECT name FROM organizations WHERE id = $1 FOR UPDATE`, [organizationId]);
    if (still.rows[0]?.name !== options.confirmName) throw new DeletionError("the organization changed name or vanished after confirmation");
    const integrationIds = (await client.query<{ id: string }>(`SELECT id FROM integrations WHERE "organizationId" = $1`, [organizationId])).rows.map(
      (r) => r.id,
    );
    report.counts = await countOwnedRows(client, organizationId);
    await insertAudit(client, options.actorEmail!, DELETE_ACTION, organizationId, null, {
      counts: report.counts,
      providers: integrations.map((i) => i.provider),
      createdAt: org.createdAt.toISOString(),
    });
    await options.beforeDelete?.(client);
    const deleted = await client.query(`DELETE FROM organizations WHERE id = $1`, [organizationId]);
    if (deleted.rowCount !== 1) throw new DeletionError(`expected to delete 1 organization, deleted ${deleted.rowCount}`);
    const left = await leftBehind(client, organizationId, integrationIds);
    if (Object.keys(left).length > 0) throw new DeletionError(`tenant rows left after the delete: ${JSON.stringify(left)}`);
    await client.query("COMMIT");
    leaseToken = null; // the work-state row went with the organization

    report.status = "deleted";
    report.durationMs = Math.round(performance.now() - started);
    report.pausedIntegrationIds = [];
    log("organization_deletion_completed", { organizationId, durationMs: report.durationMs, counts: report.counts });
    return report;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    const reason = error instanceof DeletionError ? error.message : `${error instanceof Error ? error.name : "Error"}: ${pgMessage(error)}`;
    log("organization_deletion_failed", { organizationId, reason, pausedIntegrations: report.pausedIntegrationIds.length });
    if (report.pausedIntegrationIds.length > 0) {
      report.followUps.unshift(
        `Nothing was deleted. ${report.pausedIntegrationIds.length} integration(s) were paused by this run and stay paused: re-run the same command, or resume them in the admin console if the deletion is abandoned.`,
      );
    }
    return { ...report, status: "failed", reason, durationMs: Math.round(performance.now() - started) };
  } finally {
    if (leaseToken) {
      await client
        .query(
          `UPDATE organization_work_states SET "leaseOwner" = NULL, "leaseKind" = NULL, "leaseExpiresAt" = NULL
            WHERE "organizationId" = $1 AND "leaseOwner" = $2 AND "leaseToken" = $3::bigint`,
          [organizationId, owner, leaseToken],
        )
        .catch(() => {});
    }
    await client.end();
  }
}

class DeletionError extends Error {}

/** A pg error's message and code, never its `detail` (which can quote row values). */
function pgMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const code = (error as { code?: string }).code;
  return code ? `${error.message} (${code})` : error.message;
}

async function insertAudit(
  client: pg.Client,
  actorEmail: string,
  action: string,
  organizationId: string,
  integrationId: string | null,
  metadata: Record<string, unknown>,
) {
  // Same row shape as `recordAdminAudit` (apps/web/src/lib/admin-audit.ts); the id only needs to be unique.
  await client.query(
    `INSERT INTO admin_audit_logs (id, "actorEmail", action, "organizationId", "integrationId", metadata)
     VALUES ('del' || replace(gen_random_uuid()::text, '-', ''), $1, $2, $3, $4, $5::jsonb)`,
    [actorEmail, action, organizationId, integrationId, JSON.stringify(metadata)],
  );
}

/** Every table with an `organizationId` column, read from the catalog so a new tenant table is covered without editing this file. */
async function tenantTables(client: pg.Client): Promise<string[]> {
  const rows = await client.query<{ table: string }>(
    `SELECT c.table_name AS table FROM information_schema.columns c
       JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
      WHERE c.table_schema = current_schema() AND c.column_name = 'organizationId'
      ORDER BY 1`,
  );
  return rows.rows.map((r) => r.table).filter((t) => !RETAINED_TABLES.has(t));
}

const quote = (identifier: string) => `"${identifier.replace(/"/g, '""')}"`;

async function countOwnedRows(client: pg.Client, organizationId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of await tenantTables(client)) {
    const n = Number((await client.query<{ n: string }>(`SELECT count(*) AS n FROM ${quote(table)} WHERE "organizationId" = $1`, [organizationId])).rows[0]!.n);
    if (n > 0) counts[table] = n;
  }
  // Tables reached only through a parent (no organizationId column of their own).
  const derived: Record<string, string> = {
    raw_events: `SELECT count(*) AS n FROM raw_events r JOIN integrations i ON i.id = r."integrationId" WHERE i."organizationId" = $1`,
    "raw_events.ticket_snapshots": `SELECT count(*) AS n FROM raw_events r JOIN integrations i ON i.id = r."integrationId" WHERE i."organizationId" = $1 AND starts_with(r."providerEventId", 'ticket:')`,
    normalized_events: `SELECT count(*) AS n FROM normalized_events e JOIN cases c ON c.id = e."caseId" WHERE c."organizationId" = $1`,
    commitments: `SELECT count(*) AS n FROM commitments m JOIN cases c ON c.id = m."caseId" WHERE c."organizationId" = $1`,
    evaluations: `SELECT count(*) AS n FROM evaluations v JOIN commitments m ON m.id = v."commitmentId" JOIN cases c ON c.id = m."caseId" WHERE c."organizationId" = $1`,
  };
  for (const [label, sql] of Object.entries(derived)) {
    if (counts[label] !== undefined) continue;
    const n = Number((await client.query<{ n: string }>(sql, [organizationId])).rows[0]!.n);
    if (n > 0) counts[label] = n;
  }
  return counts;
}

async function leftBehind(client: pg.Client, organizationId: string, integrationIds: string[]): Promise<Record<string, number>> {
  const left: Record<string, number> = {};
  for (const table of await tenantTables(client)) {
    const n = Number((await client.query<{ n: string }>(`SELECT count(*) AS n FROM ${quote(table)} WHERE "organizationId" = $1`, [organizationId])).rows[0]!.n);
    if (n > 0) left[table] = n;
  }
  if (integrationIds.length > 0) {
    const n = Number((await client.query<{ n: string }>(`SELECT count(*) AS n FROM raw_events WHERE "integrationId" = ANY($1)`, [integrationIds])).rows[0]!.n);
    if (n > 0) left.raw_events = n;
  }
  return left;
}

function followUps(providers: string[]): string[] {
  const steps = [
    "Backups: existing dumps still contain this organization until they age out (local RETENTION_DAYS; off-site per the bucket's policy). Restoring a dump taken before this deletion brings it back; delete it again after such a restore.",
    "Audit: admin_audit_logs rows naming this organization are kept by design (platform record, no tenant read path).",
  ];
  if (providers.length > 0) {
    steps.push(
      `Provider side: Elapsed revokes nothing at the provider (${[...new Set(providers)].join(", ")}); the customer removes the app, OAuth grant or API token there if they want access gone.`,
    );
  }
  const hooked = [...new Set(providers)].filter((p) => p === "zendesk" || p === "jira");
  if (hooked.length > 0) {
    steps.push(
      `Webhooks (${hooked.join(", ")}): deliveries to /api/webhooks/<provider>/<integrationId> now get 404 and are not stored; the customer removes the webhook or trigger in the provider.`,
    );
  }
  return steps;
}
