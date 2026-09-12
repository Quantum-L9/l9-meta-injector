// inventory_archive_member.ts — one inventory orchestrator for ZIP/TAR member inject (ADR-049).
// Codecs do not call inventory. Observation expansion does not use this module.
import * as fs from "node:fs";
import * as path from "node:path";
import { Transform, pipeline } from "node:stream";
import { promisify } from "node:util";
import * as zlib from "node:zlib";
import { archiveExtensionOf } from "./archive_formats";
import { pathSafetyHolds, preflightArchive } from "./archive_preflight";
import { replaceFileAtomically } from "./durable_write";
import { DEFAULT_LOCAL_ARCHIVE_POLICY, LocalArchivePolicy } from "./local_archive_policy";
import { peekTarRootMeta, readTarArchive, rootMetaKind as tarRootMetaKind } from "./tar_reader";
import { injectGzipTarRootMeta, injectTarRootMeta } from "./tar_writer";
import { injectZipRootMeta, peekZipRootMeta, rootMetaKind as zipRootMetaKind } from "./zip_writer";
import { readZipCentralDirectory } from "./zip_reader";

const pipelineAsync = promisify(pipeline);

export type BoundedInflateResult =
  | { ok: true; bytes: Buffer }
  | { ok: false; hold: string };

/**
 * Streaming gzip inflation with budget enforcement.
 *
 * Returns the inflated buffer if it fits within the policy's maxTotalUncompressedBytesPerArchive.
 * Aborts and returns a hold if the budget would be exceeded, preventing decompression bombs.
 */
export async function boundedGunzip(
  compressed: Buffer,
  policy: LocalArchivePolicy = DEFAULT_LOCAL_ARCHIVE_POLICY,
): Promise<BoundedInflateResult> {
  const budget = policy.maxTotalUncompressedBytesPerArchive;
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  let budgetExceeded = false;

  const budgetEnforcer = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      if (budgetExceeded) {
        callback();
        return;
      }
      totalBytes += chunk.length;
      if (totalBytes > budget) {
        budgetExceeded = true;
        callback(new Error("archive.inflation_budget_exceeded"));
        return;
      }
      chunks.push(chunk);
      callback(null, chunk);
    },
  });

  const gunzip = zlib.createGunzip();

  try {
    await pipelineAsync(
      (async function* () { yield compressed; })(),
      gunzip,
      budgetEnforcer,
    );
    return { ok: true, bytes: Buffer.concat(chunks) };
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === "archive.inflation_budget_exceeded" || budgetExceeded) {
      return { ok: false, hold: "archive.inflation_budget_exceeded" };
    }
    return { ok: false, hold: `archive.gzip_unreadable:${msg}` };
  }
}

/**
 * Synchronous wrapper for bounded gzip inflation.
 * Uses a post-inflation check since zlib.gunzipSync must complete before we know the size.
 */
export function boundedGunzipSync(
  compressed: Buffer,
  policy: LocalArchivePolicy = DEFAULT_LOCAL_ARCHIVE_POLICY,
): BoundedInflateResult {
  const budget = policy.maxTotalUncompressedBytesPerArchive;

  try {
    const inflated = zlib.gunzipSync(compressed);
    if (inflated.length > budget) {
      return { ok: false, hold: "archive.inflation_budget_exceeded" };
    }
    return { ok: true, bytes: inflated };
  } catch (err) {
    return { ok: false, hold: `archive.gzip_unreadable:${(err as Error).message}` };
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
    const key = name.replace(/\\/g, "/").replace(/^\.\//, "").normalize("NFC").toLowerCase();
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
    replaceFileAtomically(abs, injected.bytes);
    return { rewritten: true };
  }

  if (kind === "tar") {
    const bytes = fs.readFileSync(abs);
    const admit = admitTarBytes(bytes);
    if (admit) return { rewritten: false, hold: admit };
    const injected = injectTarRootMeta(bytes, yaml);
    if (!injected.ok) return { rewritten: false, hold: injected.hold };
    replaceFileAtomically(abs, injected.bytes);
    return { rewritten: true };
  }

  const inflateResult = boundedGunzipSync(fs.readFileSync(abs));
  if (!inflateResult.ok) {
    return { rewritten: false, hold: inflateResult.hold };
  }
  const tar = inflateResult.bytes;
  const admit = admitTarBytes(tar);
  if (admit) return { rewritten: false, hold: admit };
  const injected = injectGzipTarRootMeta(fs.readFileSync(abs), yaml);
  if (!injected.ok) return { rewritten: false, hold: injected.hold };
  replaceFileAtomically(abs, injected.bytes);
  return { rewritten: true };
}

export function isCanonicalMetaMemberName(name: string): boolean {
  return zipRootMetaKind(name) === "canonical" || tarRootMetaKind(name) === "canonical";
}
