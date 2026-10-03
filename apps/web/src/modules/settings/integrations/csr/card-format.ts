/** Body copy under an integration card's title row. */
export const descriptionClass = "text-sm text-on-surface-variant";

export function formatDateTime(iso: string | Date): string {
  return new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Cairo" });
}
