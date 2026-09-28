/**
 * `subscribeToLiveData` / `publishLiveDataEvent` (@sla/db): the dedicated
 * `LISTEN` connection every web process opens once, and the `NOTIFY` helper
 * `withOrganizationSlaLock` calls on commit. Real Postgres, like
 * organization-lock.test.ts. Needs a migrated database at TEST_DATABASE_URL
 * whose name contains "test"; skipped when unset.
 */
import pg from "pg";
import type { LiveDataEvent } from "@sla/db";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("subscribeToLiveData / publishLiveDataEvent (real Postgres)", () => {
  let db: typeof import("@sla/db");
  let publisher: pg.Client;

  beforeAll(async () => {
    const name = new URL(TEST_DATABASE_URL!).pathname.replace(/^\//, "");
    if (!/test/i.test(name)) {
      throw new Error(`TEST_DATABASE_URL points at database "${name}"; this suite truncates every table.`);
    }
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    db = await import("@sla/db");
  });

  beforeEach(async () => {
    publisher = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await publisher.connect();
  });

  afterEach(async () => {
    await publisher.end();
  });

  afterAll(async () => {
    await db.getPrismaClient().$disconnect();
  });

  it("delivers an event published on another connection", async () => {
    const events: LiveDataEvent[] = [];
    const subscription = db.subscribeToLiveData((event) => events.push(event), {
      connectionString: TEST_DATABASE_URL,
    });

    try {
      // Give the subscriber's own connect()+LISTEN a moment to land before publishing.
      await new Promise((resolve) => setTimeout(resolve, 300));

      await db.publishLiveDataEvent(publisher, {
        type: "data.updated",
        organizationId: "org-live-1",
        domains: ["cases"],
      });

      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(events).toEqual([
        { type: "data.updated", organizationId: "org-live-1", domains: ["cases"] },
      ]);
    } finally {
      await subscription.close();
    }
  });

  it("ignores notifications on other channels", async () => {
    const events: LiveDataEvent[] = [];
    const subscription = db.subscribeToLiveData((event) => events.push(event), {
      connectionString: TEST_DATABASE_URL,
    });

    try {
      await new Promise((resolve) => setTimeout(resolve, 300));
      await publisher.query("SELECT pg_notify('some_other_channel', $1)", [
        JSON.stringify({ type: "data.updated", organizationId: "org-live-2" }),
      ]);
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(events).toEqual([]);
    } finally {
      await subscription.close();
    }
  });

  it("ignores a malformed payload on the live-data channel instead of throwing", async () => {
    const events: LiveDataEvent[] = [];
    const subscription = db.subscribeToLiveData((event) => events.push(event), {
      connectionString: TEST_DATABASE_URL,
    });

    try {
      await new Promise((resolve) => setTimeout(resolve, 300));
      await publisher.query(`SELECT pg_notify($1, 'not-json')`, [db.LIVE_DATA_CHANNEL]);
      await publisher.query("SELECT pg_notify($1, $2)", [
        db.LIVE_DATA_CHANNEL,
        JSON.stringify({ type: "data.updated", organizationId: "org-live-3" }),
      ]);
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(events).toEqual([
        { type: "data.updated", organizationId: "org-live-3" },
      ]);
    } finally {
      await subscription.close();
    }
  });
});
