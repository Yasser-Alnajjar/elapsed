import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CUSTOM_CREDENTIALS_UNREADABLE_MESSAGE,
  CustomCredentialsUnreadableError,
  DRAFT_INTEGRATION_ID,
  customSecretFieldsSet,
  decryptCustomSecret,
  decryptCustomSecrets,
  encryptCustomSecret,
  encryptCustomSecrets,
  isCustomSecretCiphertext,
} from "../src/custom-secrets";
import { decryptToken, encryptToken } from "../src/integration-credentials";

const SENTINEL = "sentinel-api-key-9f3a-DO-NOT-LEAK";
const binding = { organizationId: "org_a", integrationId: "int_1", field: "apiKey" };
let savedKey: string | undefined;

beforeEach(() => {
  savedKey = process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY;
  process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY = "test-key-material-for-custom-secrets-0001";
});
afterEach(() => {
  if (savedKey === undefined) delete process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY;
  else process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY = savedKey;
});

function unreadable(fn: () => unknown): CustomCredentialsUnreadableError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(CustomCredentialsUnreadableError);
    return error as CustomCredentialsUnreadableError;
  }
  throw new Error("expected CustomCredentialsUnreadableError");
}

describe("custom secrets: round trip and storage format (Q8, Q16)", () => {
  it("writes the enc:v1: form, never the plaintext, with a fresh IV per value", () => {
    const a = encryptCustomSecret(SENTINEL, binding);
    const b = encryptCustomSecret(SENTINEL, binding);
    expect(a.startsWith("enc:v1:")).toBe(true);
    expect(a).not.toContain(SENTINEL);
    expect(a).not.toBe(b);
    expect(isCustomSecretCiphertext(a)).toBe(true);
    expect(decryptCustomSecret(a, binding)).toBe(SENTINEL);
    expect(decryptCustomSecret(b, binding)).toBe(SENTINEL);
  });

  it("round-trips unicode and the 4096-byte limit; refuses empty and oversized values", () => {
    expect(decryptCustomSecret(encryptCustomSecret("pässwörd-密码-🔑", binding), binding)).toBe("pässwörd-密码-🔑");
    expect(decryptCustomSecret(encryptCustomSecret("a".repeat(4096), binding), binding)).toHaveLength(4096);
    expect(() => encryptCustomSecret("", binding)).toThrow();
    expect(() => encryptCustomSecret("a".repeat(4097), binding)).toThrow();
  });

  it("encrypts and decrypts a field map, each value bound to its own field", () => {
    const stored = encryptCustomSecrets({ username: "u", password: SENTINEL }, { organizationId: "org_a", integrationId: "int_1" });
    expect(Object.values(stored).every((v) => v.startsWith("enc:v1:"))).toBe(true);
    expect(JSON.stringify(stored)).not.toContain(SENTINEL);
    expect(decryptCustomSecrets(stored, { organizationId: "org_a", integrationId: "int_1" }, ["username", "password"])).toEqual({ username: "u", password: SENTINEL });
    expect(customSecretFieldsSet(stored).sort()).toEqual(["password", "username"]);
    expect(customSecretFieldsSet({ apiKey: "plaintext", other: encryptCustomSecret("x", binding) })).toEqual(["other"]);
    expect(customSecretFieldsSet(null)).toEqual([]);
    expect(customSecretFieldsSet([])).toEqual([]);
  });
});

describe("custom secrets: the strict reader rejects every malformed form with one generic outcome (§8.4 item 4)", () => {
  const good = () => encryptCustomSecret(SENTINEL, binding);
  const parts = (value: string) => value.slice("enc:v1:".length).split(".") as [string, string, string];
  const flip = (text: string) => (text.startsWith("A") ? "B" : "A") + text.slice(1);

  const malformed: [string, () => unknown][] = [
    ["the unprefixed plaintext itself", () => SENTINEL],
    ["a plaintext that looks like a token", () => "sk_live_abcdef"],
    ["the wrong prefix", () => good().replace("enc:v1:", "enc:v2:")],
    ["no prefix, valid body", () => good().slice("enc:v1:".length)],
    ["too few parts", () => `enc:v1:${parts(good()).slice(0, 2).join(".")}`],
    ["too many parts", () => `${good()}.AAAA`],
    ["non-base64url characters", () => `enc:v1:${parts(good())[0]}.${parts(good())[1]}.not base64!`],
    ["a standard-base64 '+' or '/'", () => `enc:v1:${parts(good())[0]}.${parts(good())[1]}.ab+/`],
    ["a short IV", () => `enc:v1:${Buffer.alloc(8).toString("base64url")}.${parts(good())[1]}.${parts(good())[2]}`],
    ["a long IV", () => `enc:v1:${Buffer.alloc(16).toString("base64url")}.${parts(good())[1]}.${parts(good())[2]}`],
    ["a short tag", () => `enc:v1:${parts(good())[0]}.${Buffer.alloc(8).toString("base64url")}.${parts(good())[2]}`],
    ["a long tag", () => `enc:v1:${parts(good())[0]}.${Buffer.alloc(32).toString("base64url")}.${parts(good())[2]}`],
    ["an empty ciphertext", () => `enc:v1:${parts(good())[0]}.${parts(good())[1]}.`],
    ["an oversized ciphertext", () => `enc:v1:${parts(good())[0]}.${parts(good())[1]}.${randomBytes(5000).toString("base64url")}`],
    ["a tampered ciphertext", () => `enc:v1:${parts(good())[0]}.${parts(good())[1]}.${flip(parts(good())[2])}`],
    ["a tampered tag", () => `enc:v1:${parts(good())[0]}.${flip(parts(good())[1])}.${parts(good())[2]}`],
    ["a tampered IV", () => `enc:v1:${flip(parts(good())[0])}.${parts(good())[1]}.${parts(good())[2]}`],
    ["a padded (non-canonical) spelling", () => `${good()}=`],
    ["an empty string", () => ""],
    ["null", () => null],
    ["undefined", () => undefined],
    ["a number", () => 42],
    ["an object", () => ({ iv: "x" })],
    ["an array", () => [good()]],
  ];

  it.each(malformed)("rejects %s", (_label, make) => {
    const value = make();
    const error = unreadable(() => decryptCustomSecret(value, binding));
    expect(error.message).toBe(CUSTOM_CREDENTIALS_UNREADABLE_MESSAGE);
    expect(error.cause).toBeUndefined();
  });

  it("never returns plaintext for an unprefixed value, unlike the existing decryptToken for rows awaiting migration", () => {
    expect(decryptToken(SENTINEL)).toBe(SENTINEL); // the legacy reader tolerates plaintext (documented)
    unreadable(() => decryptCustomSecret(SENTINEL, binding));
  });

  it("the error message and shape carry nothing about the value, the key or the cause", () => {
    const tampered = encryptCustomSecret(SENTINEL, binding).replace(/.$/, (c) => (c === "A" ? "B" : "A"));
    const error = unreadable(() => decryptCustomSecret(tampered, binding));
    expect(error.name).toBe("CustomCredentialsUnreadableError");
    expect(`${error.message}${error.stack ?? ""}`).not.toContain(SENTINEL);
    expect(`${error.message}${error.stack ?? ""}`).not.toContain(process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY!);
    expect(Object.keys(error)).toEqual(["name"]); // no cause, no input, no extra fields
  });
});

describe("custom secrets: binding to organization, integration and field (§8.4 item 5)", () => {
  const ciphertext = () => encryptCustomSecret(SENTINEL, binding);

  it.each([
    ["another organization", { ...binding, organizationId: "org_b" }],
    ["another integration", { ...binding, integrationId: "int_2" }],
    ["another field", { ...binding, field: "token" }],
    ["the draft binding", { ...binding, integrationId: DRAFT_INTEGRATION_ID }],
  ])("a ciphertext read as %s is rejected", (_label, other) => {
    unreadable(() => decryptCustomSecret(ciphertext(), other));
  });

  it("refuses empty or NUL-containing binding parts, which could collide", () => {
    for (const bad of [{ ...binding, organizationId: "" }, { ...binding, field: "" }, { ...binding, integrationId: "a\u0000b" }]) {
      unreadable(() => decryptCustomSecret(ciphertext(), bad));
      expect(() => encryptCustomSecret("x", bad)).toThrow();
    }
  });

  it("does not let ('a\\0b','c') collide with ('a','b\\0c') style splits", () => {
    const one = encryptCustomSecret("x", { organizationId: "ab", integrationId: "c", field: "f" });
    unreadable(() => decryptCustomSecret(one, { organizationId: "a", integrationId: "bc", field: "f" }));
  });

  it("a map is read only for the exact field set: missing, extra, moved or half-readable credentials fail the whole read", () => {
    const ctx = { organizationId: "org_a", integrationId: "int_1" };
    const stored = encryptCustomSecrets({ username: "u", password: "p" }, ctx);
    unreadable(() => decryptCustomSecrets(stored, ctx, ["username"])); // extra stored field
    unreadable(() => decryptCustomSecrets({ username: stored.username }, ctx, ["username", "password"])); // missing field
    unreadable(() => decryptCustomSecrets({ username: stored.password, password: stored.username }, ctx, ["username", "password"])); // swapped between fields
    unreadable(() => decryptCustomSecrets({ ...stored, password: "plaintext" }, ctx, ["username", "password"])); // one half-readable
    unreadable(() => decryptCustomSecrets(stored, { ...ctx, organizationId: "org_b" }, ["username", "password"]));
    for (const bad of [null, undefined, "x", 5, [stored.username]]) unreadable(() => decryptCustomSecrets(bad, ctx, ["username"]));
  });
});

describe("custom secrets: unset or wrong key fails closed (§8.4 item 3)", () => {
  it("an unset key makes encryption throw and decryption fail with the generic error", () => {
    const ciphertext = encryptCustomSecret(SENTINEL, binding);
    delete process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY;
    expect(() => encryptCustomSecret("x", binding)).toThrow(/INTEGRATION_TOKEN_ENCRYPTION_KEY/);
    const error = unreadable(() => decryptCustomSecret(ciphertext, binding));
    expect(error.message).toBe(CUSTOM_CREDENTIALS_UNREADABLE_MESSAGE);
    process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY = "";
    unreadable(() => decryptCustomSecret(ciphertext, binding));
  });

  it("a different key (rotation) makes every credential unreadable with the same generic error", () => {
    const ciphertext = encryptCustomSecret(SENTINEL, binding);
    process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY = "a-completely-different-key-material-9999";
    const error = unreadable(() => decryptCustomSecret(ciphertext, binding));
    expect(error.message).toBe(CUSTOM_CREDENTIALS_UNREADABLE_MESSAGE);
    expect(`${error.message}`).not.toMatch(/key|tag|auth|decrypt|cipher/i);
  });

  it("the wrong-key outcome is identical to the tampered-ciphertext outcome (no oracle)", () => {
    const good = encryptCustomSecret(SENTINEL, binding);
    const tampered = good.replace(/.$/, (c) => (c === "A" ? "B" : "A"));
    const tamperedError = unreadable(() => decryptCustomSecret(tampered, binding));
    process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY = "another-key-for-the-oracle-check-12345";
    const wrongKeyError = unreadable(() => decryptCustomSecret(good, binding));
    expect(wrongKeyError.message).toBe(tamperedError.message);
    expect(wrongKeyError.name).toBe(tamperedError.name);
  });
});

describe("existing providers' encryption is untouched (§8.4 item 6)", () => {
  it("decryptToken/encryptToken still round-trip, and a custom ciphertext is not valid under the existing token key", () => {
    const legacy = encryptToken("legacy-token");
    expect(legacy.startsWith("enc:v1:")).toBe(true);
    expect(decryptToken(legacy)).toBe("legacy-token");
    const custom = encryptCustomSecret("legacy-token", binding);
    expect(() => decryptToken(custom)).toThrow();
    unreadable(() => decryptCustomSecret(legacy, binding)); // and the legacy ciphertext is not valid as a custom secret
  });
});
