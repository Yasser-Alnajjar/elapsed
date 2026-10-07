import { EMAIL_BRAND, toneStyle, type EmailCategory, type EmailTone } from "./brand";
import { plainText, type DetailRow, type EmailBlock, type InlineText, type RichText, type Stat, type TableRow } from "./blocks";
import { assertSafeUrl, escapeHtml } from "./html";
import { LOGO_CID } from "./logo";

/**
 * The Elapsed email shell. This is the only module that produces an HTML
 * document or the plain-text frame for an email: header (logo, wordmark,
 * category pill), content card, footer (descriptor, links, product URL,
 * copyright) and the mobile rules. Templates supply blocks; nothing else in
 * the repo may build a shell (the `no-bypass` test enforces that).
 *
 * Written for email clients, not browsers: nested `role="presentation"`
 * tables, inline styles as the baseline (Gmail and Outlook drop or rewrite
 * `<style>`), `bgcolor` next to every background color, vertical rhythm from
 * cell padding rather than margins, a fixed-width ghost table for Outlook's
 * Word engine, and no flex, grid, CSS variables, `rgba()`, scripts, web-font
 * downloads or externally hosted images. The logo is an inline `cid:` image beside a
 * text wordmark, so it needs no URL and the brand still reads if images are blocked.
 *
 * The design is dark by construction (the app's "Operational Default" theme),
 * with every color set explicitly. It reads the same in light and dark
 * clients and declares `color-scheme` so clients don't try to invert it.
 */

export interface EmailLayoutInput {
  /** The document `<title>`; also the subject. */
  subject: string;
  /** Inbox preview text, hidden in the body. */
  preheader: string;
  category: EmailCategory;
  notificationSettingsLink: boolean;
  blocks: readonly EmailBlock[];
  /** Why the recipient got this email, above the standard footer. */
  footnote?: string | undefined;
  /** The deployment origin, linked in the footer. Null when the deployment has none configured. */
  appUrl: string | null;
  year: number;
}

export interface EmailLayoutOutput {
  html: string;
  text: string;
}

const C = EMAIL_BRAND.colors;
const F = EMAIL_BRAND.fonts;
const WIDTH = EMAIL_BRAND.contentWidth;

const LOGO_SIZE = 36;
const WRAP = "word-break:break-word;overflow-wrap:break-word;";
const NOTIFICATION_SETTINGS_PATH = "/settings/notifications";

const HEAD_CSS =
  ":root{color-scheme:dark light;supported-color-schemes:dark light}" +
  "body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}" +
  "table,td{mso-table-lspace:0pt;mso-table-rspace:0pt}" +
  "a{text-decoration:none}" +
  `@media (max-width:${WIDTH + 20}px){` +
  ".el-container{width:100% !important}" +
  ".el-pad{padding-left:16px !important;padding-right:16px !important}" +
  ".el-cell{display:block !important;width:100% !important;padding-left:0 !important;padding-right:0 !important}" +
  ".el-h1{font-size:18px !important}" +
  ".el-stat{padding-left:8px !important;padding-right:8px !important}" +
  "}";

/* ------------------------------- blocks ------------------------------- */

function inlineHtml(part: InlineText): string {
  return typeof part === "string"
    ? escapeHtml(part).replace(/\n/g, "<br>")
    : `<strong style="font-weight:700;color:${C.title};">${escapeHtml(part.strong)}</strong>`;
}

function richHtml(text: RichText): string {
  return typeof text === "string" ? inlineHtml(text) : text.map(inlineHtml).join("");
}

/** Space above a block. The first block sits flush; a heading hugs the badge above it; runs of prose are tighter than panels. */
function gapBefore(previous: EmailBlock | undefined, block: EmailBlock): number {
  if (!previous) return 0;
  if (block.type === "heading" && previous.type === "badge") return 12;
  if (block.type === "text" && (previous.type === "text" || previous.type === "heading" || previous.type === "note")) return 12;
  if (block.type === "section") return 28;
  if (previous.type === "section") return 8;
  return 20;
}

function row(gap: number, inner: string): string {
  return `<tr><td style="padding:${gap}px 0 0;">${inner}</td></tr>`;
}

function badgeHtml(tone: EmailTone, text: string): string {
  const style = toneStyle(tone);
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>` +
    `<td bgcolor="${style.tint}" style="background-color:${style.tint};border:1px solid ${style.border};border-radius:3px;padding:3px 8px;font-family:${F.mono};font-size:11px;line-height:16px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;color:${style.color};">` +
    `${style.glyph} ${escapeHtml(text)}</td></tr></table>`
  );
}

function headingHtml(text: string, subtitle: string | undefined): string {
  const title = `<h1 class="el-h1" style="margin:0;font-family:${F.heading};font-size:20px;line-height:26px;font-weight:600;color:${C.title};${WRAP}">${escapeHtml(text)}</h1>`;
  if (!subtitle) return title;
  return `${title}<div style="padding-top:4px;font-family:${F.body};font-size:13px;line-height:19px;color:${C.muted};${WRAP}">${escapeHtml(subtitle)}</div>`;
}

function textHtml(text: RichText, muted: boolean): string {
  const color = muted ? C.muted : C.body;
  const size = muted ? "13px" : "14px";
  const height = muted ? "19px" : "22px";
  return `<div style="font-family:${F.body};font-size:${size};line-height:${height};color:${color};${WRAP}">${richHtml(text)}</div>`;
}

function noteHtml(text: RichText): string {
  return `<div style="font-family:${F.body};font-size:12px;line-height:18px;color:${C.muted};text-align:center;${WRAP}">${richHtml(text)}</div>`;
}

function metricHtml(tone: EmailTone, label: string, value: string, aside: { label: string; value: string } | undefined): string {
  const { color } = toneStyle(tone);
  const mono = (size: number, weight: number, fg: string) => `font-family:${F.mono};font-size:${size}px;font-weight:${weight};color:${fg};`;
  const labelStyle = (fg: string) => `${mono(11, 400, fg)}text-transform:uppercase;letter-spacing:0.06em;line-height:16px;padding-bottom:4px;`;
  const left =
    `<td align="left" valign="top"><div style="${labelStyle(C.muted)}">${escapeHtml(label)}</div>` +
    `<div style="${mono(28, 700, color)}letter-spacing:-0.5px;line-height:32px;${WRAP}">${escapeHtml(value)}</div></td>`;
  const right = aside
    ? `<td align="right" valign="top"><div style="${labelStyle(C.subtle)}">${escapeHtml(aside.label)}</div>` +
      `<div style="${mono(14, 600, C.value)}line-height:32px;${WRAP}">${escapeHtml(aside.value)}</div></td>`
    : "";
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.panelBg}" style="background-color:${C.panelBg};border:1px solid ${C.cardBorder};border-left:3px solid ${color};border-radius:4px;border-collapse:separate;">` +
    `<tr><td style="padding:16px 20px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${left}${right}</tr></table></td></tr></table>`
  );
}

function detailsHtml(rows: readonly DetailRow[]): string {
  const cell = (item: DetailRow, side: "left" | "right" | "full", last: boolean): string => {
    const pad = side === "left" ? "8px 8px 8px 0" : side === "right" ? "8px 0 8px 8px" : "8px 0";
    const border = last ? "" : `border-bottom:1px solid ${C.insetBorder};`;
    return (
      `<td class="el-cell" valign="top"${side === "full" ? ' colspan="2"' : ' width="50%"'} style="padding:${pad};${border}${WRAP}">` +
      `<div style="font-family:${F.mono};font-size:11px;line-height:16px;color:${C.subtle};text-transform:uppercase;letter-spacing:0.04em;">${escapeHtml(item.label)}</div>` +
      `<div style="padding-top:2px;font-family:${F.body};font-size:13px;line-height:19px;font-weight:600;color:${C.title};">${escapeHtml(item.value)}</div></td>`
    );
  };
  const lines: string[] = [];
  for (let index = 0; index < rows.length; index += 2) {
    const first = rows[index]!;
    const second = rows[index + 1];
    const last = index + 2 >= rows.length;
    lines.push(`<tr>${second ? cell(first, "left", last) + cell(second, "right", last) : cell(first, "full", last)}</tr>`);
  }
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.insetBg}" style="background-color:${C.insetBg};border:1px solid ${C.insetBorder};border-radius:4px;border-collapse:separate;">` +
    `<tr><td style="padding:6px 18px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${lines.join("")}</table></td></tr></table>`
  );
}

function tableHtml(rows: readonly TableRow[]): string {
  const lines = rows.map((item, index) => {
    const border = index === rows.length - 1 ? "" : `border-bottom:1px solid ${C.cardBorder};`;
    // A colored glyph, not a sized cell: a cell would stretch to the row's height.
    const label = item.swatch
      ? `<span style="color:${C.swatches[item.swatch]};font-size:11px;line-height:18px;">&#9632;</span>&nbsp; ${escapeHtml(item.label)}`
      : escapeHtml(item.label);
    return (
      `<tr><td valign="middle" style="padding:8px 12px;${border}font-family:${F.body};font-size:12px;line-height:18px;color:${C.value};${WRAP}">${label}</td>` +
      `<td valign="middle" align="right" style="padding:8px 12px;${border}font-family:${F.mono};font-size:12px;line-height:18px;color:${C.muted};text-align:right;${WRAP}">${escapeHtml(item.value)}</td></tr>`
    );
  });
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.cardBg}" style="background-color:${C.cardBg};border:1px solid ${C.cardBorder};border-radius:4px;border-collapse:separate;">${lines.join("")}</table>`;
}

function statsHtml(cells: readonly Stat[]): string {
  const width = Math.floor(100 / cells.length);
  const body = cells
    .map((cell, index) => {
      const border = index === cells.length - 1 ? "" : `border-right:1px solid ${C.cardBorder};`;
      const color = cell.tone ? toneStyle(cell.tone).color : C.title;
      return (
        `<td class="el-stat" width="${width}%" valign="top" style="padding:14px 10px;${border}">` +
        `<div style="font-family:${F.mono};font-size:10px;line-height:14px;color:${C.subtle};">${escapeHtml(cell.label)}</div>` +
        `<div style="padding-top:2px;font-family:${F.mono};font-size:18px;line-height:24px;font-weight:700;color:${color};${WRAP}">${escapeHtml(cell.value)}</div></td>`
      );
    })
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.panelBg}" style="background-color:${C.panelBg};border:1px solid ${C.cardBorder};border-radius:4px;border-collapse:separate;"><tr>${body}</tr></table>`;
}

function buttonHtml(label: string, url: string, showUrl: boolean): string {
  const href = escapeHtml(url);
  const button =
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
    `<td align="center" bgcolor="${C.buttonBg}" style="background-color:${C.buttonBg};border-radius:4px;text-align:center;mso-padding-alt:12px 24px;">` +
    `<a href="${href}" target="_blank" style="display:block;padding:12px 24px;font-family:${F.heading};font-size:14px;line-height:20px;font-weight:600;color:${C.buttonText};text-decoration:none;text-align:center;">${escapeHtml(label)} &rarr;</a>` +
    `</td></tr></table>`;
  if (!showUrl) return button;
  return (
    button +
    `<div style="padding-top:14px;font-family:${F.body};font-size:12px;line-height:18px;color:${C.muted};text-align:center;${WRAP}">` +
    `If the button doesn&#39;t work, copy and paste this link into your browser:<br>` +
    `<a href="${href}" target="_blank" style="color:${C.accent};text-decoration:underline;">${href}</a></div>`
  );
}

function blockHtml(block: EmailBlock): string {
  switch (block.type) {
    case "badge":
      return badgeHtml(block.tone, block.text);
    case "heading":
      return headingHtml(block.text, block.subtitle);
    case "text":
      return textHtml(block.text, block.muted ?? false);
    case "note":
      return noteHtml(block.text);
    case "metric":
      return metricHtml(block.tone, block.label, block.value, block.aside);
    case "section":
      return `<div style="font-family:${F.mono};font-size:11px;line-height:16px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:${C.muted};">${escapeHtml(block.title)}</div>`;
    case "details":
      return detailsHtml(block.rows);
    case "table":
      return tableHtml(block.rows);
    case "stats":
      return statsHtml(block.cells);
    case "button":
      return buttonHtml(block.label, assertSafeUrl(block.url), block.showUrl ?? false);
  }
}

function bodyHtml(blocks: readonly EmailBlock[]): string {
  return blocks.map((block, index) => row(gapBefore(blocks[index - 1], block), blockHtml(block))).join("\n");
}

/* ------------------------------- shell -------------------------------- */

function headerHtml(category: EmailCategory): string {
  const pill = `${EMAIL_BRAND.name} · ${EMAIL_BRAND.categoryLabels[category]}`;
  // The app icon, inlined by `cid:` (see logo.ts). Dimensions are on the tag for clients that ignore CSS; the wordmark beside it is text, so the brand still reads with images blocked.
  const mark = `<img src="cid:${LOGO_CID}" width="${LOGO_SIZE}" height="${LOGO_SIZE}" alt="${escapeHtml(EMAIL_BRAND.name)}" style="display:block;width:${LOGO_SIZE}px;height:${LOGO_SIZE}px;border:0;border-radius:8px;">`;
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
    `<td align="left" valign="middle"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>` +
    `<td valign="middle" style="padding-right:8px;">${mark}</td>` +
    `<td valign="middle" style="font-family:${F.heading};font-size:16px;line-height:24px;font-weight:700;letter-spacing:-0.3px;color:${C.title};">${escapeHtml(EMAIL_BRAND.name)}</td>` +
    `</tr></table></td>` +
    `<td align="right" valign="middle"><table role="presentation" cellpadding="0" cellspacing="0" border="0" align="right"><tr>` +
    `<td bgcolor="${C.pillBg}" style="background-color:${C.pillBg};border:1px solid ${C.pillBorder};border-radius:3px;padding:4px 8px;font-family:${F.mono};font-size:10px;line-height:14px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;color:${C.accent};white-space:nowrap;">${escapeHtml(pill)}</td>` +
    `</tr></table></td></tr></table>`
  );
}

interface FooterLink {
  label: string;
  url: string;
}

/** Mail the recipient can configure links to where; every email links to the product. Both need a known deployment URL. */
function footerLinks(notificationSettingsLink: boolean, appUrl: string | null): FooterLink[] {
  if (!appUrl) return [];
  const links: FooterLink[] = [];
  if (notificationSettingsLink) links.push({ label: "Manage notification settings", url: new URL(NOTIFICATION_SETTINGS_PATH, appUrl).toString() });
  links.push({ label: "Open Elapsed", url: appUrl });
  return links;
}

function copyright(year: number): string {
  return `© ${year} ${EMAIL_BRAND.legalName}. All rights reserved.`;
}

function footerHtml(input: EmailLayoutInput): string {
  const links = footerLinks(input.notificationSettingsLink, input.appUrl);
  const linkStyle = (primary: boolean) => `font-family:${F.mono};font-size:11px;line-height:16px;color:${primary ? C.accent : C.muted};text-decoration:none;`;
  const linkRow = links
    .map((link, index) => `<a href="${escapeHtml(assertSafeUrl(link.url))}" target="_blank" style="${linkStyle(index === 0)}">${escapeHtml(link.label)}</a>`)
    .join(`<span style="font-family:${F.mono};font-size:11px;color:#334155;"> &nbsp;&middot;&nbsp; </span>`);
  const fine: string[] = [];
  if (input.appUrl) {
    const href = escapeHtml(assertSafeUrl(input.appUrl));
    fine.push(`<a href="${href}" target="_blank" style="color:${C.subtle};text-decoration:underline;">${href}</a>`);
  }
  fine.push(escapeHtml(copyright(input.year)));

  const parts = [
    `<div style="font-family:${F.heading};font-size:12px;line-height:18px;font-weight:600;color:${C.muted};">${escapeHtml(EMAIL_BRAND.name)} <span style="font-weight:400;color:${C.subtle};">&mdash; ${escapeHtml(EMAIL_BRAND.descriptor)}</span></div>`,
  ];
  if (input.footnote) {
    parts.push(`<div style="padding-top:8px;font-family:${F.body};font-size:11px;line-height:16px;color:${C.subtle};${WRAP}">${escapeHtml(input.footnote)}</div>`);
  }
  if (linkRow) parts.push(`<div style="padding-top:12px;">${linkRow}</div>`);
  parts.push(`<div style="padding-top:14px;font-family:${F.mono};font-size:10px;line-height:15px;color:${C.subtle};${WRAP}">${fine.join(" &middot; ")}</div>`);
  return parts.join("");
}

/** Zero-width padding after the preheader so the client doesn't pull body copy into the inbox preview. */
const PREHEADER_PADDING = "&#847;&zwnj;&nbsp;".repeat(60);

export function renderEmailHtml(input: EmailLayoutInput): string {
  return `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no, url=no">
<meta name="color-scheme" content="dark light">
<meta name="supported-color-schemes" content="dark light">
<title>${escapeHtml(input.subject)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>${HEAD_CSS}</style>
</head>
<body bgcolor="${C.pageBg}" style="margin:0;padding:0;width:100%;background-color:${C.pageBg};">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${C.pageBg};opacity:0;">${escapeHtml(input.preheader)}${PREHEADER_PADDING}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.pageBg}" style="background-color:${C.pageBg};">
<tr><td align="center" style="padding:32px 16px;">
<!--[if mso]><table role="presentation" width="${WIDTH}" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" class="el-container" data-elapsed-email="shell" width="${WIDTH}" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.cardBg}" style="width:${WIDTH}px;max-width:100%;background-color:${C.cardBg};border:1px solid ${C.cardBorder};border-radius:4px;border-collapse:separate;">
<tr><td class="el-pad" bgcolor="${C.cardBg}" style="padding:20px 24px 18px;border-bottom:1px solid ${C.cardBorder};background-color:${C.cardBg};">${headerHtml(input.category)}</td></tr>
<tr><td class="el-pad" bgcolor="${C.cardBg}" style="padding:24px 24px 28px;background-color:${C.cardBg};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${bodyHtml(input.blocks)}
</table>
</td></tr>
<tr><td class="el-pad" bgcolor="${C.insetBg}" style="padding:22px 24px 26px;border-top:1px solid ${C.cardBorder};background-color:${C.insetBg};">${footerHtml(input)}</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;
}

/* ----------------------------- plain text ----------------------------- */

function blockText(block: EmailBlock): string {
  switch (block.type) {
    case "badge":
      return `[${block.text.toUpperCase()}]`;
    case "heading":
      return block.subtitle ? `${block.text}\n${block.subtitle}` : block.text;
    case "text":
    case "note":
      return plainText(block.text);
    case "metric":
      return [`${block.label.toUpperCase()}: ${block.value}`, ...(block.aside ? [`${block.aside.label.toUpperCase()}: ${block.aside.value}`] : [])].join("\n");
    case "section":
      return block.title.toUpperCase();
    case "details":
      return block.rows.map((item) => `${item.label}: ${item.value}`).join("\n");
    case "table":
      return block.rows.map((item) => `- ${item.label}: ${item.value}`).join("\n");
    case "stats":
      return block.cells.map((cell) => `${cell.label}: ${cell.value}`).join("\n");
    case "button":
      return `${block.label}: ${assertSafeUrl(block.url)}`;
  }
}

export function renderEmailText(input: EmailLayoutInput): string {
  const header = `${EMAIL_BRAND.name.toUpperCase()} · ${EMAIL_BRAND.categoryLabels[input.category].toUpperCase()}`;
  const body = input.blocks.map(blockText).join("\n\n");
  const footer = [
    ...(input.footnote ? [input.footnote, ""] : []),
    `${EMAIL_BRAND.name} - ${EMAIL_BRAND.descriptor}`,
    ...footerLinks(input.notificationSettingsLink, input.appUrl).map((link) => `${link.label}: ${link.url}`),
    ...(input.appUrl ? [input.appUrl] : []),
    copyright(input.year),
  ].join("\n");
  return `${header}\n\n${body}\n\n-- \n${footer}\n`;
}

export function renderEmailLayout(input: EmailLayoutInput): EmailLayoutOutput {
  return { html: renderEmailHtml(input), text: renderEmailText(input) };
}
