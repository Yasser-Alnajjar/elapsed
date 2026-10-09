import { isIP } from "node:net";

/**
 * Address classification shared by every outbound-destination guard
 * (extracted from `@sla/email`'s SMTP guard, H-10 F-D, unchanged; `@sla/email`
 * re-exports `isPublicAddress` from here). True only for a publicly routable
 * unicast address: loopback, RFC 1918, link-local and the cloud metadata
 * address, CGNAT, NAT64, Teredo, 6to4, unique-local and IPv4-mapped IPv6 forms
 * of those are all refused.
 */
function ipv4ToInt(address: string): number {
  return address.split(".").reduce((acc, part) => acc * 256 + Number(part), 0);
}

/** [network, prefix length] for every IPv4 range that is not a public unicast destination. */
const BLOCKED_IPV4: [string, number][] = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, cloud metadata
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, incl. broadcast
];

function isPublicIPv4(address: string): boolean {
  const value = ipv4ToInt(address);
  return !BLOCKED_IPV4.some(([network, bits]) => {
    const size = 2 ** (32 - bits);
    const start = ipv4ToInt(network);
    return value >= start && value < start + size;
  });
}

/** Expands any IPv6 text form to eight 16-bit groups, or null when it isn't valid. */
function expandIPv6(address: string): number[] | null {
  let text = address.toLowerCase().split("%")[0]!; // drop a zone id
  const embedded = text.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (embedded) {
    const v4 = ipv4ToInt(embedded[1]!);
    text = text.replace(embedded[1]!, `${((v4 >>> 16) & 0xffff).toString(16)}:${(v4 & 0xffff).toString(16)}`);
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

function isPublicIPv6(address: string): boolean {
  const g = expandIPv6(address);
  if (!g) return false; // unparseable: refuse
  const [a, b, c, d, e, f, g6, h] = g as [number, number, number, number, number, number, number, number];
  const v4 = `${g6 >> 8}.${g6 & 255}.${h >> 8}.${h & 255}`;
  if (g.every((x) => x === 0)) return false; // ::
  if (g.slice(0, 7).every((x) => x === 0) && h === 1) return false; // ::1
  if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && f === 0xffff) return isPublicIPv4(v4); // ::ffff:a.b.c.d
  if (a === 0x64 && b === 0xff9b) return false; // NAT64 64:ff9b::/96 can reach IPv4 internals
  if (a === 0x2002) return isPublicIPv4(`${b >> 8}.${b & 255}.${c >> 8}.${c & 255}`); // 6to4 embeds an IPv4
  if (a === 0x2001 && b === 0) return false; // Teredo
  if (a === 0x2001 && b === 0xdb8) return false; // documentation
  if ((a & 0xfe00) === 0xfc00) return false; // unique local fc00::/7
  if ((a & 0xffc0) === 0xfe80) return false; // link-local fe80::/10
  if ((a & 0xff00) === 0xff00) return false; // multicast
  return true;
}

export function isPublicAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isPublicIPv4(address);
  if (version === 6) return isPublicIPv6(address);
  return false;
}
