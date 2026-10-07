import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as emailPackage from "../src";

/**
 * Structural guard for "every email goes through the Elapsed layout". The
 * types and the registry already make it hard to send anything else; this
 * test makes a regression loud: a second transport, a hand-built HTML shell,
 * a way around the package entry point, or a re-exported internal fails CI.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "build", "coverage", ".turbo"]);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry)) out.push(full);
  }
  return out;
}

function productionSources(): { file: string; content: string }[] {
  const roots = ["apps", "packages"].flatMap((group) =>
    readdirSync(path.join(ROOT, group)).flatMap((name) => ["src", "scripts"].map((sub) => path.join(ROOT, group, name, sub))),
  );
  return roots
    .filter((dir) => {
      try {
        return statSync(dir).isDirectory();
      } catch {
        return false;
      }
    })
    .flatMap(sourceFiles)
    .map((file) => ({ file: path.relative(ROOT, file), content: readFileSync(file, "utf8") }));
}

/** An import/require of a mail library or provider SDK, or a call that opens a mail transport. Mentions in comments don't count. */
const MAIL_LIBRARY =
  /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["'](?:nodemailer|emailjs|smtp-connection|@sendgrid\/[^"']+|mailgun[^"']*|postmark|resend|@aws-sdk\/client-(?:ses|sesv2)|@mailchimp\/[^"']+)["']|\bcreateTransport\s*\(|\.sendMail\s*\(|api\.(?:sendgrid|mailgun|postmarkapp|resend)\./i;

const TRANSPORT = "packages/email/src/transport.ts";
const LAYOUT = "packages/email/src/layout.ts";
/** Files that contain a full HTML document for a reason other than email. */
const NON_EMAIL_HTML: Record<string, string> = {
  "apps/concierge/src/report-html.ts": "writes a standalone HTML report file from the concierge CLI; it sends nothing and does not depend on @sla/email",
};

describe("no way around the Elapsed email layout", () => {
  const sources = productionSources();

  it("scans a meaningful set of files", () => {
    expect(sources.length).toBeGreaterThan(200);
    expect(sources.map((s) => s.file)).toContain(TRANSPORT);
  });

  it("only the transport imports a mail library or opens an SMTP connection", () => {
    const offenders = sources
      .filter(({ file, content }) => file !== TRANSPORT && MAIL_LIBRARY.test(content))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it("only the layout builds an HTML document", () => {
    const offenders = sources
      .filter(({ file, content }) => file !== LAYOUT && !(file in NON_EMAIL_HTML) && /<!doctype\s+html/i.test(content))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it("the allow-listed non-email HTML writer neither sends mail nor depends on the email package", () => {
    for (const file of Object.keys(NON_EMAIL_HTML)) {
      const content = sources.find((s) => s.file === file)?.content ?? "";
      expect(content).not.toMatch(/@sla\/email|sendEmail|nodemailer/);
    }
    const manifest = JSON.parse(readFileSync(path.join(ROOT, "apps/concierge/package.json"), "utf8")) as { dependencies?: Record<string, string> };
    expect(manifest.dependencies ?? {}).not.toHaveProperty("@sla/email");
  });

  it("nothing reaches into the email package's internals instead of its entry point", () => {
    const offenders = sources.filter(({ content }) => /@sla\/email\/|packages\/email\/src\/(transport|layout|rendered|logo)/.test(content)).map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it("only @sla/email's own code uses its transport module", () => {
    const offenders = sources
      .filter(({ file, content }) => /from\s+["']\.\/transport["']/.test(content) && !["packages/email/src/send.ts", "packages/email/src/index.ts"].includes(file))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it("the package entry point exports no raw delivery, layout or rendered-email factory", () => {
    const exported = Object.keys(emailPackage);
    for (const internal of ["deliver", "renderEmailLayout", "renderEmailHtml", "renderEmailText", "issueRendered", "assertRendered", "defineEmailTemplate", "EMAIL_TEMPLATES", "createTransporter"]) {
      expect(exported, internal).not.toContain(internal);
    }
    // The one sending function takes a template request.
    expect(exported).toContain("sendEmail");
    expect(emailPackage.sendEmail.length).toBe(1);
  });

  it("callers outside the package send only through the package's sendEmail, which takes a template", () => {
    const callers = sources.filter(({ file, content }) => !file.startsWith("packages/email/") && /\bsendEmail\s*\(/.test(content));
    expect(callers.map(({ file }) => file).sort()).toEqual(
      [
        "apps/web/src/app/api/settings/email/test-send/route.ts",
        "apps/web/src/lib/transactional-email.ts",
        "apps/worker/src/ops-alert.ts",
        "packages/notifications/src/dispatch.ts",
        "packages/notifications/src/monthly-report-delivery.ts",
        "packages/notifications/src/trial-expiry.ts",
      ].sort(),
    );
    for (const { file, content } of callers) {
      expect(content, file).toMatch(/import\s*\{[^}]*\bsendEmail\b[^}]*\}\s*from\s*["']@sla\/email["']/);
    }
  });
});
