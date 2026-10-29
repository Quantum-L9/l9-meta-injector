// inventory_darwin_search.test.ts — WU-079: the derived Finder Comment/Tags
// projection (ADR-049 item 5) is idempotent and leaks no temp directory.
//
// Simulated Darwin: process.platform is overridden and /usr/bin/xattr and
// /usr/bin/plutil are replaced by an in-memory xattr store whose plutil "binary1"
// and "xml1" conversions leave the XML exactly as written. What real `plutil`
// escapes, and `xattr -px` wrapping, can only be verified on macOS; the real-host
// case lives in tests/inventory_drive_meta.test.ts behind a darwin-only gate.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const xattrs = new Map<string, Map<string, Buffer>>();
const failures = { plutilXml1: false };

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn((command: string, args: string[]) => {
    if (command === "/usr/bin/xattr") {
      const [flag, key, a, b] = args;
      if (flag === "-px") {
        const stored = xattrs.get(a as string)?.get(key as string);
        if (!stored) throw new Error(`xattr: ${a}: No such xattr: ${key}`);
        return `${stored.toString("hex")}\n`;
      }
      if (flag === "-wx") {
        const abs = b as string;
        if (!xattrs.has(abs)) xattrs.set(abs, new Map());
        xattrs.get(abs)?.set(key as string, Buffer.from(a as string, "hex"));
        return "";
      }
    }
    if (command === "/usr/bin/plutil") {
      if (args[1] === "xml1" && failures.plutilXml1) throw new Error("plutil: simulated failure");
      return "";
    }
    throw new Error(`unexpected command ${command}`);
  }),
}));

// Imported after the mock is registered (vi.mock is hoisted).
import { harvestDarwinSearch, projectDarwinSearch } from "../src/inventory_darwin_search";

const FINDER_COMMENT = "com.apple.metadata:kMDItemFinderComment";
const USER_TAGS = "com.apple.metadata:_kMDItemUserTags";
const PLIST_HEAD = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n`;

function seedTags(abs: string, escapedTags: string[]): void {
  const items = escapedTags.map((t) => `  <string>${t}\n0</string>`).join("\n");
  const xml = `${PLIST_HEAD}<plist version="1.0">\n<array>\n${items}\n</array>\n</plist>\n`;
  if (!xattrs.has(abs)) xattrs.set(abs, new Map());
  xattrs.get(abs)?.set(USER_TAGS, Buffer.from(xml, "utf8"));
}

function seedComment(abs: string, escapedComment: string): void {
  const xml = `${PLIST_HEAD}<plist version="1.0"><string>${escapedComment}</string></plist>\n`;
  if (!xattrs.has(abs)) xattrs.set(abs, new Map());
  xattrs.get(abs)?.set(FINDER_COMMENT, Buffer.from(xml, "utf8"));
}

function plistEntries(dir: string): string[] {
  return fs.readdirSync(dir).filter((name) => name.startsWith("l9-plist-"));
}

const INPUT = { fileName: "pack.zip", kind: "zip" };
const platform = Object.getOwnPropertyDescriptor(process, "platform") as PropertyDescriptor;
const savedTmpdir = process.env.TMPDIR;
let tmpRoot = "";

beforeEach(() => {
  xattrs.clear();
  failures.plutilXml1 = false;
  // A private TMPDIR: os.tmpdir() reads it on every call, so l9-plist-* counts are
  // not disturbed by concurrent test runs sharing the system temp directory.
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "l9-darwin-sim-"));
  process.env.TMPDIR = tmpRoot;
  Object.defineProperty(process, "platform", { ...platform, value: "darwin" });
});

afterEach(() => {
  Object.defineProperty(process, "platform", platform);
  if (savedTmpdir === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = savedTmpdir;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("WU-079 RC-057 Finder tags are decoded exactly once", () => {
  test("REG-WU-079-RC-057-RC057-a: projecting twice leaves the tag xattr byte-identical", () => {
    const abs = path.join(tmpRoot, "pack.zip");
    seedTags(abs, ["R&amp;D", "&lt;x&gt;"]);
    expect(harvestDarwinSearch(abs).tags).toEqual(["R&D", "<x>"]);
    expect(projectDarwinSearch(abs, INPUT)).toBeNull();
    const first = Buffer.from(xattrs.get(abs)?.get(USER_TAGS) ?? Buffer.alloc(0));
    expect(projectDarwinSearch(abs, INPUT)).toBeNull();
    const second = xattrs.get(abs)?.get(USER_TAGS) ?? Buffer.alloc(0);
    expect(second.equals(first)).toBe(true);
    expect(first.toString("utf8")).not.toContain("&amp;amp;");
    expect(harvestDarwinSearch(abs).tags).toEqual(expect.arrayContaining(["R&D", "<x>", "l9", "archive", "zip"]));
  });

  test("REG-WU-079-RC-057-RC057-b: a human Finder comment with entities is preserved across projections", () => {
    const abs = path.join(tmpRoot, "human.zip");
    seedComment(abs, "Q&amp;A");
    expect(harvestDarwinSearch(abs).comment).toBe("Q&A");
    expect(projectDarwinSearch(abs, INPUT)).toBeNull();
    const first = Buffer.from(xattrs.get(abs)?.get(FINDER_COMMENT) ?? Buffer.alloc(0));
    expect(projectDarwinSearch(abs, INPUT)).toBeNull();
    expect((xattrs.get(abs)?.get(FINDER_COMMENT) ?? Buffer.alloc(0)).equals(first)).toBe(true);
    expect(harvestDarwinSearch(abs).comment).toBe("Q&A");
  });
});

describe("WU-079 RC-059 plist reads remove their temp directory", () => {
  test("REG-WU-079-RC-059-RC059-a: repeated comment harvests leave no l9-plist-* directory", () => {
    const abs = path.join(tmpRoot, "human.zip");
    seedComment(abs, "keep this note");
    const before = plistEntries(tmpRoot).length;
    for (let i = 0; i < 3; i++) expect(harvestDarwinSearch(abs).comment).toBe("keep this note");
    expect(plistEntries(tmpRoot)).toHaveLength(before);
  });

  test("REG-WU-079-RC-059-RC059-b: a plutil failure yields no comment and no leaked directory", () => {
    const abs = path.join(tmpRoot, "human.zip");
    seedComment(abs, "keep this note");
    failures.plutilXml1 = true;
    const before = plistEntries(tmpRoot).length;
    expect(harvestDarwinSearch(abs).comment).toBeNull();
    expect(plistEntries(tmpRoot)).toHaveLength(before);
  });
});
