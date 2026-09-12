// tar_writer.ts — inventory-only TAR rewrite: upsert root .l9meta.yaml (ADR-049).
import * as zlib from "node:zlib";
import { encodeTarEntry, encodeTarArchive } from "./tar_format";
import { readTarArchive, rootMetaKind, TarMember } from "./tar_reader";

export function injectTarRootMeta(tarBytes: Buffer, yaml: string): { ok: true; bytes: Buffer } | { ok: false; hold: string } {
  const read = readTarArchive(tarBytes);
  if (!read.ok) return read;
  const kept: Buffer[] = [];
  for (const member of read.members) {
    if (rootMetaKind(member.name) !== null) continue;
    kept.push(member.rawRecord);
  }
  const meta = encodeTarEntry({ name: ".l9meta.yaml", content: yaml, mode: 0o644, type: "0" });
  const out = Buffer.concat([...kept, meta, Buffer.alloc(1024)]);
  return { ok: true, bytes: out };
}

export function injectGzipTarRootMeta(gzBytes: Buffer, yaml: string): { ok: true; bytes: Buffer } | { ok: false; hold: string } {
  let tar: Buffer;
  try {
    tar = zlib.gunzipSync(gzBytes);
  } catch (err) {
    return { ok: false, hold: `archive.gzip_unreadable:${(err as Error).message}` };
  }
  const injected = injectTarRootMeta(tar, yaml);
  if (!injected.ok) return injected;
  return { ok: true, bytes: zlib.gzipSync(injected.bytes) };
}

export function buildTarArchive(members: Array<{ name: string; content: string | Buffer }>): Buffer {
  return encodeTarArchive(members.map((m) => ({ name: m.name, content: m.content })));
}

export function keptMembers(members: TarMember[]): TarMember[] {
  return members.filter((m) => rootMetaKind(m.name) === null);
}
