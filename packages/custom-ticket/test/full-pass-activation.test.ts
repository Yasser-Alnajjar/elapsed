/**
 * R6 / §4.3: a source with no incremental cursor activates only if one full
 * pass fits in one run. `measureFullPass` is the check `activateDraft` runs
 * (it returns `listing_too_large` when `completed` is false), against a local
 * fixture server under the real run limits (50 pages, 5,000 tickets).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_PAGES_PER_RUN, measureFullPass, parseConfig, validateConfig } from "../src/index";
import { fixtureConfig, startFixture, ticket, type Fixture } from "./ingest-fixtures";

let fixture: Fixture | undefined;
let saved: string | undefined;
beforeAll(() => {
  saved = process.env.CUSTOM_PROVIDER_ALLOW_PRIVATE_HOSTS;
  process.env.CUSTOM_PROVIDER_ALLOW_PRIVATE_HOSTS = "1";
});
afterAll(async () => {
  await fixture?.close();
  if (saved === undefined) delete process.env.CUSTOM_PROVIDER_ALLOW_PRIVATE_HOSTS;
  else process.env.CUSTOM_PROVIDER_ALLOW_PRIVATE_HOSTS = saved;
});

function config(baseUrl: string, pageSize: number) {
  const parsed = parseConfig(fixtureConfig(baseUrl, pageSize));
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  const report = validateConfig(parsed.config, { allowPrivateHosts: true });
  if (!report.ok) throw new Error(JSON.stringify(report.diagnostics));
  return parsed.config;
}

describe("full-pass activation check (R6)", () => {
  it("lets a listing that fits in one run activate", async () => {
    fixture = await startFixture(Array.from({ length: 5 }, (_, i) => ticket(i)), 2);
    const result = await measureFullPass(config(fixture.baseUrl, 2), { token: "test-token" });
    expect(result).toMatchObject({ completed: true, pages: 3, tickets: 5, stoppedBy: null });
    await fixture.close();
  });

  it("refuses a listing that needs more pages than one run may read, without a usable cursor", async () => {
    const tickets = Array.from({ length: MAX_PAGES_PER_RUN + 1 }, (_, i) => ticket(i));
    fixture = await startFixture(tickets, 1);
    const result = await measureFullPass(config(fixture.baseUrl, 1), { token: "test-token" });
    expect(result.completed).toBe(false);
    expect(result.stoppedBy).toBe("run_cap_reached");
    expect(result.pages).toBe(MAX_PAGES_PER_RUN);
    await fixture.close();
  }, 60_000);

  it("reports a provider failure as a classification, not as completed", async () => {
    fixture = await startFixture([], 1, (_cursor, _req, res) => {
      res.writeHead(404).end("{}");
      return true;
    });
    const result = await measureFullPass(config(fixture.baseUrl, 1), { token: "test-token" });
    expect(result.completed).toBe(false);
    expect(result.stoppedBy).not.toBeNull();
    await fixture.close();
  });
});
