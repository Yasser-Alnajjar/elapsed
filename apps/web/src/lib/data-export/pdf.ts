/**
 * Minimal PDF writer: A4 pages, the three standard fonts (Helvetica, Helvetica
 * Bold, Courier — nothing embedded), text, lines and filled rectangles. Enough
 * for the integration data report without adding a PDF dependency; the report
 * is the only user.
 *
 * Text is WinAnsi (Latin-1 plus common typographic punctuation). Anything else
 * becomes `?`: standard fonts cannot draw it, and embedding a font would
 * outweigh the one summary this writer exists for.
 */

export type PdfFont = "regular" | "bold" | "mono";
export type Rgb = [number, number, number];

export const PAGE_WIDTH = 595.28;
export const PAGE_HEIGHT = 841.89;

const FONT_RESOURCE: Record<PdfFont, string> = { regular: "F1", bold: "F2", mono: "F3" };
const FONT_NAME: Record<PdfFont, string> = { regular: "Helvetica", bold: "Helvetica-Bold", mono: "Courier" };

/** Typographic characters the WinAnsi code page has, outside Latin-1. */
const WIN_ANSI_EXTRA: Record<number, number> = {
  0x20ac: 0x80, // €
  0x2026: 0x85, // …
  0x2018: 0x91, // ‘
  0x2019: 0x92, // ’
  0x201c: 0x93, // “
  0x201d: 0x94, // ”
  0x2022: 0x95, // •
  0x2013: 0x96, // –
  0x2014: 0x97, // —
};

/** A string whose every character is one byte of the WinAnsi encoding. */
function toWinAnsi(text: string): string {
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (code === 0x09 || code === 0x0a || code === 0x0d) out += " ";
    else if (code < 0x20 || code === 0x7f) out += " ";
    else if (code <= 0x7e || (code >= 0xa0 && code <= 0xff)) out += String.fromCharCode(code);
    else out += String.fromCharCode(WIN_ANSI_EXTRA[code] ?? 0x3f);
  }
  return out;
}

const escapeText = (text: string) => toWinAnsi(text).replace(/[\\()]/g, (c) => `\\${c}`);

/** Helvetica advance widths (1/1000 em) for ASCII 32–126. */
const HELVETICA_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556,
  556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

/** Width of `text` in points. Courier is exact; Helvetica uses the AFM widths (bold is estimated 5 % wider). */
export function measureText(text: string, font: PdfFont, size: number): number {
  const encoded = toWinAnsi(text);
  if (font === "mono") return encoded.length * 0.6 * size;
  let units = 0;
  for (const char of encoded) {
    const code = char.charCodeAt(0);
    units += code >= 32 && code <= 126 ? HELVETICA_WIDTHS[code - 32]! : 556;
  }
  return (units / 1000) * size * (font === "bold" ? 1.05 : 1);
}

/** Splits `text` into lines no wider than `maxWidth`, breaking at spaces (a longer word is left whole). */
export function wrapText(text: string, font: PdfFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && measureText(candidate, font, size) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

const num = (value: number) => (Math.round(value * 100) / 100).toString();
const colour = ([r, g, b]: Rgb) => `${num(r)} ${num(g)} ${num(b)}`;

function pdfDate(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `D:${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}Z`;
}

export class PdfDocument {
  private readonly pages: string[][] = [];

  constructor(private readonly info: { title: string; author: string; createdAt: Date }) {}

  get pageCount(): number {
    return this.pages.length;
  }

  /** Index of the page drawing calls target. */
  private cursor = -1;

  /** Starts a new page and makes it current. */
  addPage(): void {
    this.pages.push([]);
    this.cursor = this.pages.length - 1;
  }

  private get ops(): string[] {
    const page = this.pages[this.cursor];
    if (!page) throw new Error("Add a page first");
    return page;
  }

  /** Draws on a specific page (for footers written once the page count is known), then returns to the current one. */
  onPage(index: number, draw: () => void): void {
    const saved = this.cursor;
    this.cursor = index;
    try {
      draw();
    } finally {
      this.cursor = saved;
    }
  }

  /** `y` is measured from the top of the page, to the text baseline. */
  text(x: number, y: number, text: string, options: { font?: PdfFont; size?: number; color?: Rgb } = {}): void {
    const { font = "regular", size = 10, color = [0, 0, 0] } = options;
    this.ops.push(
      `BT /${FONT_RESOURCE[font]} ${num(size)} Tf ${colour(color)} rg ${num(x)} ${num(PAGE_HEIGHT - y)} Td (${escapeText(text)}) Tj ET`,
    );
  }

  line(x1: number, y1: number, x2: number, y2: number, options: { width?: number; color?: Rgb } = {}): void {
    const { width = 0.5, color = [0.8, 0.8, 0.8] } = options;
    this.ops.push(
      `${num(width)} w ${colour(color)} RG ${num(x1)} ${num(PAGE_HEIGHT - y1)} m ${num(x2)} ${num(PAGE_HEIGHT - y2)} l S`,
    );
  }

  /** A filled rectangle; `y` is its top edge. */
  rect(x: number, y: number, width: number, height: number, fill: Rgb): void {
    this.ops.push(`${colour(fill)} rg ${num(x)} ${num(PAGE_HEIGHT - y - height)} ${num(width)} ${num(height)} re f`);
  }

  toBytes(): Uint8Array {
    if (this.pages.length === 0) this.addPage();
    const chunks: Buffer[] = [];
    const offsets: number[] = [];
    let length = 0;
    const push = (text: string) => {
      const buffer = Buffer.from(text, "latin1");
      chunks.push(buffer);
      length += buffer.length;
    };
    const object = (id: number, body: string) => {
      offsets[id] = length;
      push(`${id} 0 obj\n${body}\nendobj\n`);
    };

    const pageIds = this.pages.map((_, i) => 7 + i * 2);
    push("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n");
    object(1, "<< /Type /Catalog /Pages 2 0 R >>");
    object(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${this.pages.length} >>`);
    (["regular", "bold", "mono"] as const).forEach((font, i) =>
      object(3 + i, `<< /Type /Font /Subtype /Type1 /BaseFont /${FONT_NAME[font]} /Encoding /WinAnsiEncoding >>`),
    );
    object(
      6,
      `<< /Title (${escapeText(this.info.title)}) /Author (${escapeText(this.info.author)}) /Producer (Elapsed) /CreationDate (${pdfDate(this.info.createdAt)}) >>`,
    );
    this.pages.forEach((ops, i) => {
      const stream = ops.join("\n");
      object(
        7 + i * 2,
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents ${8 + i * 2} 0 R >>`,
      );
      object(8 + i * 2, `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
    });

    const objectCount = 7 + this.pages.length * 2;
    const xrefAt = length;
    let xref = `xref\n0 ${objectCount}\n0000000000 65535 f \n`;
    for (let id = 1; id < objectCount; id++) xref += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
    push(xref);
    push(`trailer\n<< /Size ${objectCount} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);
    return new Uint8Array(Buffer.concat(chunks));
  }
}
