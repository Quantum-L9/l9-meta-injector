// inventory_darwin_search.ts — derived Finder Comment + Tags projection (ADR-049).
// Not an L9 source of truth. Inventory-only. Fail-soft off Darwin.
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export const L9_COMMENT_PREFIX = "L9:";
const COMMENT_MAX = 200;
const FINDER_COMMENT = "com.apple.metadata:kMDItemFinderComment";
const USER_TAGS = "com.apple.metadata:_kMDItemUserTags";

export interface DarwinSearchInput {
  fileName: string;
  kind: string;
  harvestedTitle?: string | null;
  harvestedTags?: string[];
}

const VERSION_IN_NAME = /(?:^|[._-])(v?\d+\.\d+(?:\.\d+)?)/i;

export function versionTokenFromFileName(fileName: string): string | null {
  const match = fileName.match(VERSION_IN_NAME);
  return match?.[1] ?? null;
}

export function buildFinderComment(input: DarwinSearchInput): string {
  const stem = input.fileName.replace(/\.(tar\.gz|tgz|zip|tar)$/i, "");
  const parts = [stem, input.kind, "archive"];
  const title = input.harvestedTitle?.trim();
  if (title && title !== stem && title !== input.fileName) parts.push(title);
  const line = `${L9_COMMENT_PREFIX} ${parts.filter(Boolean).join(" · ")}`;
  return line.length <= COMMENT_MAX ? line : line.slice(0, COMMENT_MAX);
}

export function buildFinderTags(input: DarwinSearchInput): string[] {
  const tags = new Set<string>(["l9", "archive", input.kind]);
  for (const tag of input.harvestedTags ?? []) {
    const clean = String(tag).trim();
    if (clean && clean.length <= 40 && !/^[0-9a-f]{16,}$/i.test(clean)) tags.add(clean);
  }
  const version = versionTokenFromFileName(input.fileName);
  if (version) tags.add(version);
  return [...tags];
}

export function isInventoryFinderComment(value: string | null): boolean {
  if (value === null || value.trim() === "") return true;
  return value.trimStart().startsWith(L9_COMMENT_PREFIX);
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function stringPlistXml(value: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><string>${escapeXml(value)}</string></plist>\n`;
}

function tagsPlistXml(tags: string[]): string {
  const items = tags.map((tag) => `  <string>${escapeXml(`${tag}\n0`)}</string>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<array>\n${items}\n</array>\n</plist>\n`;
}

function toBinaryPlist(xml: string): Buffer {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "l9-plist-"));
  const file = path.join(dir, "x.plist");
  try {
    fs.writeFileSync(file, xml, "utf8");
    execFileSync("plutil", ["-convert", "binary1", file], { stdio: "pipe" });
    return fs.readFileSync(file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function readXattrHex(abs: string, key: string): Buffer | null {
  try {
    const hex = execFileSync("xattr", ["-px", key, abs], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    if (!hex) return null;
    return Buffer.from(hex.replace(/\s+/g, ""), "hex");
  } catch {
    return null;
  }
}

function writeXattrHex(abs: string, key: string, bytes: Buffer): void {
  execFileSync("xattr", ["-wx", key, bytes.toString("hex"), abs], { stdio: "pipe" });
}

function plistStringFromBinary(bytes: Buffer): string | null {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "l9-plist-"));
  const file = path.join(dir, "x.plist");
  try {
    fs.writeFileSync(file, bytes);
    execFileSync("plutil", ["-convert", "xml1", file], { stdio: "pipe" });
    const xml = fs.readFileSync(file, "utf8");
    const match = xml.match(/<string>([\s\S]*?)<\/string>/);
    return match ? match[1]!.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&") : null;
  } catch {
    return null;
  }
}

function existingComment(abs: string): string | null {
  const bytes = readXattrHex(abs, FINDER_COMMENT);
  if (!bytes) return null;
  return plistStringFromBinary(bytes);
}

function existingTags(abs: string): string[] {
  const bytes = readXattrHex(abs, USER_TAGS);
  if (!bytes) return [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "l9-plist-"));
  const file = path.join(dir, "x.plist");
  try {
    fs.writeFileSync(file, bytes);
    execFileSync("plutil", ["-convert", "xml1", file], { stdio: "pipe" });
    const xml = fs.readFileSync(file, "utf8");
    return [...xml.matchAll(/<string>([\s\S]*?)<\/string>/g)].map((m) => m[1]!.split("\n")[0]!).filter(Boolean);
  } catch {
    return [];
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export interface HarvestedDarwinSearch {
  comment: string | null;
  tags: string[];
}

/** Read current Finder Comment/Tags before any rewrite that replaces the inode. */
export function harvestDarwinSearch(abs: string): HarvestedDarwinSearch {
  if (process.platform !== "darwin") return { comment: null, tags: [] };
  return { comment: existingComment(abs), tags: existingTags(abs) };
}

export function projectDarwinSearch(
  abs: string,
  input: DarwinSearchInput,
  prior: HarvestedDarwinSearch = harvestDarwinSearch(abs),
): string | null {
  if (process.platform !== "darwin") return null;
  try {
    const comment = buildFinderComment(input);
    if (isInventoryFinderComment(prior.comment)) {
      writeXattrHex(abs, FINDER_COMMENT, toBinaryPlist(stringPlistXml(comment)));
    } else if (prior.comment) {
      writeXattrHex(abs, FINDER_COMMENT, toBinaryPlist(stringPlistXml(prior.comment)));
    }
    const merged = [...new Set([...prior.tags, ...buildFinderTags(input)])];
    writeXattrHex(abs, USER_TAGS, toBinaryPlist(tagsPlistXml(merged)));
    return null;
  } catch (err) {
    return `darwin_search_write_failed:${(err as Error).message}`;
  }
}
