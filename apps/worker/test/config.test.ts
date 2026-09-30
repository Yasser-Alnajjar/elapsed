import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadWorkerConfig, resolveDatabasePoolMax } from "../src/config";

const VARS = ["DATABASE_POOL_MAX", "WORKER_ID", "WORKER_LEASE_TTL_MS", "WORKER_CLAIM_POLL_MS", "WORKER_SHUTDOWN_GRACE_MS", "ORGANIZATION_CONCURRENCY"];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const name of VARS) {
    saved[name] = process.env[name];
    delete process.env[name];
  }
});
afterEach(() => {
  for (const name of VARS) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});

describe("multi-worker configuration", () => {
  it("sizes the per-process pool from the concurrency, not the library-wide default of 20", () => {
    expect(resolveDatabasePoolMax(3)).toBe(10);
    expect(resolveDatabasePoolMax(5)).toBe(14);
    expect(resolveDatabasePoolMax(1)).toBe(6);
  });

  it("lets DATABASE_POOL_MAX override it, and ignores a nonsense value", () => {
    process.env.DATABASE_POOL_MAX = "7";
    expect(resolveDatabasePoolMax(3)).toBe(7);
    process.env.DATABASE_POOL_MAX = "lots";
    expect(resolveDatabasePoolMax(3)).toBe(10);
  });

  it("gives every process its own worker id unless one is set", () => {
    const a = loadWorkerConfig().workerId;
    const b = loadWorkerConfig().workerId;
    expect(a).not.toBe(b);
    process.env.WORKER_ID = "worker-7";
    expect(loadWorkerConfig().workerId).toBe("worker-7");
  });

  it("has safe lease defaults and rejects invalid overrides", () => {
    expect(loadWorkerConfig()).toMatchObject({ leaseTtlMs: 60_000, claimPollMs: 1_000, shutdownGraceMs: 30_000 });
    process.env.WORKER_LEASE_TTL_MS = "-5";
    process.env.WORKER_CLAIM_POLL_MS = "abc";
    expect(loadWorkerConfig()).toMatchObject({ leaseTtlMs: 60_000, claimPollMs: 1_000 });
  });

  it("honors ORGANIZATION_CONCURRENCY=3 per worker", () => {
    process.env.ORGANIZATION_CONCURRENCY = "3";
    const config = loadWorkerConfig();
    expect(config.organizationConcurrency).toBe(3);
    expect(config.databasePoolMax).toBe(10);
  });
});
