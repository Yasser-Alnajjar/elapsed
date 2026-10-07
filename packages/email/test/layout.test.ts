import { describe, expect, it } from "vitest";
import { EMAIL_BRAND } from "../src/brand";
import type { EmailBlock } from "../src/blocks";
import { InvalidEmailUrlError } from "../src/html";
import { renderEmailLayout, type EmailLayoutInput } from "../src/layout";

const input = (overrides: Partial<EmailLayoutInput> = {}): EmailLayoutInput => ({
  subject: "Subject line",
  preheader: "Preview text",
  category: "operations",
  notificationSettingsLink: false,
  blocks: [{ type: "heading", text: "Hello" }],
  appUrl: "https://app.example.com",
  year: 2026,
  ...overrides,
});

describe("the Elapsed shell", () => {
  it("wraps any content in the header, wordmark, logo, footer, product URL and copyright", () => {
    const { html, text } = renderEmailLayout(input());
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('data-elapsed-email="shell"');
    expect(html).toContain('src="cid:elapsed-logo"');
    expect(html).toContain('alt="Elapsed"');
    expect(html).toContain(`>${EMAIL_BRAND.name}</td>`);
    expect(html).toContain("Elapsed · Operations");
    expect(html).toContain(EMAIL_BRAND.descriptor);
    expect(html).toContain('href="https://app.example.com"');
    expect(html).toContain("© 2026 Elapsed. All rights reserved.");

    expect(text.startsWith("ELAPSED · OPERATIONS")).toBe(true);
    expect(text).toContain(EMAIL_BRAND.descriptor);
    expect(text).toContain("https://app.example.com");
    expect(text).toContain("© 2026 Elapsed. All rights reserved.");
  });

  it("uses the brand colors and declares itself dark-by-design to clients", () => {
    const { html } = renderEmailLayout(input());
    expect(html).toContain(EMAIL_BRAND.colors.pageBg);
    expect(html).toContain(EMAIL_BRAND.colors.cardBg);
    expect(html).toContain(EMAIL_BRAND.colors.accent);
    expect(html).toContain('<meta name="color-scheme" content="dark light">');
    expect(html).toContain('<meta name="supported-color-schemes" content="dark light">');
  });

  it("is mobile friendly: viewport meta, fluid container and a narrow-screen rule", () => {
    const { html } = renderEmailLayout(input());
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
    expect(html).toContain("max-width:100%");
    expect(html).toMatch(/@media \(max-width:\d+px\)\{\.el-container\{width:100% !important\}/);
  });

  it("includes an Outlook fixed-width ghost table, since Outlook ignores max-width", () => {
    expect(renderEmailLayout(input()).html).toContain(`<!--[if mso]><table role="presentation" width="${EMAIL_BRAND.contentWidth}"`);
  });

  it("holds to what email clients support: no flex/grid, variables, rgba, scripts, external CSS, fonts or hosted images", () => {
    const blocks: EmailBlock[] = [
      { type: "badge", tone: "danger", text: "x" },
      { type: "heading", text: "t", subtitle: "s" },
      { type: "text", text: "p" },
      { type: "metric", tone: "warning", label: "l", value: "v", aside: { label: "a", value: "b" } },
      { type: "details", rows: [{ label: "a", value: "b" }] },
      { type: "table", rows: [{ label: "a", value: "b", swatch: "support" }] },
      { type: "stats", cells: [{ label: "a", value: "1", tone: "info" }] },
      { type: "button", label: "Go", url: "https://app.example.com/x", showUrl: true },
    ];
    const { html } = renderEmailLayout(input({ blocks }));
    for (const forbidden of [/display:\s*(flex|grid)/, /var\(--/, /rgba?\(/, /<script/i, /<link\b/i, /@import/, /@font-face/, /\bsrc="https?:/i, /url\(/]) {
      expect(html).not.toMatch(forbidden);
    }
    // Every table is presentational, and every background is also a bgcolor attribute for clients that ignore CSS.
    const tables = html.match(/<table\b[^>]*>/g) ?? [];
    expect(tables.length).toBeGreaterThan(5);
    for (const tag of tables) expect(tag).toContain('role="presentation"');
  });

  it("renders every block type to both HTML and plain text", () => {
    const { html, text } = renderEmailLayout(
      input({
        blocks: [
          { type: "badge", tone: "success", text: "All good" },
          { type: "heading", text: "Title", subtitle: "Sub" },
          { type: "text", text: ["Plain ", { strong: "bold" }] },
          { type: "note", text: "A note" },
          { type: "metric", tone: "info", label: "Runway", value: "12m", aside: { label: "Target", value: "1h" } },
          { type: "section", title: "Group" },
          { type: "details", rows: [{ label: "Customer", value: "Acme" }] },
          { type: "table", rows: [{ label: "Support", value: "3 breaches" }] },
          { type: "stats", cells: [{ label: "Met", value: "9" }] },
          { type: "button", label: "Open", url: "https://app.example.com/c/1" },
        ],
      }),
    );
    for (const fragment of ["All good", "Title", "Sub", "Plain ", "A note", "Runway", "12m", "Group", "Customer", "Acme", "3 breaches", "Met", "Open"]) {
      expect(html).toContain(fragment);
    }
    expect(text).toContain("[ALL GOOD]");
    expect(text).toContain("Title\nSub");
    expect(text).toContain("Plain bold");
    expect(text).toContain("RUNWAY: 12m");
    expect(text).toContain("Customer: Acme");
    expect(text).toContain("Open: https://app.example.com/c/1");
    expect(text).not.toMatch(/<[a-z]/i);
  });

  it("escapes every dynamic string, in element content and attributes", () => {
    const evil = `<img src=x onerror="alert(1)"> & 'q'`;
    const { html } = renderEmailLayout(
      input({
        subject: evil,
        preheader: evil,
        footnote: evil,
        blocks: [
          { type: "heading", text: evil, subtitle: evil },
          { type: "text", text: [evil, { strong: evil }] },
          { type: "details", rows: [{ label: evil, value: evil }] },
          { type: "button", label: evil, url: `https://app.example.com/?a="><b>` },
        ],
      }),
    );
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain('onerror="alert');
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;q&#39;");
  });

  it("refuses non-http(s) links so a javascript: URL can never become an href", () => {
    const button = (url: string) => input({ blocks: [{ type: "button", label: "Go", url }] });
    expect(() => renderEmailLayout(button("javascript:alert(1)"))).toThrow(InvalidEmailUrlError);
    expect(() => renderEmailLayout(button("/relative"))).toThrow(InvalidEmailUrlError);
    expect(() => renderEmailLayout(button("data:text/html,x"))).toThrow(InvalidEmailUrlError);
    expect(() => renderEmailLayout(input({ appUrl: "javascript:alert(1)" }))).toThrow(InvalidEmailUrlError);
  });

  it("links the footer to the product, and to notification settings only when asked and a URL is known", () => {
    const withSettings = renderEmailLayout(input({ notificationSettingsLink: true }));
    expect(withSettings.html).toContain('href="https://app.example.com/settings/notifications"');
    expect(withSettings.html).toContain("Open Elapsed");
    expect(withSettings.text).toContain("Manage notification settings: https://app.example.com/settings/notifications");

    const without = renderEmailLayout(input());
    expect(without.html).not.toContain("Manage notification settings");

    const noUrl = renderEmailLayout(input({ appUrl: null, notificationSettingsLink: true }));
    expect(noUrl.html).not.toContain("Manage notification settings");
    expect(noUrl.html).not.toContain("Open Elapsed");
    // Still fully branded without a URL.
    expect(noUrl.html).toContain("© 2026 Elapsed");
    expect(noUrl.html).toContain('src="cid:elapsed-logo"');
  });

  it("shows the template's footnote above the standard footer", () => {
    const { html, text } = renderEmailLayout(input({ footnote: "You are receiving this because reasons." }));
    expect(html).toContain("You are receiving this because reasons.");
    expect(text).toContain("You are receiving this because reasons.\n\nElapsed - ");
  });

  it("puts a signature delimiter before the footer in plain text", () => {
    expect(renderEmailLayout(input()).text).toContain("\n-- \n");
  });
});
