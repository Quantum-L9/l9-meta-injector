// local_source_scratch_parent.test.ts — the scratch parent that is checked against
// the source is the one that is written to (RC-048).
//
// `os.tmpdir()` reads TMPDIR on every call, so pointing TMPDIR into the source
// makes the default scratch location an in-source one; the empty-string parent
// must then be refused exactly as an undefined one is.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { acquireLocalSource, assertScratchOutsideSource } from "../src/local_source";
import { treeSnapshot } from "./helpers/zip_fixtures";

const roots: string[] = [];
const savedTmpdir = process.env.TMPDIR;

function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "l9-scratch-parent-"));
  roots.push(dir);
  return dir;
}

afterEach(() => {
  if (savedTmpdir === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = savedTmpdir;
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const posixOnly = process.platform === "win32" ? test.skip : test;

describe("one scratch-parent rule (RC-048)", () => {
  posixOnly("REG-WU-037-RC-048-a: an empty scratch parent whose default lies inside the source is refused", () => {
    const src = tmp();
    fs.writeFileSync(path.join(src, "a.md"), "# A\n");
    fs.mkdirSync(path.join(src, "tmp"));
    const before = treeSnapshot(src);
    process.env.TMPDIR = path.join(src, "tmp");
    try {
      expect(os.tmpdir()).toBe(path.join(src, "tmp"));
      expect(() => acquireLocalSource({ path: src, scratchParent: "" }))
        .toThrow(/resolves inside the observed source/);
    } finally {
      process.env.TMPDIR = savedTmpdir;
      if (savedTmpdir === undefined) delete process.env.TMPDIR;
    }
    expect(treeSnapshot(src)).toEqual(before);
  });

  posixOnly("REG-WU-037-RC-048-b: an empty scratch parent with an outside default uses os.tmpdir()", () => {
    const src = tmp();
    fs.writeFileSync(path.join(src, "a.md"), "# A\n");
    const outside = tmp();
    process.env.TMPDIR = outside;
    const observation = acquireLocalSource({ path: src, scratchParent: "" });
    try {
      expect(path.dirname(observation.scratchRoot)).toBe(outside);
    } finally {
      observation.dispose();
    }
  });

  test("REG-WU-037-RC-048-c: an explicit scratch parent inside the source is still refused before any write", () => {
    const src = tmp();
    fs.writeFileSync(path.join(src, "a.md"), "# A\n");
    const before = treeSnapshot(src);
    expect(() => acquireLocalSource({ path: src, scratchParent: path.join(src, ".scratch") }))
      .toThrow(/resolves inside the observed source/);
    expect(treeSnapshot(src)).toEqual(before);
  });
});

describe("a file source directly under the filesystem root (RC-058)", () => {
  // The boundary of a file source is the directory that holds it. For a file
  // directly under the root that boundary is the root itself, and a
  // `boundary + path.sep` prefix check would build `//` (or `C:\\`), a prefix no
  // path has — refusing nothing. The source file need not exist: its boundary
  // resolves from the nearest existing ancestor, which is the root.
  const root = path.parse(os.tmpdir()).root;
  const rootFileSource = path.join(root, `l9-audit-f14-absent-${process.pid}.md`);

  test("REG-AUDIT-F14-a: the boundary of a root-level file source is the root", () => {
    expect(fs.existsSync(rootFileSource)).toBe(false);
    expect(path.dirname(rootFileSource)).toBe(root);
  });

  test("REG-AUDIT-F14-b: every scratch parent is refused when the boundary resolves to the root", () => {
    const parents = [
      tmp(),
      os.tmpdir(),
      root,
      path.join(root, `l9-audit-f14-missing-${process.pid}`, "scratch"),
    ];
    for (const parent of parents) {
      expect(() => assertScratchOutsideSource(parent, rootFileSource, "file"), parent)
        .toThrow(/resolves inside the observed source/);
    }
  });
});
