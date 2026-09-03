// tar_fixtures.ts — hand-built TAR archives and compressed-tarball signatures.
//
// This package has no TAR reader: every tarball is classified, hashed and
// reported as not expanded (ADR-036). The fixtures here exist to prove that
// refusal is explicit and total for every spelling and every hostile shape —
// traversal, absolute paths, links, devices, long names, truncation — and that
// none of them is opened, extracted or written anywhere. They are assembled
// directly because no ordinary tar tool produces most of them, and they are
// kept small: a fixture is a shape, not a payload.
import * as zlib from "node:zlib";

export type TarTypeFlag = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "L" | "K" | "x" | "g" | "S";

export interface TarEntrySpec {
  /** Name written verbatim into the 100-byte field (truncated if longer). */
  name: string;
  content?: string | Buffer;
  type?: TarTypeFlag;
  /** Link target for type 1 (hard) and 2 (symbolic). */
  linkName?: string;
  mode?: number;
  uid?: number;
  gid?: number;
  mtime?: number;
  /** Override the declared size; the data written is still `content`. */
  declaredSize?: number;
  /** Corrupt the header checksum. */
  badChecksum?: boolean;
}

function octal(value: number, width: number): string {
  return value.toString(8).padStart(width - 1, "0") + "\0";
}

/** One 512-byte ustar header plus data blocks. */
export function tarEntry(spec: TarEntrySpec): Buffer {
  const data = Buffer.isBuffer(spec.content) ? spec.content : Buffer.from(spec.content ?? "", "utf8");
  const header = Buffer.alloc(512);
  header.write(spec.name, 0, 100, "utf8");
  header.write(octal(spec.mode ?? 0o644, 8), 100);
  header.write(octal(spec.uid ?? 0, 8), 108);
  header.write(octal(spec.gid ?? 0, 8), 116);
  header.write(octal(spec.declaredSize ?? data.length, 12), 124);
  header.write(octal(spec.mtime ?? 0, 12), 136);
  header.write("        ", 148);
  header.write(spec.type ?? "0", 156);
  if (spec.linkName !== undefined) header.write(spec.linkName, 157, 100, "utf8");
  header.write("ustar\0", 257);
  header.write("00", 263);
  let sum = 0;
  for (const byte of header) sum += byte;
  if (spec.badChecksum) sum += 1;
  header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
  const padding = (512 - (data.length % 512)) % 512;
  return Buffer.concat([header, data, Buffer.alloc(padding)]);
}

/** A complete tar stream: entries followed by two zero blocks. */
export function tarBytes(entries: TarEntrySpec[]): Buffer {
  return Buffer.concat([...entries.map(tarEntry), Buffer.alloc(1024)]);
}

/** A benign tar: one directory and two small text files. */
export function benignTar(): Buffer {
  return tarBytes([
    { name: "docs/", type: "5", mode: 0o755 },
    { name: "docs/a.md", content: "# A\n\nStatus: WIP\n" },
    { name: "docs/b.txt", content: "plain text\n" },
  ]);
}

/** gzip is the only tarball compressor Node supplies; the rest are signatures. */
export function gzipTar(tar: Buffer): Buffer {
  return zlib.gzipSync(tar);
}

/**
 * Signature-bearing bodies for compressors this runtime cannot produce. The
 * bytes after the magic are the raw tar, which is not a valid stream for that
 * compressor — and that is exactly the point: nothing may try to decode it.
 */
export const COMPRESSOR_SIGNATURES = {
  bzip2: Buffer.from([0x42, 0x5a, 0x68, 0x39, 0x31, 0x41, 0x59, 0x26, 0x53, 0x59]),
  xz: Buffer.from([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00, 0x00, 0x04]),
  zstd: Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x24, 0x00]),
} as const;

export function signedBody(kind: keyof typeof COMPRESSOR_SIGNATURES, tar: Buffer): Buffer {
  return Buffer.concat([COMPRESSOR_SIGNATURES[kind], tar]);
}

/** Every hostile TAR shape the audit matrix names, as a deterministic corpus. */
export function hostileTarCorpus(): Record<string, Buffer> {
  const long = "l".repeat(120);
  return {
    "traversal.tar": tarBytes([{ name: "../escape.txt", content: "x" }]),
    "absolute.tar": tarBytes([{ name: "/etc/passwd", content: "x" }]),
    "drive.tar": tarBytes([{ name: "C:\\Windows\\win.ini", content: "x" }]),
    "symlink-escape.tar": tarBytes([
      { name: "link", type: "2", linkName: "../../outside" },
      { name: "link/inner.txt", content: "x" },
    ]),
    "hardlink-escape.tar": tarBytes([{ name: "hard", type: "1", linkName: "../../outside" }]),
    "chained-links.tar": tarBytes([
      { name: "a", type: "2", linkName: "b" },
      { name: "b", type: "2", linkName: "../c" },
    ]),
    "device.tar": tarBytes([{ name: "dev/null", type: "3", mode: 0o666 }]),
    "fifo.tar": tarBytes([{ name: "pipe", type: "6" }]),
    "setuid.tar": tarBytes([{ name: "root-shell", type: "0", mode: 0o4755, content: "#!/bin/sh\n" }]),
    "gnu-longname.tar": tarBytes([
      { name: "././@LongLink", type: "L", content: `${long}/${long}/../../escape.txt\0` },
      { name: "placeholder", content: "x" },
    ]),
    "pax-path.tar": tarBytes([
      { name: "PaxHeaders/x", type: "x", content: "30 path=../../pax-escape.txt\n" },
      { name: "x", content: "x" },
    ]),
    "sparse.tar": tarBytes([{ name: "sparse.bin", type: "S", content: Buffer.alloc(512), declaredSize: 1 << 30 }]),
    "size-lie.tar": tarBytes([{ name: "lie.txt", content: "short", declaredSize: 4096 }]),
    "duplicate.tar": tarBytes([{ name: "same.txt", content: "one" }, { name: "same.txt", content: "two" }]),
    "case-collision.tar": tarBytes([{ name: "Readme.md", content: "a" }, { name: "readme.md", content: "b" }]),
    "unicode-collision.tar": tarBytes([{ name: "caf\u00e9.md", content: "a" }, { name: "cafe\u0301.md", content: "b" }]),
    "bad-checksum.tar": tarBytes([{ name: "a.txt", content: "x", badChecksum: true }]),
    "truncated.tar": benignTar().subarray(0, 700),
    "empty.tar": Buffer.alloc(1024),
    "trailing-bytes.tar": Buffer.concat([benignTar(), Buffer.from("trailing garbage")]),
    "concatenated.tar": Buffer.concat([benignTar(), benignTar()]),
    "many-members.tar": tarBytes(Array.from({ length: 200 }, (_, i) => ({ name: `m/${i}.txt`, content: String(i) }))),
    "nested.tar": tarBytes([{ name: "inner.tar", content: benignTar() }]),
    "nested.tar.gz": gzipTar(tarBytes([{ name: "inner.tgz", content: gzipTar(benignTar()) }])),
  };
}
