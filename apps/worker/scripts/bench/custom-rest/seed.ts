/**
 * Synthetic, custom-shaped data for the §6.10 benchmark. Raw events are written
 * in exactly the form `buildTicketEvents` stores them (projected payloads,
 * `ticket:` / `comment:` / `history:` ids with source hashes), so the real
 * `deriveBatch`, guards, projector and pipelines process them. Nothing is
 * inserted into `NormalizedEvent` directly (§6.9 forbids that shortcut).
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createNativePolicy } from "@sla/commitments";
import {
  commentPaths,
  computeSourceHash,
  historyPaths,
  parseConfig,
  projectByPaths,
  storedSlaSupport,
  ticketPaths,
  validateConfig,
  type CustomConfig,
} from "@sla/custom-ticket";
import type { PrismaClient } from "@sla/db";

const RAW = { ticket: "ticket:", comment: "comment:", history: "history:" } as const;
const DAY = 86_400_000;
export const BASE_TIME = Date.parse("2026-09-01T00:00:00Z");

export interface SeedOptions {
  tickets: number;
  /** Raw snapshots per ticket (the latest is the live state). */
  snapshots: number;
  /** Comments per ticket. */
  comments: number;
  name: string;
}

export function loadConfig(): CustomConfig {
  const path = fileURLToPath(new URL("../../../../../packages/custom-ticket/dev/mock-helpdesk-config.json", import.meta.url));
  const raw = JSON.parse(readFileSync(path, "utf8"));
  raw.connection.baseUrl = "https://api.helpdesk.example.com"; // never contacted: polling is paused
  const parsed = parseConfig(raw);
  if (!parsed.ok) throw new Error(`benchmark config invalid: ${JSON.stringify(parsed.issues)}`);
  return parsed.config;
}

function ticketPayload(i: number, snapshot: number, snapshots: number) {
  const created = BASE_TIME + i * 60_000;
  const solved = i % 3 === 0;
  const waiting = i % 5 === 0 && !solved;
  const last = snapshot === snapshots - 1;
  const state = last ? (solved ? "solved" : waiting ? "waiting" : "open") : "open";
  const resolved = last && solved ? new Date(created + 5 * 3_600_000).toISOString() : null;
  return {
    id: `B-${i}`,
    subject: `Benchmark ticket ${i}: ${["Login fails", "Invoice question", "Export is slow", "Feature request", "Password reset"][i % 5]}`,
    created_at: new Date(created).toISOString(),
    updated_at: new Date(created + (snapshot + 1) * 600_000).toISOString(),
    resolved_at: resolved,
    state,
    priority: ["p1", "p2", "p3", "p4"][i % 4],
    account: { id: `A-${i % 50}`, name: `Customer ${i % 50}` },
    labels: i % 2 ? ["billing"] : ["bug", "web"],
    source: ["email", "chat", "web"][i % 3],
    internal_notes: "never stored",
  };
}

const hash = (value: unknown) => computeSourceHash(value);

export async function seedOrganization(prisma: PrismaClient, config: CustomConfig, options: SeedOptions): Promise<{ organizationId: string; integrationId: string }> {
  const organization = await prisma.organization.create({ data: { name: options.name } });
  const validation = validateConfig(config, { allowPrivateHosts: false });
  const slaSupport = validation.ok ? storedSlaSupport(validation) : null;
  const integration = await prisma.integration.create({
    data: {
      organizationId: organization.id,
      provider: "custom",
      status: "connected",
      activeConfigVersion: 1,
      pollingPausedAt: new Date(), // no provider fetch: ingestion is excluded from the §6.10 figures
      ...(slaSupport ? { slaSupport: slaSupport as never } : {}),
    },
  });
  await prisma.customProviderConfigVersion.create({
    data: {
      organizationId: organization.id,
      integrationId: integration.id,
      version: 1,
      schemaVersion: config.schemaVersion,
      config: config as never,
      configHash: createHash("sha256").update(JSON.stringify(config)).digest("hex"),
      validatedAt: new Date(),
    },
  });
  await prisma.integrationBetaAllowlist.create({ data: { provider: "custom", organizationId: organization.id, addedByEmail: "bench@elapsed.test" } });
  await createNativePolicy(prisma, organization.id, "Benchmark policy", {
    match: {},
    targets: [
      { kind: "first_response", minutes: 60 },
      { kind: "next_reply", minutes: 120 },
      { kind: "resolution", minutes: 480 },
    ],
    calendarId: undefined,
    warnAtPercent: undefined,
  } as never);

  const tPaths = ticketPaths(config);
  const cPaths = commentPaths(config);
  const hPaths = historyPaths(config);
  const rows: { integrationId: string; providerEventId: string; sourceHash: string; payload: object; fetchedAt: Date }[] = [];
  const flush = async () => {
    if (rows.length === 0) return;
    await prisma.rawEvent.createMany({ data: rows.splice(0, rows.length) as never });
  };
  for (let i = 0; i < options.tickets; i += 1) {
    const fetchedBase = BASE_TIME + options.tickets * 60_000 + i;
    for (let s = 0; s < options.snapshots; s += 1) {
      const item = ticketPayload(i, s, options.snapshots);
      const projection = projectByPaths(item, tPaths);
      const h = hash(projection);
      rows.push({ integrationId: integration.id, providerEventId: `${RAW.ticket}B-${i}:${h}`, sourceHash: h, payload: projection, fetchedAt: new Date(fetchedBase + s * 1000) });
    }
    const created = BASE_TIME + i * 60_000;
    for (let c = 0; c < options.comments; c += 1) {
      const comment = {
        id: `B-${i}-c${c}`,
        at: new Date(created + 20_000 + c * 900_000).toISOString(),
        author: { type: c % 2 === 0 ? "requester" : "agent", name: c % 2 === 0 ? "Customer" : "Agent" },
        public: true,
        body: `Comment ${c} of ticket ${i}`,
      };
      const body = { t: `B-${i}`, i: projectByPaths(comment, cPaths) };
      const h = hash(body);
      rows.push({ integrationId: integration.id, providerEventId: `${RAW.comment}B-${i}:${comment.id}:${h}`, sourceHash: h, payload: body, fetchedAt: new Date(fetchedBase) });
    }
    if (i % 3 === 0 && config.statusHistory) {
      const entry = { id: `B-${i}-h0`, at: new Date(created + 5 * 3_600_000).toISOString(), from: "open", to: "solved" };
      const body = { t: `B-${i}`, i: projectByPaths(entry, hPaths) };
      const h = hash(body);
      rows.push({ integrationId: integration.id, providerEventId: `${RAW.history}B-${i}:${entry.id}:${h}`, sourceHash: h, payload: body, fetchedAt: new Date(fetchedBase) });
    }
    if (rows.length >= 4000) await flush();
  }
  await flush();
  return { organizationId: organization.id, integrationId: integration.id };
}

/** Adds a new snapshot per selected ticket that flips it to solved with a source closing time (drives the lifecycle guard). */
export async function addClosingSnapshots(prisma: PrismaClient, config: CustomConfig, integrationId: string, ticketIndexes: number[]): Promise<number> {
  const tPaths = ticketPaths(config);
  const rows = ticketIndexes.map((i, n) => {
    const created = BASE_TIME + i * 60_000;
    const item = { ...ticketPayload(i, 0, 1), state: "solved", resolved_at: new Date(created + 7 * 3_600_000).toISOString(), updated_at: new Date(created + 8 * 3_600_000).toISOString() };
    const projection = projectByPaths(item, tPaths);
    const h = hash(projection);
    return { integrationId, providerEventId: `${RAW.ticket}B-${i}:${h}`, sourceHash: h, payload: projection, fetchedAt: new Date(BASE_TIME + 400 * DAY + n) };
  });
  for (let i = 0; i < rows.length; i += 4000) await prisma.rawEvent.createMany({ data: rows.slice(i, i + 4000) as never, skipDuplicates: true });
  return rows.length;
}
