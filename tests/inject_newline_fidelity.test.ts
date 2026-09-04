// inject_newline_fidelity.test.ts — the injected block adopts the file's conventions.
//
// A CRLF source used to come back with an LF block on top of CRLF lines, and a
// file with a byte-order mark had the mark pushed into the middle of the file.
// Neither is what "body preserved verbatim" promises. The rules here: one newline
// convention per file, the BOM stays at byte 0, a shebang stays on line 1, and a
// second run recognizes and replaces the block rather than stacking another.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, test } from "vitest";
import { injectFile } from "../src/inject";
import { applyCommentInjection, detectNewlineConvention, extractInjectedYaml, yamlToBlock } from "../src/comment";
import { coerceNormalizedMeta } from "../src/schema";

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "l9-newline-"));
}

function meta(id: string) {
  return coerceNormalizedMeta({
    id, title: id, artifact_type: "source", mcp_primitive: "resource", callable: false,
    retrievable: true, injectable: true, namespace: "t", sharing_scope: "agnostic",
    source_path: `${id}.py`, content_hash: "Unknown", token_cost_estimate: 0,
    authority: "t", created_or_detected_at: "Unknown",
  });
}

function run(name: string, body: string, times = 1): string {
  const root = tmp();
  const target = path.join(root, name);
  fs.writeFileSync(target, body);
  for (let i = 0; i < times; i++) {
    injectFile(target, meta("t.a"), { dryRun: false, outDir: path.join(root, "out"), verbose: false, writeInjectLog: false });
  }
  return fs.readFileSync(target, "utf8");
}

function newlineCounts(text: string): { lf: number; crlf: number } {
  return { lf: (text.match(/(?<!\r)\n/g) ?? []).length, crlf: (text.match(/\r\n/g) ?? []).length };
}

describe("comment injection — newline convention", () => {
  test("a CRLF file keeps a single convention after injection", () => {
    const out = run("crlf.py", "print('a')\r\nprint('b')\r\n");
    expect(newlineCounts(out).lf).toBe(0);
    expect(out.endsWith("print('b')\r\n")).toBe(true);
    expect(out.startsWith("# >>> l9:meta >>>\r\n")).toBe(true);
  });

  test("an LF file stays LF", () => {
    const out = run("lf.py", "print('a')\nprint('b')\n");
    expect(newlineCounts(out).crlf).toBe(0);
  });

  test("a file without a terminal newline does not gain one", () => {
    const out = run("nonl.py", "x = 1");
    expect(out.endsWith("x = 1")).toBe(true);
  });

  test("a CRLF file with a shebang keeps the shebang on line 1 and the convention throughout", () => {
    const out = run("sh.py", "#!/usr/bin/env python\r\nprint('x')\r\n");
    expect(out.startsWith("#!/usr/bin/env python\r\n# >>> l9:meta >>>\r\n")).toBe(true);
    expect(newlineCounts(out).lf).toBe(0);
  });

  test("a second run replaces the block instead of stacking one, on CRLF too", () => {
    const once = run("idem.py", "print('a')\r\n", 1);
    const twice = run("idem.py", "print('a')\r\n", 2);
    expect(twice).toBe(once);
    expect(twice.match(/>>> l9:meta >>>/g)).toHaveLength(1);
  });

  test("the existing block's values are read back without a stray carriage return", () => {
    const out = run("read.py", "print('a')\r\n");
    const yaml = extractInjectedYaml(out, { strategy: "line-comment", linePrefix: "#" });
    expect(yaml).not.toContain("\r");
    expect(yaml).toContain("id: ");
  });
});

describe("comment injection — byte-order mark", () => {
  test("a BOM stays at byte 0 and the block follows it", () => {
    const out = run("bom.py", "﻿print('bom')\n");
    expect(out.startsWith("﻿# >>> l9:meta >>>\n")).toBe(true);
    expect(out.slice(1)).not.toContain("﻿");
    expect(out.endsWith("print('bom')\n")).toBe(true);
  });

  test("a BOM before a shebang keeps both in order", () => {
    const out = applyCommentInjection("﻿#!/bin/sh\necho\n", "# block", "\n");
    expect(out).toBe("﻿#!/bin/sh\n# block\necho\n");
  });
});

describe("comment helpers", () => {
  test("detectNewlineConvention reads the first line ending", () => {
    expect(detectNewlineConvention("a\r\nb\n")).toBe("\r\n");
    expect(detectNewlineConvention("a\nb\r\n")).toBe("\n");
    expect(detectNewlineConvention("no newline")).toBe("\n");
  });

  test("yamlToBlock joins with the requested convention and accepts either on input", () => {
    const block = yamlToBlock("a: 1\r\nb: 2", { strategy: "line-comment", linePrefix: "#" }, "\r\n");
    expect(block).toBe("# >>> l9:meta >>>\r\n# a: 1\r\n# b: 2\r\n# <<< l9:meta <<<");
  });
});
