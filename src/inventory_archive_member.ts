// inventory_archive_member.ts — one inventory orchestrator for ZIP/TAR member inject (ADR-049).
// Codecs do not call inventory. Observation expansion does not use this module.
import { constants as bufferConstants } from "node:buffer";
import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";
import { archiveExtensionOf } from "./archive_formats";
import { canonicalMemberPath, memberCollisionKey, pathSafetyHolds, preflightArchive } from "./archive_preflight";
import { replaceFileAtomically } from "./durable_write";
import { DEFAULT_LOCAL_ARCHIVE_POLICY, LocalArchivePolicy } from "./local_archive_policy";
import { peekTarRootMeta, readTarArchive, rootMetaKind as tarRootMetaKind } from "./tar_reader";
import { injectGzipTarRootMeta, injectTarRootMeta } from "./tar_writer";
import { injectZipRootMeta, peekZipRootMeta, rootMetaKind as zipRootMetaKind } from "./zip_writer";
import { readZipCentralDirectory } from "./zip_reader";

export type BoundedInflateResult =
  | { ok: true; bytes: Buffer }
  | { ok: false; hold: string };

const INFLATION_BUDGET_HOLD = "archive.inflation_budget_exceeded";

/**
 * zlib's own output ceiling for a budget. zlib stops inflating once the output
 * would exceed `maxOutputLength`, so a decompression bomb never materializes
 * past the budget. The value must lie in [1, buffer.constants.MAX_LENGTH].
 */
function gunzipOptions(budget: number): zlib.ZlibOptions {
  return { maxOutputLength: Math.max(1, Math.min(budget, bufferConstants.MAX_LENGTH)) };
}

function inflateVerdict(err: Error | null, inflated: Buffer | undefined, budget: number): BoundedInflateResult {
  if (err) {
    if ((err as NodeJS.ErrnoException).code === "ERR_BUFFER_TOO_LARGE") return { ok: false, hold: INFLATION_BUDGET_HOLD };
    return { ok: false, hold: `archive.gzip_unreadable:${err.message}` };
  }
  const bytes = inflated ?? Buffer.alloc(0);
  // Belt for a budget below zlib's minimum ceiling of one byte.
  if (bytes.length > budget) return { ok: false, hold: INFLATION_BUDGET_HOLD };
  return { ok: true, bytes };
}

/**
 * Bounded gzip inflation. Output above the policy's
 * maxTotalUncompressedBytesPerArchive is refused while inflating; output exactly
 * at the budget is accepted. Always settles.
 */
export function boundedGunzip(
  compressed: Buffer,
  policy: LocalArchivePolicy = DEFAULT_LOCAL_ARCHIVE_POLICY,
): Promise<BoundedInflateResult> {
  const budget = policy.maxTotalUncompressedBytesPerArchive;
  return new Promise((resolve) => {
    try {
      zlib.gunzip(compressed, gunzipOptions(budget), (err, inflated) => {
        resolve(inflateVerdict(err, inflated, budget));
      });
    } catch (err) {
      resolve(inflateVerdict(err as Error, undefined, budget));
    }
  });
}

/** Synchronous bounded gzip inflation; same verdicts as `boundedGunzip`. */
export function boundedGunzipSync(
  compressed: Buffer,
  policy: LocalArchivePolicy = DEFAULT_LOCAL_ARCHIVE_POLICY,
): BoundedInflateResult {
  const budget = policy.maxTotalUncompressedBytesPerArchive;
  try {
    return inflateVerdict(null, zlib.gunzipSync(compressed, gunzipOptions(budget)), budget);
  } catch (err) {
    return inflateVerdict(err as Error, undefined, budget);
  }
}

export type InventoryRewriteKind = "zip" | "tar" | "tar.gz";

const HOLD_EXTENSIONS = new Set([".jar", ".war", ".gz"]);

export function inventoryRewriteKind(fileName: string): InventoryRewriteKind | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) return "tar.gz";
  const ext = archiveExtensionOf(fileName);
  if (ext === ".zip") return "zip";
  if (ext === ".tar") return "tar";
  if (HOLD_EXTENSIONS.has(ext)) return null;
  return null;
}

export function peekArchiveRootMeta(abs: string): string | null {
  const kind = inventoryRewriteKind(path.basename(abs));
  if (kind === "zip") return peekZipRootMeta(abs);
  if (kind === "tar") {
    try {
      const peeked = peekTarRootMeta(fs.readFileSync(abs));
      return peeked ? peeked.toString("utf8") : null;
    } catch {
      return null;
    }
  }
  if (kind === "tar.gz") {
    try {
      const result = boundedGunzipSync(fs.readFileSync(abs));
      if (!result.ok) return null;
      const peeked = peekTarRootMeta(result.bytes);
      return peeked ? peeked.toString("utf8") : null;
    } catch {
      return null;
    }
  }
  return null;
}

function admitTarNames(names: string[]): string | null {
  for (const name of names) {
    const holds = pathSafetyHolds(name, DEFAULT_LOCAL_ARCHIVE_POLICY);
    if (holds.length) return holds[0]!.code;
    if (tarRootMetaKind(name) === null && (name.includes("/") && name.split("/").includes(".."))) {
      return "archive.path_traversal";
    }
  }
  const seen = new Set<string>();
  for (const name of names) {
    // The same identity ZIP preflight uses: canonical path under the collision fold.
    const key = memberCollisionKey(canonicalMemberPath(name));
    if (seen.has(key)) return "archive.duplicate_member";
    seen.add(key);
  }
  return null;
}

function admitZip(abs: string): string | null {
  try {
    const directory = readZipCentralDirectory(abs);
    const verdict = preflightArchive({
      directory,
      policy: DEFAULT_LOCAL_ARCHIVE_POLICY,
      depth: 0,
      archiveCompressedBytes: fs.statSync(abs).size,
    });
    if (!verdict.accepted) return verdict.holds[0]?.code ?? "archive.preflight_held";
    return null;
  } catch (err) {
    return `archive.format_unreadable:${(err as Error).message}`;
  }
}

function admitTarBytes(tar: Buffer): string | null {
  const read = readTarArchive(tar);
  if (!read.ok) return read.hold;
  return admitTarNames(read.members.map((m) => m.name));
}

export type ArchiveMemberResult =
  | { rewritten: true }
  | { rewritten: false; hold: string };

/**
 * Hold code for a filesystem failure while reading or replacing the archive
 * (RC-056). The errno code is the portable reason: the host message repeats the
 * absolute path, which would make the record depend on where the tree lives.
 */
function ioHold(err: unknown): string {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  return `archive.rewrite_io_failed:${typeof code === "string" && code.length > 0 ? code : "UNKNOWN_ERROR"}`;
}

type ArchiveRead = { ok: true; bytes: Buffer } | { ok: false; hold: string };

function readArchive(abs: string): ArchiveRead {
  try {
    return { ok: true, bytes: fs.readFileSync(abs) };
  } catch (err) {
    return { ok: false, hold: ioHold(err) };
  }
}

/**
 * Replace the archive, or report why it could not be replaced. The staging file
 * is removed by `replaceFileAtomically` on failure, so a held archive keeps its
 * bytes and no staging sibling is left behind.
 */
function replaceArchive(abs: string, bytes: Buffer): ArchiveMemberResult {
  try {
    replaceFileAtomically(abs, bytes);
    return { rewritten: true };
  } catch (err) {
    return { rewritten: false, hold: ioHold(err) };
  }
}

/**
 * Upsert the archive's root `.l9meta.yaml` member. Every outcome is a result:
 * admission holds, codec holds, and filesystem failures while reading or
 * replacing the archive (`archive.rewrite_io_failed:<errno>`) all return
 * `{ rewritten: false, hold }` so the caller records them on the archive's own
 * record and the inventory walk continues (RC-056).
 */
export function upsertArchiveRootMeta(abs: string, yaml: string): ArchiveMemberResult {
  const kind = inventoryRewriteKind(path.basename(abs));
  if (kind === null) {
    return { rewritten: false, hold: "archive.rewrite_not_admitted" };
  }

  if (kind === "zip") {
    const admit = admitZip(abs);
    if (admit) return { rewritten: false, hold: admit };
    const injected = injectZipRootMeta(abs, yaml);
    if (!injected.ok) return { rewritten: false, hold: injected.hold };
    return replaceArchive(abs, injected.bytes);
  }

  const read = readArchive(abs);
  if (!read.ok) return { rewritten: false, hold: read.hold };

  if (kind === "tar") {
    const admit = admitTarBytes(read.bytes);
    if (admit) return { rewritten: false, hold: admit };
    const injected = injectTarRootMeta(read.bytes, yaml);
    if (!injected.ok) return { rewritten: false, hold: injected.hold };
    return replaceArchive(abs, injected.bytes);
  }

  const inflateResult = boundedGunzipSync(read.bytes);
  if (!inflateResult.ok) {
    return { rewritten: false, hold: inflateResult.hold };
  }
  const tar = inflateResult.bytes;
  const admit = admitTarBytes(tar);
  if (admit) return { rewritten: false, hold: admit };
  const injected = injectGzipTarRootMeta(read.bytes, yaml);
  if (!injected.ok) return { rewritten: false, hold: injected.hold };
  return replaceArchive(abs, injected.bytes);
}

export function isCanonicalMetaMemberName(name: string): boolean {
  return zipRootMetaKind(name) === "canonical" || tarRootMetaKind(name) === "canonical";
}
