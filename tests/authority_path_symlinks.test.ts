/**
 * WU-026 (RC-031): the authority document is read only through real, in-tree path
 * components. A symlinked `.l9`, a symlinked or dangling leaf, and a non-directory
 * intermediate are configuration errors; only a genuinely absent document is missing.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  META_AUTHORITY_RELATIVE_PATH,
  assertHeaderIdentity,
  loadRepositoryAuthority,
  resolveHeaderIdentity,
} from "../src/authority";
import { inspectRepositoryAuthority } from "../src/authority_scan";
import { inventoryTree } from "../src/inventory";
import { runPipelineAsync } from "../src/pipeline";

const AUTHORITY = `schema: l9.meta-authority/v1
writer:
  repository: Quantum-L9/l9-meta-injector
  ref: v4.0.0
default_carrier: central_manifest
legacy_writers: forbidden
inline_allow:
  - "**/*.md"
`;

const made: string[] = [];
function tempDir(prefix = "l9-authority-symlink-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  made.push(dir);
  return dir;
}
afterEach(() => { for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

function write(root: string, relative: string, content: string): void {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
}

const codes = (result: { conflicts: Array<{ code: string }> }) => result.conflicts.map((item) => item.code);

function danglingAuthority(): string {
  const root = tempDir();
  fs.mkdirSync(path.join(root, ".l9"));
  fs.symlinkSync(path.join(root, "does-not-exist.yaml"), path.join(root, META_AUTHORITY_RELATIVE_PATH));
  return root;
}

describe("RC-031: authority path components", () => {
  test("REG-WU-026-RC-031-a: a .l9 symlink to an out-of-tree authority is refused", () => {
    const root = tempDir();
    const outside = tempDir("l9-authority-outside-");
    write(outside, "meta-authority.yaml", AUTHORITY);
    fs.symlinkSync(outside, path.join(root, ".l9"), "dir");
    const loaded = loadRepositoryAuthority(root);
    expect(codes(loaded)).toEqual(["META_AUTHORITY_CONFIG_INVALID"]);
    expect(loaded.conflicts[0].message).toContain("symbolic link");
    expect(loaded.conflicts[0].message).toContain(".l9");
    expect(loaded.authority).toBeUndefined();
    const inspection = inspectRepositoryAuthority(root);
    expect(inspection.authorityResolved).toBe(false);
    expect(inspection.conflicts.some((item) => item.code === "META_AUTHORITY_CONFIG_INVALID")).toBe(true);
  });

  test("REG-WU-026-RC-031-b: a .l9 symlink to a directory inside the root is refused", () => {
    const root = tempDir();
    write(root, "real-l9/meta-authority.yaml", AUTHORITY);
    fs.symlinkSync(path.join(root, "real-l9"), path.join(root, ".l9"), "dir");
    const loaded = loadRepositoryAuthority(root);
    expect(codes(loaded)).toEqual(["META_AUTHORITY_CONFIG_INVALID"]);
    expect(loaded.authority).toBeUndefined();
  });

  test("REG-WU-026-RC-031-c: a dangling authority link is invalid, not missing, and blocks header identity", () => {
    const root = danglingAuthority();
    const loaded = loadRepositoryAuthority(root);
    expect(codes(loaded)).toEqual(["META_AUTHORITY_CONFIG_INVALID"]);
    const identity = resolveHeaderIdentity(root, { authority: "Some/Owner", namespace: "ns" });
    expect(codes(identity)).toEqual(["META_AUTHORITY_CONFIG_INVALID"]);
    expect(() => assertHeaderIdentity(identity)).toThrow("META_AUTHORITY_CONFIG_INVALID");
  });

  test("REG-WU-026-RC-031-d: a .l9 that is a regular file is invalid", () => {
    const root = tempDir();
    write(root, ".l9", "not a directory\n");
    const loaded = loadRepositoryAuthority(root);
    expect(codes(loaded)).toEqual(["META_AUTHORITY_CONFIG_INVALID"]);
    expect(loaded.conflicts[0].message).toContain("not a directory");
  });

  test("REG-WU-026-RC-031-e: no .l9 at all is still missing", () => {
    const root = tempDir();
    expect(codes(loadRepositoryAuthority(root))).toEqual(["META_AUTHORITY_FILE_MISSING"]);
    fs.mkdirSync(path.join(root, ".l9"));
    expect(codes(loadRepositoryAuthority(root))).toEqual(["META_AUTHORITY_FILE_MISSING"]);
  });

  test("REG-WU-026-RC-031-f: a regular authority file loads as before, also under a symlinked root", () => {
    const root = tempDir();
    write(root, META_AUTHORITY_RELATIVE_PATH, AUTHORITY);
    const loaded = loadRepositoryAuthority(root);
    expect(loaded.conflicts).toEqual([]);
    expect(loaded.authority?.writer.repository).toBe("Quantum-L9/l9-meta-injector");
    // The repository root itself may be reached through a link (e.g. macOS /tmp).
    const linkedRoot = path.join(tempDir("l9-authority-rootlink-"), "root");
    fs.symlinkSync(root, linkedRoot, "dir");
    expect(loadRepositoryAuthority(linkedRoot).conflicts).toEqual([]);
  });

  test("REG-WU-026-RC-031-g: pipeline and inventory refuse to stamp through a dangling authority link", async () => {
    const root = danglingAuthority();
    write(root, "notes.md", "# Notes\n\nbody\n");
    await expect(runPipelineAsync({
      root,
      glob: "**/*.md",
      dryRun: true,
      outDir: path.join(root, ".out"),
      indexDir: path.join(root, ".out"),
      nearDupThreshold: 0.9,
      hashPrefixLength: 16,
      verbose: false,
      llmEnabled: false,
      normalizeFilenames: false,
      authority: "Some/Owner",
      namespace: "ns",
    })).rejects.toThrow("META_AUTHORITY_CONFIG_INVALID");
    expect(() => inventoryTree({ root, outDir: path.join(root, ".l9inventory"), dryRun: true })).toThrow("META_AUTHORITY_CONFIG_INVALID");
  });
});
