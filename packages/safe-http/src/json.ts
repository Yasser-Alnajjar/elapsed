import { SafeHttpError } from "./errors";

/**
 * Parses JSON after checking nesting depth on the raw text, so a hostile
 * deeply-nested document is refused before `JSON.parse` builds it. The depth
 * counter respects strings and escapes.
 */
export function parseJsonLimited(text: string, maxDepth: number): unknown {
  let depth = 0;
  let inString = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    if (inString) {
      if (ch === 0x5c) i += 1; // backslash: skip the escaped character
      else if (ch === 0x22) inString = false;
      continue;
    }
    if (ch === 0x22) inString = true;
    else if (ch === 0x7b || ch === 0x5b) {
      depth += 1;
      if (depth > maxDepth) throw new SafeHttpError("bad_response");
    } else if (ch === 0x7d || ch === 0x5d) depth -= 1;
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new SafeHttpError("bad_response");
  }
}
