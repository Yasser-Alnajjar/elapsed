import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// `text-xxs` is a custom font size from the theme; without registering it,
// twMerge treats it as a text colour and drops it next to e.g. `text-primary`.
const twMerge = extendTailwindMerge({
  extend: { classGroups: { "font-size": [{ text: ["xxs"] }] } },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** A caught value's message, for logs and error responses — `throw` can throw anything, not only an `Error`. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
