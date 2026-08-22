// zip_fixtures.ts — hand-built ZIP archives for the local-source security matrix.
//
// The archives here are deliberately malformed or hostile: traversal paths, drive
// letters, symlink entries, encrypted members, case and Unicode collisions,
// declared expansions far larger than their compressed size. A normal zip tool
// refuses to produce most of them, so the bytes are assembled directly. Keeping
// the writer in the test tree means every security assertion is made against a
// real archive rather than a mocked reader.
import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";

const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const EOCD_SIGNATURE = 0x06054b50;

/** POSIX file-type bits, shifted into the Unix external-attributes half-word. */
export const UNIX_REGULAR = 0o100644;
export const UNIX_DIRECTORY = 0o040755;
export const UNIX_SYMLINK = 0o120777;
export const UNIX_FIFO = 0o010644;
/** `version made by` with host system 3 (Unix). */
const VERSION_MADE_BY_UNIX = (3 << 8) | 20;
const VERSION_MADE_BY_DOS = 20;

export interface ZipMemberSpec {
  /** Member name written verbatim into the archive; never sanitized. */
  name: string;
  /** Member content. Ignored for directory entries. */
  content?: Buffer | string;
  /** Unix mode; decides the entry kind the reader derives. */
  unixMode?: number;
  /** Store uncompressed instead of deflating. */
  stored?: boolean;
  /** Set the encryption bit without actually encrypting; enough to be refused. */
  encrypted?: boolean;
  /** Force a compression method the reader does not support (e.g. 9 = deflate64). */
  compressionMethod?: number;
  /** Override the declared uncompressed size, so metadata can lie. */
  declaredUncompressedSize?: number;
  /** Omit the Unix host marker so the reader falls back to the name convention. */
  dosHost?: boolean;
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

interface PreparedMember {
  nameBytes: Buffer;
  data: Buffer;
  crc: number;
  uncompressedSize: number;
  compressionMethod: number;
  flags: number;
  externalAttributes: number;
  versionMadeBy: number;
  localHeaderOffset: number;
}

function prepare(spec: ZipMemberSpec): Omit<PreparedMember, "localHeaderOffset"> {
  const isDirectory = (spec.unixMode ?? 0) === UNIX_DIRECTORY || spec.name.endsWith("/");
  const declared = Buffer.isBuffer(spec.content)
    ? spec.content
    : Buffer.from(spec.content ?? "", "utf8");
  const raw = isDirectory ? Buffer.alloc(0) : declared;
  const stored = spec.stored === true || raw.length === 0;
  const data = stored ? raw : zlib.deflateRawSync(raw);
  const mode = spec.unixMode ?? (isDirectory ? UNIX_DIRECTORY : UNIX_REGULAR);
  return {
    nameBytes: Buffer.from(spec.name, "utf8"),
    data,
    crc: crc32(raw),
    uncompressedSize: spec.declaredUncompressedSize ?? raw.length,
    compressionMethod: spec.compressionMethod ?? (stored ? 0 : 8),
    // Bit 11 marks the name as UTF-8; bit 0 marks encryption.
    flags: 0x0800 | (spec.encrypted ? 0x0001 : 0),
    externalAttributes: spec.dosHost ? 0 : (mode << 16) >>> 0,
    versionMadeBy: spec.dosHost ? VERSION_MADE_BY_DOS : VERSION_MADE_BY_UNIX,
  };
}

/** Write a ZIP archive containing exactly the members given, verbatim. */
export function writeRawZip(archivePath: string, specs: ZipMemberSpec[]): string {
  fs.mkdirSync(path.dirname(archivePath), { recursive: true });
  const chunks: Buffer[] = [];
  const prepared: PreparedMember[] = [];
  let offset = 0;

  for (const spec of specs) {
    const member = prepare(spec);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_SIGNATURE, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(member.flags, 6);
    local.writeUInt16LE(member.compressionMethod, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(member.crc, 14);
    local.writeUInt32LE(member.data.length, 18);
    local.writeUInt32LE(member.uncompressedSize, 22);
    local.writeUInt16LE(member.nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, member.nameBytes, member.data);
    prepared.push({ ...member, localHeaderOffset: offset });
    offset += local.length + member.nameBytes.length + member.data.length;
  }

  const centralStart = offset;
  for (const member of prepared) {
    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_SIGNATURE, 0);
    central.writeUInt16LE(member.versionMadeBy, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(member.flags, 8);
    central.writeUInt16LE(member.compressionMethod, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(member.crc, 16);
    central.writeUInt32LE(member.data.length, 20);
    central.writeUInt32LE(member.uncompressedSize, 24);
    central.writeUInt16LE(member.nameBytes.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(member.externalAttributes, 38);
    central.writeUInt32LE(member.localHeaderOffset, 42);
    chunks.push(central, member.nameBytes);
    offset += central.length + member.nameBytes.length;
  }

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIGNATURE, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(prepared.length, 8);
  eocd.writeUInt16LE(prepared.length, 10);
  eocd.writeUInt32LE(offset - centralStart, 12);
  eocd.writeUInt32LE(centralStart, 16);
  eocd.writeUInt16LE(0, 20);
  chunks.push(eocd);

  fs.writeFileSync(archivePath, Buffer.concat(chunks));
  return archivePath;
}

/** Path -> content digest for every entry under a root. The mutation oracle. */
export function treeSnapshot(root: string): Record<string, string> {
  const crypto = require("node:crypto") as typeof import("node:crypto");
  const out: Record<string, string> = {};
  const walk = (directory: string): void => {
    for (const name of fs.readdirSync(directory).sort()) {
      const absolute = path.join(directory, name);
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      const stats = fs.lstatSync(absolute);
      if (stats.isSymbolicLink()) { out[relative] = `symlink:${fs.readlinkSync(absolute)}`; continue; }
      if (stats.isDirectory()) { out[`${relative}/`] = "dir"; walk(absolute); continue; }
      if (stats.isFile()) {
        out[relative] = crypto.createHash("sha256").update(fs.readFileSync(absolute)).digest("hex");
        continue;
      }
      out[relative] = "special";
    }
  };
  walk(root);
  return out;
}
