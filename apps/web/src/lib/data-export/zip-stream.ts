import { crc32Update } from "../zip";

/**
 * Streaming ZIP writer: stored (uncompressed) entries whose data is not known
 * up front, so each entry is written with a data descriptor (general-purpose bit
 * 3) after its bytes, and sizes and CRC go in the central directory at the end.
 * `createZip` in `../zip.ts` builds a whole archive in memory, which a raw-event
 * export cannot afford. No ZIP64: an archive past 4 GiB throws, and the caller
 * points at the JSON Lines backup, which has no such limit.
 */

export interface ZipStreamEntry {
  name: string;
  chunks: AsyncIterable<string | Uint8Array> | Iterable<string | Uint8Array>;
}

/** Leave room for the central directory under the 32-bit offset limit. */
const MAX_BYTES = 0xffffffff - 1024 * 1024;

export class ZipTooLargeError extends Error {
  constructor() {
    super("This export is larger than a ZIP archive can hold (4 GiB). Use the JSON Lines backup instead.");
    this.name = "ZipTooLargeError";
  }
}

function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getUTCFullYear());
  return {
    time: (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
  };
}

const FLAGS = 0x0808; // bit 3: sizes follow in a data descriptor; bit 11: UTF-8 names

export async function* zipStream(
  entries: AsyncIterable<ZipStreamEntry>,
  options: { modifiedAt?: Date; /** Total size past which it throws. Defaults to just under 4 GiB; a parameter so tests need not write that much. */ maxBytes?: number } = {},
): AsyncGenerator<Uint8Array, void, void> {
  const { modifiedAt = new Date(), maxBytes = MAX_BYTES } = options;
  const encoder = new TextEncoder();
  const stamp = dosDateTime(modifiedAt);
  const central: Uint8Array[] = [];
  let offset = 0;
  let count = 0;

  for await (const entry of entries) {
    const name = encoder.encode(entry.name);
    const entryOffset = offset;

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, FLAGS, true);
    local.setUint16(8, 0, true); // stored
    local.setUint16(10, stamp.time, true);
    local.setUint16(12, stamp.date, true); // crc and sizes: zero, in the descriptor below
    local.setUint16(26, name.length, true);
    yield new Uint8Array(local.buffer);
    yield name;
    offset += 30 + name.length;

    let crc = 0xffffffff;
    let size = 0;
    for await (const chunk of entry.chunks) {
      const bytes = typeof chunk === "string" ? encoder.encode(chunk) : chunk;
      if (bytes.length === 0) continue;
      size += bytes.length;
      offset += bytes.length;
      if (offset > maxBytes) throw new ZipTooLargeError();
      crc = crc32Update(crc, bytes);
      yield bytes;
    }
    crc = (crc ^ 0xffffffff) >>> 0;

    const descriptor = new DataView(new ArrayBuffer(16));
    descriptor.setUint32(0, 0x08074b50, true);
    descriptor.setUint32(4, crc, true);
    descriptor.setUint32(8, size, true);
    descriptor.setUint32(12, size, true);
    yield new Uint8Array(descriptor.buffer);
    offset += 16;

    const header = new DataView(new ArrayBuffer(46));
    header.setUint32(0, 0x02014b50, true);
    header.setUint16(4, 20, true);
    header.setUint16(6, 20, true);
    header.setUint16(8, FLAGS, true);
    header.setUint16(10, 0, true);
    header.setUint16(12, stamp.time, true);
    header.setUint16(14, stamp.date, true);
    header.setUint32(16, crc, true);
    header.setUint32(20, size, true);
    header.setUint32(24, size, true);
    header.setUint16(28, name.length, true);
    header.setUint32(42, entryOffset, true);
    central.push(new Uint8Array(header.buffer), name);
    count += 1;
  }

  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  for (const part of central) yield part;
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, count, true);
  end.setUint16(10, count, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  yield new Uint8Array(end.buffer);
}
