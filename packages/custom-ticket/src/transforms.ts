import { parseDateValue, type DateFormat } from "./dates";
import { sourceFailureDraft, sourcesOf, tooLongDraft, wrongTypeDraft } from "./diagnostics";
import { MappingError } from "./errors";
import { evaluatePath } from "./path";
import type { Expr } from "./schema";

/** Values the engine reads from a source document. Objects and arrays are returned only by a bare path. */
export type Value = string | number | boolean | null | Value[] | { [key: string]: Value };

export interface EvalEnv {
  /** The configured IANA zone for wall-clock dates without an offset, or null. */
  timezone: string | null;
}

const MAX_STRING = 8192;
const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function asScalar(value: unknown, of: Expr): string | number | boolean | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  throw new MappingError("invalid_type", wrongTypeDraft(of, value, "text"));
}

function asText(value: unknown, of: Expr): string | null {
  const scalar = asScalar(value, of);
  if (scalar === null) return null;
  const text = String(scalar);
  if (text.length > MAX_STRING) throw new MappingError("transform_failed", tooLongDraft(text.length, MAX_STRING, sourcesOf(of).join(", ")));
  return text;
}

/**
 * Removes markup deterministically with a single scan (no regular
 * expressions, so no backtracking): tags are dropped, `<script>`/`<style>`
 * content too, common entities decoded, whitespace collapsed.
 */
export function stripHtml(input: string): string {
  let out = "";
  let i = 0;
  while (i < input.length) {
    const ch = input[i]!;
    if (ch === "<") {
      const end = input.indexOf(">", i + 1);
      if (end === -1) {
        out += input.slice(i);
        break;
      }
      const tag = input.slice(i + 1, end).trim().toLowerCase();
      const name = tag.replace(/^\//, "").split(/[\s/]/, 1)[0]!;
      if ((name === "script" || name === "style") && !tag.startsWith("/")) {
        const close = input.toLowerCase().indexOf(`</${name}`, end);
        const closeEnd = close === -1 ? -1 : input.indexOf(">", close);
        i = closeEnd === -1 ? input.length : closeEnd + 1;
        continue;
      }
      if (name === "br" || name === "p" || name === "div" || name === "li") out += " ";
      i = end + 1;
    } else if (ch === "&") {
      const semi = input.indexOf(";", i + 1);
      if (semi !== -1 && semi - i <= 10) {
        const entity = input.slice(i + 1, semi);
        let replacement: string | undefined = NAMED_ENTITIES[entity];
        if (replacement === undefined && /^#\d{1,6}$/.test(entity)) replacement = safeCodePoint(Number(entity.slice(1)));
        if (replacement === undefined && /^#x[0-9a-f]{1,6}$/i.test(entity)) replacement = safeCodePoint(parseInt(entity.slice(2), 16));
        if (replacement !== undefined) {
          out += replacement;
          i = semi + 1;
          continue;
        }
      }
      out += ch;
      i += 1;
    } else {
      out += ch;
      i += 1;
    }
  }
  return out.replace(/\s+/g, " ").trim();
}

function safeCodePoint(code: number): string | undefined {
  return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : undefined;
}

/**
 * Evaluates an expression against one source document. A path that matches
 * nothing yields null (a missing field), never an error; a malformed value or
 * a failed transform throws a `MappingError` with a fixed code.
 *
 * A bare path with several matches (a wildcard) yields the list of matches.
 */
export function evaluateExpr(expr: Expr, document: unknown, env: EvalEnv): Value {
  if (typeof expr === "string") {
    const matches = evaluatePath(expr, document);
    if (matches.length === 0) return null;
    if (matches.length === 1 && !/\[\*]/.test(expr)) return matches[0] as Value;
    return matches as Value;
  }
  switch (expr.transform) {
    case "constant":
      return expr.value;
    case "coalesce": {
      for (const part of expr.of) {
        const value = evaluateExpr(part, document, env);
        if (value !== null && value !== "" && !(Array.isArray(value) && value.length === 0)) return value;
      }
      return null;
    }
    case "template": {
      let missing = false;
      const rendered = expr.template.replace(/\{([A-Za-z0-9_-]{1,64})\}/g, (_match, name: string) => {
        const part = expr.values[name];
        if (part === undefined) {
          const available = Object.keys(expr.values);
          throw new MappingError("transform_failed", {
            reason: "undefined_variable",
            template: expr.template,
            variable: name,
            available,
            detail: `template "${expr.template}" references undefined variable "${name}". Available variables: ${available.join(", ") || "none"}.`,
          });
        }
        const text = asText(evaluateExpr(part, document, env), part);
        if (text === null) missing = true;
        return text ?? "";
      });
      if (missing) return null;
      if (rendered.length > MAX_STRING) throw new MappingError("transform_failed", { ...tooLongDraft(rendered.length, MAX_STRING), template: expr.template });
      return rendered;
    }
    case "trim": {
      const text = asText(evaluateExpr(expr.of, document, env), expr.of);
      return text === null ? null : text.trim();
    }
    case "lowercase": {
      const text = asText(evaluateExpr(expr.of, document, env), expr.of);
      return text === null ? null : text.toLowerCase();
    }
    case "stripHtml": {
      const text = asText(evaluateExpr(expr.of, document, env), expr.of);
      return text === null ? null : stripHtml(text);
    }
    case "epochToIso": {
      const value = evaluateExpr(expr.of, document, env);
      if (value === null) return null;
      return parseDateValue(value, { format: expr.unit === "seconds" ? "epoch_seconds" : "epoch_millis", timezone: env.timezone }).toISOString();
    }
    case "parseDate": {
      const value = evaluateExpr(expr.of, document, env);
      if (value === null) return null;
      return parseDateValue(value, { format: expr.format as DateFormat, timezone: expr.timezone ?? env.timezone }).toISOString();
    }
    case "valueMap": {
      const text = asText(evaluateExpr(expr.of, document, env), expr.of);
      if (text === null) return null;
      if (Object.hasOwn(expr.map, text)) return expr.map[text]!;
      return expr.fallback ?? null;
    }
  }
}

/** Evaluates an expression that must produce a date; a bare path is read as ISO 8601 (offset, or the configured zone). */
export function evaluateDate(expr: Expr, document: unknown, env: EvalEnv): Date | null {
  const value = evaluateExpr(expr, document, env);
  if (value === null) return null;
  if (Array.isArray(value) || typeof value === "object" || typeof value === "boolean") throw new MappingError("invalid_type", wrongTypeDraft(expr, value, "a date (text or a number)"));
  try {
    return parseDateValue(value, { format: "iso8601", timezone: env.timezone });
  } catch (error) {
    if (error instanceof MappingError && error.drafts.length === 0 && error.problems.length === 0) throw new MappingError(error.code, sourceFailureDraft(expr, error.code), { cause: error });
    throw error;
  }
}

/** Evaluates an expression that must produce text (a trimmed, non-empty string), or null when missing. */
export function evaluateText(expr: Expr, document: unknown, env: EvalEnv): string | null {
  const value = evaluateExpr(expr, document, env);
  if (value === null) return null;
  if (typeof value === "object") throw new MappingError("invalid_type", wrongTypeDraft(expr, value, "text"));
  const text = String(value).trim();
  if (text.length > MAX_STRING) throw new MappingError("transform_failed", tooLongDraft(text.length, MAX_STRING, sourcesOf(expr).join(", ")));
  return text === "" ? null : text;
}
