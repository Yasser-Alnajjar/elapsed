import type { DraftConfigDocument } from "@/lib/types/custom-provider";

/** Pure helpers for the Custom REST wizard's editable configuration document. */
export type Key = string | number;

export function emptyConfig(): DraftConfigDocument {
  return {
    schemaVersion: 1,
    displayName: "",
    connection: { baseUrl: "" },
    auth: { type: "api_key_header", headerName: "X-Api-Key" },
    tickets: { request: { method: "GET", path: "/tickets" }, itemsPath: "$.data[*]", pagination: { type: "none" } },
    mapping: { id: "$.id", createdAt: "$.created_at", status: "$.status" },
    valueMaps: { status: { open: "open", closed: "closed" } },
    unknownStatus: "fail",
    importWindowDays: 90,
    slaMode: "resolution_only",
  };
}

export function getIn(value: unknown, path: readonly Key[]): unknown {
  let current = value;
  for (const key of path) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<Key, unknown>)[key];
  }
  return current;
}

/** Returns a copy of `root` with `value` at `path`; `undefined` or an empty string removes the key. Prototype keys are refused. */
export function setIn<T extends DraftConfigDocument>(root: T, path: readonly Key[], value: unknown): T {
  if (path.some((key) => key === "__proto__" || key === "constructor" || key === "prototype")) return root;
  const [head, ...rest] = path;
  if (head === undefined) return root;
  const next: Record<Key, unknown> = Array.isArray(root) ? ([...root] as unknown as Record<Key, unknown>) : { ...(root as Record<Key, unknown>) };
  if (rest.length === 0) {
    if (value === undefined || value === "") delete next[head];
    else next[head] = value;
  } else {
    const child = next[head];
    next[head] = setIn((child !== null && typeof child === "object" ? child : {}) as DraftConfigDocument, rest, value);
  }
  return next as T;
}

export interface SamplePath {
  path: string;
  preview: string;
}

/** Paths in a sample ticket, for the field pickers. Arrays of objects are shown once, as `[*]`. Bounded in depth and count. */
export function samplePaths(value: unknown, limit = 150): SamplePath[] {
  const out: SamplePath[] = [];
  const walk = (node: unknown, prefix: string, depth: number) => {
    if (out.length >= limit || depth > 5) return;
    if (Array.isArray(node)) {
      if (node.length > 0 && typeof node[0] === "object" && node[0] !== null) walk(node[0], `${prefix}[*]`, depth + 1);
      else out.push({ path: prefix, preview: preview(node) });
    } else if (node !== null && typeof node === "object") {
      for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
        walk(child, /^[A-Za-z0-9_-]+$/.test(key) ? `${prefix}.${key}` : `${prefix}['${key}']`, depth + 1);
      }
    } else {
      out.push({ path: prefix, preview: preview(node) });
    }
  };
  walk(value, "$", 0);
  return out;
}

function preview(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 40 ? `${text.slice(0, 39)}…` : text;
}

/** `key=value` lines to a record, and back. */
export function linesToRecord(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const at = line.indexOf("=");
    if (at > 0) out[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return out;
}

export const recordToLines = (record: unknown): string =>
  record !== null && typeof record === "object" ? Object.entries(record as Record<string, string>).map(([k, v]) => `${k}=${v}`).join("\n") : "";
