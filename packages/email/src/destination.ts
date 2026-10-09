import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { isPublicAddress } from "@sla/safe-http";

/**
 * SMTP destination guard for organization-supplied hosts (H-10 F-D).
 *
 * An organization owner chooses the SMTP host and port, and the server then
 * connects to it (Test Connection, Send Test Email, and every alert). Without
 * a check that is a way to probe or talk to anything the server can reach:
 * loopback, the cloud metadata address (169.254.169.254), the Docker network,
 * the database. `resolvePublicSmtpAddress` resolves the host, refuses when ANY
 * resolved address is not publicly routable, and returns the address to
 * connect to. Connecting to that address (not the name) closes the gap where
 * DNS answers differently between the check and the connect.
 *
 * Operator-configured SMTP (deployment-wide env config, ops alerts) is trusted
 * and does not use this. `SMTP_ALLOW_PRIVATE_HOSTS=1` disables the check for
 * local development (for example a Mailpit container) and intranet relays.
 */
export class SmtpDestinationNotAllowedError extends Error {
  readonly reason: "private" | "unresolvable";
  constructor(reason: "private" | "unresolvable") {
    super(
      reason === "private"
        ? "That SMTP host resolves to a private, loopback or otherwise non-public address, which is not allowed."
        : "That SMTP host could not be resolved.",
    );
    this.name = "SmtpDestinationNotAllowedError";
    this.reason = reason;
  }
}

// The classification lives in `@sla/safe-http` (shared with the custom ticket
// provider's HTTPS client); re-exported so existing imports keep working.
export { isPublicAddress };

export function privateSmtpHostsAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SMTP_ALLOW_PRIVATE_HOSTS === "1";
}

/**
 * Resolves `host` and returns one address to connect to. Throws
 * `SmtpDestinationNotAllowedError` when it can't be resolved or when ANY
 * address it resolves to is not public (a host with one public and one
 * private record is refused: the connection could pick either).
 */
export async function resolvePublicSmtpAddress(host: string): Promise<string> {
  const name = host.trim().replace(/\.$/, "");
  if (isIP(name)) {
    if (!isPublicAddress(name)) throw new SmtpDestinationNotAllowedError("private");
    return name;
  }
  let records: { address: string }[];
  try {
    records = await lookup(name, { all: true, verbatim: true });
  } catch {
    throw new SmtpDestinationNotAllowedError("unresolvable");
  }
  if (records.length === 0) throw new SmtpDestinationNotAllowedError("unresolvable");
  if (records.some((record) => !isPublicAddress(record.address))) {
    throw new SmtpDestinationNotAllowedError("private");
  }
  return records[0]!.address;
}
