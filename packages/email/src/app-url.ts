/**
 * Normalizes a deployment URL to its origin (`https://app.example.com`, no
 * path or trailing slash), or null when it is missing or not http(s). The
 * layout links it in the footer, so a malformed value must read as "not
 * configured", never as a broken or unsafe link.
 */
export function normalizeAppUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

/** The deployment's public origin: `NEXTAUTH_URL`, the same variable the web app and worker already treat as the deployment base URL. */
export function resolveAppUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  return normalizeAppUrl(env.NEXTAUTH_URL);
}
