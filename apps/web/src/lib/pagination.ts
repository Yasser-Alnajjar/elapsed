/**
 * Pagination arithmetic shared by every table. Pages are 1-based everywhere
 * (URL `?page=`, component props, these helpers).
 */

/** Page sizes every table offers. Server-paginated lists whitelist the same values. */
export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

export const DEFAULT_PAGE_SIZE = 10;

export function pageCountOf(total: number, pageSize = DEFAULT_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/** The rows of a 1-based `page`. */
export function pageOf<T>(rows: readonly T[], page: number, pageSize = DEFAULT_PAGE_SIZE): T[] {
  const start = (Math.max(1, page) - 1) * pageSize;
  return rows.slice(start, start + pageSize);
}

/** The 1-based, inclusive row range a page covers, e.g. `{ from: 26, to: 50 }`; `{ from: 0, to: 0 }` when empty. */
export function pageRange(page: number, pageSize: number, rowCount: number): { from: number; to: number } {
  if (rowCount <= 0) return { from: 0, to: 0 };
  const from = (Math.max(1, page) - 1) * pageSize + 1;
  return { from: Math.min(from, rowCount), to: Math.min(page * pageSize, rowCount) };
}

/** Page buttons to show (1-based), with `null` for an ellipsis: first, last, and the current page's neighbours. */
export function pageWindow(page: number, pageCount: number): (number | null)[] {
  if (pageCount <= 5) return Array.from({ length: pageCount }, (_, index) => index + 1);
  const pages = new Set([1, pageCount, page - 1, page, page + 1].filter((p) => p >= 1 && p <= pageCount));
  if (page <= 2) pages.add(3);
  if (page >= pageCount - 1) pages.add(pageCount - 2);
  const sorted = [...pages].sort((a, b) => a - b);
  const window: (number | null)[] = [];
  sorted.forEach((p, index) => {
    if (index > 0 && p - sorted[index - 1]! > 1) window.push(null);
    window.push(p);
  });
  return window;
}
