// zip_reader.ts — central-directory ZIP reader with streaming, budgeted extraction.
//
// The canonical security boundary cannot be a `unzip` subprocess. A subprocess
// decides for itself what a member path means, whether to follow a symlink entry,
// and how many bytes to write; by the time it returns, the damage is on disk.
// Reading the central directory ourselves means every member is classified,
// path-checked and budgeted BEFORE a single byte is materialized, and the
// extractor stops mid-member the moment a byte budget is exceeded.
//
// Scope: ZIP only, stored (0) and deflate (8). Node's zlib supplies raw inflate,
// so this adds no dependency. Stored members stream a chunk at a time; deflated
// members are inflated synchronously and held whole, bounded by the extraction
// ceiling rather than by streaming. See `streamZipMember` for that contract. Zip64 central-directory records are understood so a
// large archive is read correctly rather than silently truncated.
import * as fs from "node:fs";
import * as zlib from "node:zlib";

const EOCD_SIGNATURE = 0x06054b50;
const EOCD_MIN_SIZE = 22;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_LOCATOR_SIZE = 20;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const CENTRAL_FIXED_SIZE = 46;
const LOCAL_SIGNATURE = 0x04034b50;
const LOCAL_FIXED_SIZE = 30;
const ZIP64_EXTRA_ID = 0x0001;
const MAX_EOCD_SEARCH = 0xffff + EOCD_MIN_SIZE;
const U32_MAX = 0xffffffff;
const U16_MAX = 0xffff;

/** General-purpose bit flags this reader interprets. */
const FLAG_ENCRYPTED = 0x0001;
const FLAG_STRONG_ENCRYPTION = 0x0040;
const FLAG_UTF8_NAME = 0x0800;

/** Compression methods this reader can decode. */
export const COMPRESSION_STORED = 0;
export const COMPRESSION_DEFLATE = 8;

/** Host system in `version made by`. 3 = Unix, the only host that carries st_mode. */
const HOST_UNIX = 3;

/** POSIX file-type mask and values, as encoded in the Unix external attributes. */
const S_IFMT = 0o170000;
const S_IFREG = 0o100000;
const S_IFDIR = 0o040000;
const S_IFLNK = 0o120000;
const S_IFIFO = 0o010000;
const S_IFCHR = 0o020000;
const S_IFBLK = 0o060000;
const S_IFSOCK = 0o140000;

export type ZipEntryKind = "file" | "directory" | "symlink" | "special" | "unknown";

export interface ZipCentralEntry {
  /** Member name exactly as stored, decoded per the UTF-8 flag. */
  name: string;
  /** True when the stored name is not valid UTF-8 and was decoded lossily. */
  nameEncodingSuspect: boolean;
  compressionMethod: number;
  generalPurposeFlags: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  externalAttributes: number;
  versionMadeBy: number;
  /** Entry kind derived from the Unix mode when present, else from the name. */
  kind: ZipEntryKind;
  /** True when either encryption bit is set. */
  encrypted: boolean;
  /** Unix mode when the host system recorded one, else null. */
  unixMode: number | null;
  /** Index in central-directory order. Preserved so ordering is reproducible. */
  index: number;
}

export interface ZipDirectory {
  entries: ZipCentralEntry[];
  /** Total entry count declared by the end-of-central-directory record. */
  declaredEntryCount: number;
  /** True when the archive used Zip64 records. */
  zip64: boolean;
}

export class ZipFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipFormatError";
  }
}

function readExact(fd: number, length: number, position: number): Buffer {
  if (length < 0) throw new ZipFormatError(`negative read length ${length}`);
  const buffer = Buffer.alloc(length);
  let read = 0;
  while (read < length) {
    const count = fs.readSync(fd, buffer, read, length - read, position + read);
    if (count === 0) throw new ZipFormatError(`unexpected end of archive at offset ${position + read}`);
    read += count;
  }
  return buffer;
}

/** Read an 8-byte little-endian value, refusing anything above Number.MAX_SAFE_INTEGER. */
function readSafeUInt64LE(buffer: Buffer, offset: number, label: string): number {
  const value = buffer.readBigUInt64LE(offset);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ZipFormatError(`${label} exceeds the safe integer range: ${value.toString()}`);
  }
  return Number(value);
}

function decodeMemberName(raw: Buffer, flags: number): { name: string; suspect: boolean } {
  // Bit 11 declares UTF-8. Without it the historical encoding is CP437, which this
  // reader does not transcode: the bytes are decoded as UTF-8 and flagged when that
  // is lossy, so a name that cannot be represented faithfully is visible rather than
  // silently mangled into a different path.
  try {
    const name = new TextDecoder("utf-8", { fatal: true }).decode(raw);
    return { name, suspect: (flags & FLAG_UTF8_NAME) === 0 && /[^\x20-\x7e]/.test(name) };
  } catch {
    return { name: raw.toString("utf8"), suspect: true };
  }
}

function entryKindFor(versionMadeBy: number, externalAttributes: number, name: string): {
  kind: ZipEntryKind;
  unixMode: number | null;
} {
  const host = (versionMadeBy >> 8) & 0xff;
  if (host === HOST_UNIX) {
    const mode = (externalAttributes >>> 16) & 0xffff;
    if (mode !== 0) {
      switch (mode & S_IFMT) {
        case S_IFLNK: return { kind: "symlink", unixMode: mode };
        case S_IFDIR: return { kind: "directory", unixMode: mode };
        case S_IFREG: return { kind: "file", unixMode: mode };
        case S_IFIFO:
        case S_IFCHR:
        case S_IFBLK:
        case S_IFSOCK: return { kind: "special", unixMode: mode };
        default: return { kind: "unknown", unixMode: mode };
      }
    }
  }
  // No usable mode: a trailing separator is the portable directory convention.
  return { kind: name.endsWith("/") ? "directory" : "file", unixMode: null };
}

interface Eocd {
  centralDirectoryOffset: number;
  centralDirectorySize: number;
  entryCount: number;
  zip64: boolean;
}

/** Offset of the end-of-central-directory record within the archive tail. */
function findEocdOffset(tail: Buffer): number {
  for (let i = tail.length - EOCD_MIN_SIZE; i >= 0; i--) {
    if (tail.readUInt32LE(i) === EOCD_SIGNATURE) return i;
  }
  throw new ZipFormatError("end-of-central-directory record not found");
}

/**
 * Read the Zip64 end-of-central-directory record the locator points at.
 *
 * Consulted only when the 32-bit record stored placeholder values, which is how a
 * large archive reports counts and offsets that do not fit in the classic record.
 */
function readZip64Eocd(fd: number, tail: Buffer, locatorOffset: number): Eocd {
  const recordOffset = readSafeUInt64LE(tail, locatorOffset + 8, "zip64 end-of-central-directory offset");
  const record = readExact(fd, 56, recordOffset);
  if (record.readUInt32LE(0) !== ZIP64_EOCD_SIGNATURE) {
    throw new ZipFormatError("zip64 end-of-central-directory record signature is invalid");
  }
  return {
    entryCount: readSafeUInt64LE(record, 32, "zip64 entry count"),
    centralDirectorySize: readSafeUInt64LE(record, 40, "zip64 central-directory size"),
    centralDirectoryOffset: readSafeUInt64LE(record, 48, "zip64 central-directory offset"),
    zip64: true,
  };
}

function locateEocd(fd: number, fileSize: number): Eocd {
  if (fileSize < EOCD_MIN_SIZE) throw new ZipFormatError("file is too small to be a ZIP archive");
  const searchLength = Math.min(fileSize, MAX_EOCD_SEARCH);
  const searchStart = fileSize - searchLength;
  const tail = readExact(fd, searchLength, searchStart);
  const eocdOffset = findEocdOffset(tail);

  const classic: Eocd = {
    entryCount: tail.readUInt16LE(eocdOffset + 10),
    centralDirectorySize: tail.readUInt32LE(eocdOffset + 12),
    centralDirectoryOffset: tail.readUInt32LE(eocdOffset + 16),
    zip64: false,
  };

  const needsZip64 = classic.entryCount === U16_MAX
    || classic.centralDirectorySize === U32_MAX
    || classic.centralDirectoryOffset === U32_MAX;
  const locatorOffset = eocdOffset - ZIP64_LOCATOR_SIZE;
  const hasLocator = locatorOffset >= 0 && tail.readUInt32LE(locatorOffset) === ZIP64_LOCATOR_SIGNATURE;
  const resolved = needsZip64 && hasLocator ? readZip64Eocd(fd, tail, locatorOffset) : classic;

  if (resolved.centralDirectoryOffset + resolved.centralDirectorySize > fileSize) {
    throw new ZipFormatError("central directory extends past the end of the archive");
  }
  return resolved;
}

/**
 * Locate the Zip64 extended-information field's payload inside an extra-field blob.
 *
 * The blob is a sequence of `(id, size, data)` records from any number of
 * producers, so finding ours is a separate concern from interpreting it.
 */
function findZip64ExtraPayload(extra: Buffer): Buffer | null {
  let cursor = 0;
  while (cursor + 4 <= extra.length) {
    const headerId = extra.readUInt16LE(cursor);
    const dataSize = extra.readUInt16LE(cursor + 2);
    const dataStart = cursor + 4;
    // A record that claims more bytes than remain is malformed; stop rather than
    // read past the blob.
    if (dataStart + dataSize > extra.length) return null;
    if (headerId === ZIP64_EXTRA_ID) return extra.subarray(dataStart, dataStart + dataSize);
    cursor = dataStart + dataSize;
  }
  return null;
}

/**
 * Apply the Zip64 extended-information extra field to the placeholder sizes.
 *
 * The payload is a positional list: a 64-bit value appears only for a field whose
 * 32-bit slot held the `0xFFFFFFFF` placeholder, in a fixed order. So the reader
 * walks the list in that order and consumes one value per placeholder it finds,
 * leaving a placeholder in place when the payload ran out.
 */
function applyZip64Extra(
  extra: Buffer,
  entry: { uncompressedSize: number; compressedSize: number; localHeaderOffset: number },
): void {
  const payload = findZip64ExtraPayload(extra);
  if (payload === null) return;

  let field = 0;
  const nextValue = (label: string): number | null => {
    if (field + 8 > payload.length) return null;
    const value = readSafeUInt64LE(payload, field, label);
    field += 8;
    return value;
  };

  if (entry.uncompressedSize === U32_MAX) {
    entry.uncompressedSize = nextValue("zip64 uncompressed size") ?? entry.uncompressedSize;
  }
  if (entry.compressedSize === U32_MAX) {
    entry.compressedSize = nextValue("zip64 compressed size") ?? entry.compressedSize;
  }
  if (entry.localHeaderOffset === U32_MAX) {
    entry.localHeaderOffset = nextValue("zip64 local header offset") ?? entry.localHeaderOffset;
  }
}

/** Parse one central-directory header at `cursor`, or throw if it is malformed. */
function readCentralEntry(
  central: Buffer,
  cursor: number,
  index: number,
): { entry: ZipCentralEntry; next: number } {
  if (central.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) {
    throw new ZipFormatError(`central-directory header signature is invalid at offset ${cursor}`);
  }
  const versionMadeBy = central.readUInt16LE(cursor + 4);
  const generalPurposeFlags = central.readUInt16LE(cursor + 8);
  const nameLength = central.readUInt16LE(cursor + 28);
  const extraLength = central.readUInt16LE(cursor + 30);
  const commentLength = central.readUInt16LE(cursor + 32);
  const sizes = {
    compressedSize: central.readUInt32LE(cursor + 20),
    uncompressedSize: central.readUInt32LE(cursor + 24),
    localHeaderOffset: central.readUInt32LE(cursor + 42),
  };
  const nameStart = cursor + CENTRAL_FIXED_SIZE;
  const extraStart = nameStart + nameLength;
  const commentStart = extraStart + extraLength;
  const next = commentStart + commentLength;
  if (next > central.length) throw new ZipFormatError("central-directory entry runs past the directory");

  applyZip64Extra(central.subarray(extraStart, commentStart), sizes);
  const decoded = decodeMemberName(central.subarray(nameStart, extraStart), generalPurposeFlags);
  const externalAttributes = central.readUInt32LE(cursor + 38);
  const classified = entryKindFor(versionMadeBy, externalAttributes, decoded.name);

  return {
    entry: {
      name: decoded.name,
      nameEncodingSuspect: decoded.suspect,
      compressionMethod: central.readUInt16LE(cursor + 10),
      generalPurposeFlags,
      crc32: central.readUInt32LE(cursor + 16),
      compressedSize: sizes.compressedSize,
      uncompressedSize: sizes.uncompressedSize,
      localHeaderOffset: sizes.localHeaderOffset,
      externalAttributes,
      versionMadeBy,
      kind: classified.kind,
      encrypted: (generalPurposeFlags & (FLAG_ENCRYPTED | FLAG_STRONG_ENCRYPTION)) !== 0,
      unixMode: classified.unixMode,
      index,
    },
    next,
  };
}

/**
 * Read an archive's central directory.
 *
 * The central directory — not the local headers — is the authority for what an
 * archive claims to contain, so preflight can run over the complete member list
 * before any extraction begins.
 */
export function readZipCentralDirectory(archivePath: string): ZipDirectory {
  const fd = fs.openSync(archivePath, "r");
  try {
    const eocd = locateEocd(fd, fs.fstatSync(fd).size);
    const central = readExact(fd, eocd.centralDirectorySize, eocd.centralDirectoryOffset);

    const entries: ZipCentralEntry[] = [];
    let cursor = 0;
    while (cursor + CENTRAL_FIXED_SIZE <= central.length) {
      const parsed = readCentralEntry(central, cursor, entries.length);
      entries.push(parsed.entry);
      cursor = parsed.next;
    }

    // The loop above stops when fewer than a fixed header's bytes remain, which
    // is not the same as having read the directory. Both of the archive's own
    // completeness claims have to be met, or the member list is a prefix of the
    // truth and everything downstream — preflight, classification, the byte
    // budget — is deciding over a subset while believing it holds the whole.
    //
    // Failing closed is the only safe direction here: an attacker who can make
    // the reader stop early chooses which members preflight never sees.
    if (entries.length !== eocd.entryCount) {
      throw new ZipFormatError(
        `central directory declares ${eocd.entryCount} entries but ${entries.length} could be parsed`,
      );
    }
    if (cursor !== central.length) {
      throw new ZipFormatError(
        `central directory declares ${central.length} bytes but ${cursor} were consumed`,
      );
    }
    return { entries, declaredEntryCount: eocd.entryCount, zip64: eocd.zip64 };
  } finally {
    fs.closeSync(fd);
  }
}

// ───────────────────────────── CRC-32 ─────────────────────────────

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

/** Incremental CRC-32, matching the checksum a ZIP central directory records. */
export class Crc32 {
  private state = 0xffffffff;
  update(chunk: Buffer): void {
    let crc = this.state;
    for (const byte of chunk) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    this.state = crc;
  }
  digest(): number {
    return (this.state ^ 0xffffffff) >>> 0;
  }
}

// ───────────────────────────── member streaming ─────────────────────────────

export interface ZipMemberStreamLimits {
  /** Hard ceiling on bytes produced for this member. Exceeding it aborts the read. */
  maxUncompressedBytes: number;
  /** Chunk size used for stored members and for the sink. */
  chunkBytes?: number;
}

export class ZipBudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipBudgetExceededError";
  }
}

export interface ZipMemberStreamResult {
  bytesWritten: number;
  crc32: number;
}

/** Read a stored (uncompressed) member incrementally, one chunk at a time. */
function readStoredMember(
  fd: number,
  entry: ZipCentralEntry,
  dataStart: number,
  chunkBytes: number,
  emit: (chunk: Buffer) => void,
): void {
  const readBuffer = Buffer.alloc(chunkBytes);
  let remaining = entry.compressedSize;
  let position = dataStart;
  while (remaining > 0) {
    const want = Math.min(readBuffer.length, remaining);
    const count = fs.readSync(fd, readBuffer, 0, want, position);
    if (count === 0) throw new ZipFormatError(`unexpected end of stored member ${entry.name}`);
    emit(Buffer.from(readBuffer.subarray(0, count)));
    position += count;
    remaining -= count;
  }
}

/**
 * Inflate a deflated member whole, under a ceiling zlib itself enforces.
 *
 * `inflateRawSync` is a synchronous, whole-output call: the compressed bytes are
 * read entirely and the inflated result exists entirely before the first chunk is
 * emitted. `maxOutputLength` is what makes that safe — zlib aborts at the limit,
 * so a member that lies about its uncompressed size still cannot allocate past
 * the ceiling, and the sink never sees a byte of the excess.
 */
function readDeflatedMember(
  fd: number,
  entry: ZipCentralEntry,
  dataStart: number,
  chunkBytes: number,
  maxUncompressedBytes: number,
  emit: (chunk: Buffer) => void,
): void {
  const compressed = readExact(fd, entry.compressedSize, dataStart);
  let inflated: Buffer;
  try {
    inflated = zlib.inflateRawSync(compressed, { maxOutputLength: maxUncompressedBytes });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ERR_BUFFER_TOO_LARGE") {
      throw new ZipBudgetExceededError(
        `member ${entry.name} exceeded the ${maxUncompressedBytes}-byte extraction ceiling`,
      );
    }
    throw new ZipFormatError(
      `member ${entry.name} could not be decompressed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  for (let offset = 0; offset < inflated.length; offset += chunkBytes) {
    emit(inflated.subarray(offset, Math.min(offset + chunkBytes, inflated.length)));
  }
}

/** Offset of a member's data, read from its local header. */
function memberDataStart(fd: number, entry: ZipCentralEntry): number {
  const header = readExact(fd, LOCAL_FIXED_SIZE, entry.localHeaderOffset);
  if (header.readUInt32LE(0) !== LOCAL_SIGNATURE) {
    throw new ZipFormatError(`local header signature is invalid for ${entry.name}`);
  }
  return entry.localHeaderOffset + LOCAL_FIXED_SIZE + header.readUInt16LE(26) + header.readUInt16LE(28);
}

/**
 * Read one member and hand its bytes to `sink` in chunks.
 *
 * `maxUncompressedBytes` is enforced by the decompressor itself, not by trusting
 * the central directory: a member that understates its uncompressed size still
 * cannot produce more than the ceiling, because zlib aborts at the limit and the
 * sink never sees the excess. That is the runtime accounting a declared-size
 * check alone cannot provide.
 *
 * The two paths do not cost the same memory, and the difference is deliberate.
 * A stored member is read incrementally, so an uncompressed archive of any size
 * costs one chunk. A deflated member is inflated synchronously and held whole:
 * peak cost is its compressed bytes plus its inflated bytes, and the chunking
 * below is a delivery detail, not evidence of streaming. What bounds that is
 * `maxUncompressedBytes`, enforced inside zlib, together with the archive- and
 * member-level ceilings the caller derives from the archive policy. Within
 * those ceilings the buffering is bounded; there is no size at which this
 * becomes a streaming inflate. Raising them raises real peak memory.
 */
export function streamZipMember(
  archivePath: string,
  entry: ZipCentralEntry,
  limits: ZipMemberStreamLimits,
  sink: (chunk: Buffer) => void,
): ZipMemberStreamResult {
  if (entry.compressionMethod !== COMPRESSION_STORED && entry.compressionMethod !== COMPRESSION_DEFLATE) {
    throw new ZipFormatError(`unsupported compression method ${entry.compressionMethod} for ${entry.name}`);
  }
  // An exhausted allowance is a budget outcome, not a malformed archive. Checking it
  // here keeps the stored and deflated paths reporting the same thing: zlib rejects a
  // zero `maxOutputLength` as an out-of-range argument, which would otherwise surface
  // as a format error and misattribute a budget refusal to the archive's contents.
  if (limits.maxUncompressedBytes <= 0) {
    throw new ZipBudgetExceededError(
      `member ${entry.name} cannot be extracted: the remaining extraction allowance is exhausted`,
    );
  }

  const fd = fs.openSync(archivePath, "r");
  try {
    const dataStart = memberDataStart(fd, entry);
    const crc = new Crc32();
    let produced = 0;
    const emit = (chunk: Buffer): void => {
      produced += chunk.length;
      if (produced > limits.maxUncompressedBytes) {
        throw new ZipBudgetExceededError(
          `member ${entry.name} exceeded the ${limits.maxUncompressedBytes}-byte extraction ceiling`,
        );
      }
      crc.update(chunk);
      sink(chunk);
    };

    const chunkBytes = Math.max(1, limits.chunkBytes ?? 64 * 1024);
    if (entry.compressionMethod === COMPRESSION_STORED) {
      readStoredMember(fd, entry, dataStart, chunkBytes, emit);
    } else {
      readDeflatedMember(fd, entry, dataStart, chunkBytes, limits.maxUncompressedBytes, emit);
    }
    return { bytesWritten: produced, crc32: crc.digest() };
  } finally {
    fs.closeSync(fd);
  }
}
