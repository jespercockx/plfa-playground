// Minimal read-only ZIP reader for the build scripts.
//
// The standard-library interface archive (see the `interfaces` setting in
// playground.config.json) is hundreds of megabytes, so it is downloaded once by
// scripts/sync-runtime.mjs and extracted into `static/`. Doing that with Node
// instead of shelling out to `unzip` keeps the build cross-platform.
//
// Only the parts of the format the published archives use are implemented: the
// classic (non-ZIP64) end-of-central-directory record and central directory,
// with stored (method 0) and deflated (method 8) entries. The archives are far
// below the 4 GiB / 65535-entry thresholds.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { inflateRawSync } from "node:zlib";

function findEndOfCentralDirectory(buffer) {
  const earliest = Math.max(0, buffer.length - 22 - 0xffff);
  for (let offset = buffer.length - 22; offset >= earliest; offset--) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error("not a ZIP archive: no end-of-central-directory record");
}

/**
 * Extract `buffer` (an in-memory ZIP) into `destination`.
 *
 * `filter(name)` may return false to skip an entry; names are archive-relative
 * POSIX paths (for example `src/Data/Nat.agdai`). Returns the number of files
 * written.
 */
export function extractZip(buffer, destination, filter = () => true) {
  const eocd = findEndOfCentralDirectory(buffer);
  const total = buffer.readUInt16LE(eocd + 10);
  let cursor = buffer.readUInt32LE(eocd + 16);
  let count = 0;

  for (let index = 0; index < total; index++) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error("corrupt ZIP central directory");
    }
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString("utf8", cursor + 46, cursor + 46 + nameLength);
    cursor += 46 + nameLength + extraLength + commentLength;

    if (name.endsWith("/") || !filter(name)) continue;

    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(dataStart, dataStart + compressedSize);
    const data = method === 0 ? raw : inflateRawSync(raw);

    const outputPath = join(destination, name);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, data);
    count++;
  }

  return count;
}
