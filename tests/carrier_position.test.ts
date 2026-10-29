// carrier_position.test.ts — WU-001 (ADR-057): one carrier-position rule shared by
// inject, detect and strip.
//
// The comment carrier sits at the first byte after every mandatory prologue (BOM,
// shebang, encoding cookie, XML declaration, bare `<?php` line, `@charset` line,
// Dockerfile parser directives). Where a language has no inert position the file
// rides in a sidecar. Detection and strip look for the managed block only at that
// position (plus the legacy byte-0 position written before the prologue fix), so
// sentinel text anywhere else is body and is preserved byte-for-byte.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, test } from "vitest";
import { injectFile } from "../src/inject";
import { verify } from "../src/verify";
import { runPipelineAsync } from "../src/pipeline";
import { contentHash } from "../src/extract";
import { coerceNormalizedMeta } from "../src/schema";
import type { PipelineConfig } from "../src/schema";
import { resolveCarrierDecision } from "../src/mutation_policy";
import type { AuthorityConfig } from "../src/operation_contracts";
import {
  applyCommentInjection, extractInjectedYaml, hasInjectedBlock, resolveStrategy,
  sidecarPathFor, stripInjectedBlock, yamlToBlock,
} from "../src/comment";
import type { StrategySpec } from "../src/comment";

const tmpDirs: string[] = [];

function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "l9-carrier-pos-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function meta(id: string, title = id) {
  return coerceNormalizedMeta({
    id, title, artifact_type: "source", mcp_primitive: "resource", callable: false,
    retrievable: true, injectable: true, namespace: "t", sharing_scope: "agnostic",
    source_path: id, content_hash: "Unknown", token_cost_estimate: 0,
    authority: "t", created_or_detected_at: "Unknown",
  });
}

const OPTS = (root: string) => ({ dryRun: false, outDir: path.join(root, "out"), verbose: false, writeInjectLog: false });

/** Write `body` to `<root>/<name>` and inject once; returns the file, its record and new bytes. */
function injectOnce(name: string, body: string, root = tmp(), title?: string) {
  const file = path.join(root, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, body);
  const rec = injectFile(file, meta(name, title), OPTS(root));
  return { root, file, rec, out: fs.readFileSync(file, "utf8") };
}

function specOf(name: string, content: string): StrategySpec {
  return resolveStrategy(name, content);
}

function has(tool: string, args: string[]): boolean {
  return spawnSync(tool, args, { stdio: "ignore" }).status === 0;
}
const HAS_XMLLINT = has("xmllint", ["--version"]);
const HAS_PHP = has("php", ["-v"]);
const HAS_PYTHON = has("python3", ["--version"]);

function headCount(text: string, sentinel: string): number {
  return text.split(sentinel).length - 1;
}

describe("WU-001 RC-001 — carrier position after mandatory prologues", () => {
  test("REG-WU-001-RC-001-a: an XML declaration stays at byte 0 and the block follows it", () => {
    const body = '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg"/>\n';
    const { file, rec, out } = injectOnce("icon.svg", body);
    expect(out.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<!-- l9:meta:start\n')).toBe(true);
    expect(stripInjectedBlock(out, specOf(file, out))).toBe(body);
    expect(rec.bodyPreserved).toBe(true);
    expect(verify(file, rec.originalBodyHash, rec.meta).issues).toEqual([]);
    if (HAS_XMLLINT) expect(spawnSync("xmllint", ["--noout", file]).status).toBe(0);
  });

  test("REG-WU-001-RC-001-b: a bare <?php line stays first and the block follows it", () => {
    const body = '<?php\ndeclare(strict_types=1);\necho "hi";\n';
    const { file, rec, out } = injectOnce("index.php", body);
    expect(out.startsWith("<?php\n// >>> l9:meta >>>")).toBe(true);
    expect(stripInjectedBlock(out, specOf(file, out))).toBe(body);
    expect(rec.bodyPreserved).toBe(true);
    if (HAS_PHP) {
      const ran = spawnSync("php", [file], { encoding: "utf8" });
      expect(ran.status).toBe(0);
      expect(ran.stdout).toBe("hi");
    }
  });

  test("REG-WU-001-RC-001-c: a PHP template without a leading bare open tag uses a sidecar", () => {
    const body = "<html><?php echo 1; ?></html>\n";
    expect(resolveStrategy("tpl.php", body).strategy).toBe("sidecar");
    const { file, out } = injectOnce("tpl.php", body);
    expect(out).toBe(body);
    expect(fs.existsSync(sidecarPathFor(file))).toBe(true);
  });

  test("REG-WU-001-RC-001-d: a Python encoding cookie keeps its line and the block follows it", () => {
    const cookie = "# -*- coding: latin-1 -*-\nx = 1\n";
    const one = injectOnce("mod.py", cookie);
    const lines = one.out.split("\n");
    expect(lines[0]).toBe("# -*- coding: latin-1 -*-");
    expect(lines[1]).toBe("# >>> l9:meta >>>");
    expect(stripInjectedBlock(one.out, specOf(one.file, one.out))).toBe(cookie);

    const shebang = "#!/usr/bin/env python\n# coding: latin-1\nx = 1\n";
    const two = injectOnce("sh.py", shebang);
    const lines2 = two.out.split("\n");
    expect(lines2[0]).toBe("#!/usr/bin/env python");
    expect(lines2[1]).toBe("# coding: latin-1");
    expect(lines2[2]).toBe("# >>> l9:meta >>>");
    expect(stripInjectedBlock(two.out, specOf(two.file, two.out))).toBe(shebang);

    const ruby = injectOnce("lib.rb", "# encoding: utf-8\nputs 1\n");
    expect(ruby.out.split("\n").slice(0, 2)).toEqual(["# encoding: utf-8", "# >>> l9:meta >>>"]);
  });

  test("REG-WU-001-RC-001-e: a CSS @charset rule stays first and the block follows its line", () => {
    const body = '@charset "UTF-8";\nbody{color:red}\n';
    const { file, out } = injectOnce("style.css", body);
    expect(out.startsWith('@charset "UTF-8";\n/* l9:meta:start\n')).toBe(true);
    expect(stripInjectedBlock(out, specOf(file, out))).toBe(body);
    // A @charset rule that does not end its line has no inert position after it.
    expect(resolveStrategy("inline.css", '@charset "UTF-8"; body{}\n').strategy).toBe("sidecar");
  });

  test("REG-WU-001-RC-001-f: Dockerfile parser directives stay on lines 1-2", () => {
    const body = "# syntax=docker/dockerfile:1\n# escape=`\nFROM x\n";
    const { file, out } = injectOnce("Dockerfile", body);
    const lines = out.split("\n");
    expect(lines.slice(0, 3)).toEqual(["# syntax=docker/dockerfile:1", "# escape=`", "# >>> l9:meta >>>"]);
    expect(stripInjectedBlock(out, specOf(file, out))).toBe(body);
  });

  test("REG-WU-001-RC-001-g: .ql and .sass use '//' line comments", () => {
    expect(resolveStrategy("rules.ql", "")).toMatchObject({ strategy: "line-comment", linePrefix: "//" });
    expect(resolveStrategy("theme.sass", "")).toMatchObject({ strategy: "line-comment", linePrefix: "//" });
    // .qls is a QL suite (YAML) and keeps '#'.
    expect(resolveStrategy("suite.qls", "")).toMatchObject({ strategy: "line-comment", linePrefix: "#" });
    const sass = injectOnce("theme.sass", "body\n  color: red\n");
    expect(sass.out).not.toContain("/*");
    expect(sass.out.startsWith("// >>> l9:meta >>>\n")).toBe(true);
  });

  test("REG-WU-001-RC-001-h: a shebang with no newline round-trips exactly", () => {
    const body = "#!/bin/sh";
    const root = tmp();
    const first = injectOnce("run.sh", body, root);
    expect(stripInjectedBlock(first.out, specOf(first.file, first.out))).toBe(body);
    expect(first.rec.bodyPreserved).toBe(true);
    expect(verify(first.file, first.rec.originalBodyHash, first.rec.meta).issues).toEqual([]);
    const second = injectOnce("run.sh", body, root);
    expect(second.rec.wouldChange).toBe(false);
    expect(second.out).toBe(first.out);
  });

  test("REG-WU-001-RC-001-i: a PHP open tag at EOF without a newline round-trips exactly", () => {
    const body = "<?php";
    const root = tmp();
    const first = injectOnce("index.php", body, root);
    expect(first.out.startsWith("<?php\n// >>> l9:meta >>>")).toBe(true);
    expect(stripInjectedBlock(first.out, specOf(first.file, first.out))).toBe(body);
    expect(first.rec.bodyPreserved).toBe(true);
    const second = injectOnce("index.php", body, root);
    expect(second.rec.wouldChange).toBe(false);
  });

  test("REG-WU-001-RC-001-j: BOM, CRLF shebang and no-terminator bodies keep their placement", () => {
    // Without a spec the shebang-only behaviour remains for external callers.
    expect(applyCommentInjection("﻿#!/bin/sh\necho\n", "# block", "\n")).toBe("﻿#!/bin/sh\n# block\necho\n");
    expect(applyCommentInjection("#!/bin/sh\r\necho\r\n", "# block", "\r\n")).toBe("#!/bin/sh\r\n# block\r\necho\r\n");
    expect(applyCommentInjection("x = 1", "# block", "\n")).toBe("# block\nx = 1");
    const spec = resolveStrategy("a.py", "");
    for (const body of ["﻿#!/bin/sh\necho\n", "#!/bin/sh\r\necho\r\n", "x = 1", "", "﻿"]) {
      const out = applyCommentInjection(body, yamlToBlock("a: 1", spec), "\n", spec);
      expect(stripInjectedBlock(out, spec)).toBe(body);
    }
  });

  test("REG-WU-001-RC-001-k: a CRLF XML file keeps one convention and the declaration at byte 0", () => {
    const body = '<?xml version="1.0"?>\r\n<root/>\r\n';
    const { file, out } = injectOnce("config.xml", body);
    expect(out.startsWith('<?xml version="1.0"?>\r\n<!-- l9:meta:start\r\n')).toBe(true);
    expect(out.match(/(?<!\r)\n/g)).toBeNull();
    expect(stripInjectedBlock(out, specOf(file, out))).toBe(body);
    if (HAS_XMLLINT) expect(spawnSync("xmllint", ["--noout", file]).status).toBe(0);
    // A declaration that does not end its line leaves no inert position.
    expect(resolveStrategy("one.xml", '<?xml version="1.0"?><root/>\n').strategy).toBe("sidecar");
  });

  test("REG-WU-001-RC-001-l: a legacy byte-0 block before <?php is replaced, not duplicated", () => {
    const legacy = "// >>> l9:meta >>>\n// a: 1\n// <<< l9:meta <<<\n<?php\necho 1;\n";
    expect(resolveStrategy("index.php", legacy).strategy).toBe("line-comment");
    expect(stripInjectedBlock(legacy, specOf("index.php", legacy))).toBe("<?php\necho 1;\n");
    const root = tmp();
    const first = injectOnce("index.php", legacy, root);
    expect(headCount(first.out, ">>> l9:meta >>>")).toBe(1);
    expect(first.out.startsWith("<?php\n// >>> l9:meta >>>\n")).toBe(true);
    expect(stripInjectedBlock(first.out, specOf(first.file, first.out))).toBe("<?php\necho 1;\n");
    const second = injectOnce("index.php", legacy, root);
    expect(second.rec.wouldChange).toBe(false);
  });

  // Every prologue language, with the block the pre-fix writer placed at byte 0
  // (after a BOM when present): one run repairs the placement, strip returns the
  // body without the legacy block, and a second run writes nothing.
  const LEGACY: Array<[string, string, string]> = [
    ["icon.svg", "<!-- l9:meta:start\na: 1\nl9:meta:end -->\n", '<?xml version="1.0"?>\n<svg/>\n'],
    ["style.css", "/* l9:meta:start\na: 1\nl9:meta:end */\n", '@charset "UTF-8";\nbody{}\n'],
    ["mod.py", "# >>> l9:meta >>>\n# a: 1\n# <<< l9:meta <<<\n", "# -*- coding: latin-1 -*-\nx = 1\n"],
    ["Dockerfile", "# >>> l9:meta >>>\n# a: 1\n# <<< l9:meta <<<\n", "# syntax=docker/dockerfile:1\nFROM x\n"],
    ["bom.xml", "<!-- l9:meta:start\na: 1\nl9:meta:end -->\n", '<?xml version="1.0"?>\n<r/>\n'],
    // .ql and .sass blocks written with the old, wrong prefix.
    ["rules.ql", "# >>> l9:meta >>>\n# a: 1\n# <<< l9:meta <<<\n", "from int i select i\n"],
    ["theme.sass", "/* l9:meta:start\na: 1\nl9:meta:end */\n", "body\n  color: red\n"],
    // The pre-fix shebang writer: shebang, then the block, before the cookie line.
    ["sh.py", "", "#!/usr/bin/env python\n# >>> l9:meta >>>\n# a: 1\n# <<< l9:meta <<<\n# coding: latin-1\nx = 1\n"],
  ];
  for (const [name, block, body] of LEGACY) {
    test(`REG-WU-001-RC-001-l: legacy position in ${name} is repaired once and then stable`, () => {
      const bom = name === "bom.xml" ? "﻿" : "";
      const legacy = `${bom}${block}${body}`;
      const expectedBody = name === "sh.py" ? "#!/usr/bin/env python\n# coding: latin-1\nx = 1\n" : `${bom}${body}`;
      const spec = specOf(name, legacy);
      expect(spec.strategy === "line-comment" || spec.strategy === "block-comment").toBe(true);
      expect(stripInjectedBlock(legacy, spec)).toBe(expectedBody);
      const root = tmp();
      const first = injectOnce(name, legacy, root);
      expect(headCount(first.out, "l9:meta")).toBe(2); // one start + one end sentinel
      const firstSpec = specOf(first.file, first.out);
      expect(stripInjectedBlock(first.out, firstSpec)).toBe(expectedBody);
      expect(extractInjectedYaml(first.out, firstSpec)).toContain(`source_path: ${name}`);
      const second = injectOnce(name, legacy, root);
      expect(second.rec.wouldChange).toBe(false);
      expect(second.out).toBe(first.out);
    });
  }

  test("REG-WU-001-RC-001-m: a write-mode pipeline run keeps every file valid and a re-run changes nothing", async () => {
    const root = tmp();
    const out = tmp();
    const files: Record<string, string> = {
      "index.php": '<?php\ndeclare(strict_types=1);\necho "hi";\n',
      "config.xml": '<?xml version="1.0" encoding="UTF-8"?>\n<config/>\n',
      "style.css": '@charset "UTF-8";\nbody{color:red}\n',
      "theme.sass": "body\n  color: red\n",
      "rules.ql": "from int i select i\n",
      "mod.py": "# -*- coding: latin-1 -*-\nx = 1\n",
    };
    for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(root, name), body);
    const first = await runPipelineAsync(pipelineCfg(root, out));
    expect(first.verification.passed).toBe(true);
    const hashes = Object.keys(files).map((name) => contentHash(fs.readFileSync(path.join(root, name), "utf8")));
    for (const name of Object.keys(files)) {
      const text = fs.readFileSync(path.join(root, name), "utf8");
      expect(stripInjectedBlock(text, specOf(name, text))).toBe(files[name]);
    }
    expect(fs.readFileSync(path.join(root, "index.php"), "utf8").startsWith("<?php\n")).toBe(true);
    expect(fs.readFileSync(path.join(root, "config.xml"), "utf8").startsWith("<?xml ")).toBe(true);
    expect(fs.readFileSync(path.join(root, "style.css"), "utf8").startsWith("@charset ")).toBe(true);
    expect(fs.readFileSync(path.join(root, "mod.py"), "utf8").startsWith("# -*- coding: latin-1 -*-\n")).toBe(true);
    expect(fs.readFileSync(path.join(root, "theme.sass"), "utf8")).not.toContain("/*");
    if (HAS_PHP) expect(spawnSync("php", [path.join(root, "index.php")], { encoding: "utf8" }).stdout).toBe("hi");
    if (HAS_XMLLINT) expect(spawnSync("xmllint", ["--noout", path.join(root, "config.xml")]).status).toBe(0);
    if (HAS_PYTHON) {
      const ran = spawnSync("python3", [path.join(root, "mod.py")]);
      expect(ran.status).toBe(0);
    }
    const second = await runPipelineAsync(pipelineCfg(root, out));
    expect(second.verification.passed).toBe(true);
    expect(Object.keys(files).map((name) => contentHash(fs.readFileSync(path.join(root, name), "utf8")))).toEqual(hashes);
  });

  test("REG-WU-001-RC-001-n: governed carrier decisions are unchanged for prologue files", () => {
    const authority = { schema: "l9.meta-authority/v1", default_carrier: "central_manifest", inline_allow: [] } as unknown as AuthorityConfig;
    const files: Record<string, string> = {
      "index.php": "<?php\necho 1;\n",
      "tpl.php": "<html><?php echo 1; ?></html>\n",
      "config.xml": '<?xml version="1.0"?>\n<c/>\n',
      "style.css": '@charset "UTF-8";\nbody{}\n',
      "theme.sass": "body\n  color: red\n",
      "rules.ql": "from int i select i\n",
      "mod.py": "# coding: latin-1\nx = 1\n",
    };
    const decisions = Object.entries(files).map(([name, body]) => {
      const d = resolveCarrierDecision(
        { path: name, artifactType: "documentation", strategy: resolveStrategy(name, body).strategy },
        authority, "check",
      );
      return [name, d.carrier, d.authorityRule];
    });
    // Recorded against the pre-change writer: every file is central_manifest, by the same rule.
    expect(decisions).toEqual([
      ["index.php", "central_manifest", "index.php"],
      ["tpl.php", "central_manifest", "tpl.php"],
      ["config.xml", "central_manifest", "config.xml"],
      ["style.css", "central_manifest", "style.css"],
      ["theme.sass", "central_manifest", "theme.sass"],
      ["rules.ql", "central_manifest", "strategy:line-comment"],
      ["mod.py", "central_manifest", "mod.py"],
    ]);
  });
});

const SENTINEL_ARRAY = [
  "export const markers = [",
  '  "// >>> l9:meta >>>",',
  '  "// a: 1",',
  '  "// <<< l9:meta <<<",',
  "];",
  "",
].join("\n");

describe("WU-001 RC-002 — the managed block is recognised only at the carrier position", () => {
  test("REG-WU-001-RC-002-a: body sentinel text survives injection; exactly one head block", () => {
    const body = SENTINEL_ARRAY.replace(/"\/\/ /g, "// ").replace(/",$/gm, "");
    // Sentinel lines appear at line starts inside the body, as a real block would.
    const { file, rec, out } = injectOnce("example.ts", body);
    const spec = specOf(file, out);
    expect(stripInjectedBlock(out, spec)).toBe(body);
    expect(out.startsWith("// >>> l9:meta >>>\n")).toBe(true);
    expect(headCount(out, "// >>> l9:meta >>>")).toBe(2); // the head block + the body text
    expect(out.endsWith(body)).toBe(true);
    expect(rec.bodyPreserved).toBe(true);
    expect(verify(file, rec.originalBodyHash, rec.meta).issues).toEqual([]);
  });

  test("REG-WU-001-RC-002-a: string-literal sentinels in a body are preserved too", () => {
    const { file, out } = injectOnce("example.ts", SENTINEL_ARRAY);
    expect(stripInjectedBlock(out, specOf(file, out))).toBe(SENTINEL_ARRAY);
    expect(out.endsWith(SENTINEL_ARRAY)).toBe(true);
  });

  test("REG-WU-001-RC-002-b: re-injection changes only the head block, never body sentinel text", () => {
    const body = "const a = 1;\n// >>> l9:meta >>>\n// x: 1\n// <<< l9:meta <<<\nconst b = 2;\n";
    const root = tmp();
    const first = injectOnce("mixed.ts", body, root, "first");
    // Incoming metadata wins (no reconciliation), so the head block really changes.
    injectFile(first.file, meta("mixed.ts", "second"), { ...OPTS(root), reconcileExisting: false });
    const second = { file: first.file, out: fs.readFileSync(first.file, "utf8") };
    expect(second.out).not.toBe(first.out);
    expect(second.out).toContain("// title: second");
    expect(second.out.endsWith(body)).toBe(true);
    expect(stripInjectedBlock(second.out, specOf(second.file, second.out))).toBe(body);
  });

  test("REG-WU-001-RC-002-c: body sentinels are preserved for every comment family", () => {
    const cases: Array<[string, string]> = [
      ["page.html", "<html>\n<body>\n<!-- l9:meta:start\nx: 1\nl9:meta:end -->\n</body>\n</html>\n"],
      ["style.css", "a{}\n/* l9:meta:start\nx: 1\nl9:meta:end */\nb{}\n"],
      ["script.py", "x = 1\n# >>> l9:meta >>>\n# y: 2\n# <<< l9:meta <<<\nz = 3\n"],
    ];
    for (const [name, body] of cases) {
      const { file, rec, out } = injectOnce(name, body);
      expect(out.endsWith(body)).toBe(true);
      expect(stripInjectedBlock(out, specOf(file, out))).toBe(body);
      expect(rec.bodyPreserved).toBe(true);
    }
  });

  test("REG-WU-001-RC-002-d: a file with only body sentinel text has no managed block", () => {
    const body = "x = 1\n# >>> l9:meta >>>\n# y: 2\n# <<< l9:meta <<<\n";
    const spec = specOf("a.py", body);
    expect(hasInjectedBlock(body, spec)).toBe(false);
    expect(extractInjectedYaml(body, spec)).toBeNull();
    expect(stripInjectedBlock(body, spec)).toBe(body);
    const html = "<p/>\n<!-- l9:meta:start\nx: 1\nl9:meta:end -->\n";
    expect(hasInjectedBlock(html, specOf("a.html", html))).toBe(false);
  });

  test("REG-WU-001-RC-002-e: historical byte-0, BOM and shebang head blocks are still recognised", () => {
    const spec = specOf("a.py", "");
    const block = "# >>> l9:meta >>>\n# a: 1\n# <<< l9:meta <<<\n";
    for (const [text, body] of [
      [`${block}print(1)\n`, "print(1)\n"],
      [`﻿${block}print(1)\n`, "﻿print(1)\n"],
      [`#!/usr/bin/env python\n${block}print(1)\n`, "#!/usr/bin/env python\nprint(1)\n"],
      [`#!/bin/sh\r\n${block.replace(/\n/g, "\r\n")}echo\r\n`, "#!/bin/sh\r\necho\r\n"],
    ]) {
      expect(hasInjectedBlock(text, spec)).toBe(true);
      expect(extractInjectedYaml(text, spec)).toBe("a: 1");
      expect(stripInjectedBlock(text, spec)).toBe(body);
    }
  });

  test("REG-WU-001-RC-002-f: injecting twice is byte-identical", () => {
    const root = tmp();
    const first = injectOnce("example.ts", SENTINEL_ARRAY, root);
    const second = injectOnce("example.ts", SENTINEL_ARRAY, root);
    expect(second.out).toBe(first.out);
    expect(second.rec.wouldChange).toBe(false);
  });

  test("REG-WU-001-RC-002-g: a write-mode pipeline run keeps body sentinels and hashes the full body", async () => {
    const root = tmp();
    const out = tmp();
    fs.mkdirSync(path.join(root, "src"));
    const file = path.join(root, "src", "example.ts");
    fs.writeFileSync(file, SENTINEL_ARRAY);
    const result = await runPipelineAsync(pipelineCfg(root, out));
    expect(result.verification.passed).toBe(true);
    const text = fs.readFileSync(file, "utf8");
    expect(text.endsWith(SENTINEL_ARRAY)).toBe(true);
    const record = result.injected.find((r) => r.sourcePath === file);
    expect(record?.meta.content_hash).toBe(contentHash(SENTINEL_ARRAY));
  });
});

function pipelineCfg(root: string, out: string): PipelineConfig {
  return {
    root, glob: "**/*", dryRun: false, outDir: out, namespace: "l9",
    authority: "l9.doctrine.platform", nearDupThreshold: 0.9, hashPrefixLength: 16,
    indexDir: out, verbose: false, llmEnabled: false, normalizeFilenames: false,
  };
}
