/**
 * The Elapsed email brand: the one place colors, type, and legal lines for
 * outgoing mail are defined. The values come from the approved email design
 * and the app's dark theme tokens (`apps/web/src/styles/colors.css`), written
 * as plain hex because email clients support neither CSS variables nor
 * `rgba()`/`color-mix()` — translucent tints are blended onto the card
 * background up front by `toneStyle`.
 */

export type EmailTone = "info" | "success" | "warning" | "danger";

/** The color of the stage a row of time belongs to, mirroring the app's SLA leg colors. */
export type EmailSwatch = "support" | "engineering" | "waiting" | "neutral";

/** Which part of the product an email belongs to; labels the pill in the header. */
export type EmailCategory = "operations" | "reports" | "account";

const COLORS = {
  pageBg: "#060a12",
  cardBg: "#0b1324",
  cardBorder: "#1c273c",
  /** Metric card and KPI strip. */
  panelBg: "#0f172a",
  /** Fact grid and footer: one step darker than the card. */
  insetBg: "#080e1a",
  insetBorder: "#152033",
  title: "#f8fafc",
  body: "#cbd5e1",
  value: "#e2e8f0",
  muted: "#94a3b8",
  subtle: "#64748b",
  accent: "#38bdf8",
  buttonBg: "#0284c7",
  buttonText: "#ffffff",
  logoBg: "#111a2e",
  pillBg: "#131d33",
  pillBorder: "#1c2e4f",
  tones: {
    info: "#38bdf8",
    success: "#10b981",
    warning: "#f59e0b",
    danger: "#f43f5e",
  },
  swatches: {
    support: "#38bdf8",
    engineering: "#f59e0b",
    waiting: "#818cf8",
    neutral: "#64748b",
  },
} as const;

export const EMAIL_BRAND = {
  name: "Elapsed",
  /** Footer descriptor: `Elapsed — <descriptor>`. */
  descriptor: "Support escalation visibility",
  /** Shown in the footer as `© <year> <legalName>. All rights reserved.` — matches the marketing site footer. */
  legalName: "Elapsed",
  /** Outer width of the email. */
  contentWidth: 620,
  /** Headings and the wordmark use Hanken Grotesk, labels and figures JetBrains Mono. Neither is guaranteed in an inbox, so each falls through to the system stack. */
  fonts: {
    heading: "'Hanken Grotesk',-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif",
    body: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif",
    mono: "'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace",
  },
  categoryLabels: {
    operations: "Operations",
    reports: "Reports",
    account: "Account",
  } satisfies Record<EmailCategory, string>,
  colors: COLORS,
} as const;

function channels(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** `foreground` at `alpha` over `background`, as an opaque hex color. */
export function blend(foreground: string, background: string, alpha: number): string {
  const fg = channels(foreground);
  const bg = channels(background);
  const mixed = fg.map((channel, index) => Math.round(channel * alpha + bg[index]! * (1 - alpha)));
  return `#${mixed.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

export interface ToneStyle {
  color: string;
  /** 10% of `color` over the card — the pill's fill. */
  tint: string;
  /** 25% of `color` over the card — the pill's outline. */
  border: string;
  glyph: string;
}

const GLYPHS: Record<EmailTone, string> = { info: "●", success: "✓", warning: "▲", danger: "✕" };

export function toneStyle(tone: EmailTone): ToneStyle {
  const color = COLORS.tones[tone];
  return {
    color,
    tint: blend(color, COLORS.cardBg, 0.1),
    border: blend(color, COLORS.cardBg, 0.25),
    glyph: GLYPHS[tone],
  };
}
