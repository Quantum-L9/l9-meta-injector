// carrier_value_safety.test.ts — WU-002 (ADR-057): canonical YAML scalars round-trip
// through the canonical parser, and carrier values cannot end or invalidate the host
// comment that carries them.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, test } from "vitest";
import { injectFile } from "../src/inject";
import { runPipelineAsync } from "../src/pipeline";
import { parseCanonicalYaml } from "../src/meta_schema";
import { serializeYamlObject, yamlScalar } from "../src/yaml_serialize";
import { coerceNormalizedMeta } from "../src/schema";
import type { PipelineConfig } from "../src/schema";
import {
  carrierForbiddenSequences, extractInjectedYaml, resolveStrategy, stripInjectedBlock, yamlToBlock,
} from "../src/comment";

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "l9-carrier-value-"));
}

function meta(name: string, title: string) {
  return coerceNormalizedMeta({
    id: name, title, artifact_type: "source", mcp_primitive: "resource", callable: false,
    retrievable: true, injectable: true, namespace: "t", sharing_scope: "agnostic",
    source_path: name, content_hash: "Unknown", token_cost_estimate: 13,
    authority: "t", created_or_detected_at: "Unknown",
  });
}

const OPTS = (root: string) => ({ dryRun: false, outDir: path.join(root, "out"), verbose: false, writeInjectLog: false });

function inject(name: string, body: string, title: string, root = tmp()) {
  const file = path.join(root, name);
  if (!fs.existsSync(file)) fs.writeFileSync(file, body);
  const rec = injectFile(file, meta(name, title), OPTS(root));
  const out = fs.readFileSync(file, "utf8");
  const spec = resolveStrategy(file, out);
  const yaml = extractInjectedYaml(out, spec);
  return { root, file, rec, out, spec, parsed: yaml === null ? null : parseCanonicalYaml(yaml) };
}

function blockText(out: string, open: string, close: string): string {
  const start = out.indexOf(open);
  const end = out.indexOf(close, start) + close.length;
  return out.slice(start, end);
}

const HAS_XMLLINT = spawnSync("xmllint", ["--version"], { stdio: "ignore" }).status === 0;

const ROUND_TRIP = [
  "123", "1.0", ".5", "-7", "~", "null", "true", "false", "[]", "{}", "[a, b]",
  "multi\nline", "a\rb", "tab\there", '5" screen # big', "a\u2028b", "plain", "yes",
  "C:\\tmp\\x", "\\x41 literal", 'a\\" # b', "  padded  ", "", "-", "- dash",
];

describe("WU-002 RC-005 — the serializer is the complement of the canonical parser", () => {
  test("REG-WU-002-RC-005-a: every string round-trips through serialize → parse", () => {
    for (const s of ROUND_TRIP) {
      const text = serializeYamlObject({ k: s }, { fences: false });
      expect(parseCanonicalYaml(text).k, JSON.stringify(s)).toBe(s);
      expect(text.split("\n")).toHaveLength(1);
    }
    // List items take the same scalar path.
    expect(parseCanonicalYaml(serializeYamlObject({ k: ["123", "~", "a\nb"] }, { fences: false })).k).toEqual(["123", "~", "a\nb"]);
  });

  test("REG-WU-002-RC-005-b: typed values keep their types and stay bare", () => {
    const value = { callable: true, token_cost_estimate: 13, ratio: 0.5, none: null, tags: ["a", "b"], empty: [] };
    const text = serializeYamlObject(value, { fences: false });
    expect(text).toContain("callable: true");
    expect(text).toContain("token_cost_estimate: 13");
    expect(parseCanonicalYaml(text)).toEqual(value);
  });

  test("REG-WU-002-RC-005-c: '~' and numeric file titles converge after one write-mode run", async () => {
    const root = tmp();
    const out = tmp();
    fs.mkdirSync(path.join(root, "src"));
    for (const name of ["~.py", "2024.py"]) fs.writeFileSync(path.join(root, "src", name), "x = 1\n");
    await runPipelineAsync(pipelineCfg(root, out));
    const first = ["~.py", "2024.py"].map((n) => fs.readFileSync(path.join(root, "src", n), "utf8"));
    await runPipelineAsync(pipelineCfg(root, out));
    const second = ["~.py", "2024.py"].map((n) => fs.readFileSync(path.join(root, "src", n), "utf8"));
    expect(second).toEqual(first);
    const titles = first.map((text) => {
      const yaml = extractInjectedYaml(text, resolveStrategy("a.py", text));
      return yaml === null ? undefined : parseCanonicalYaml(yaml).title;
    });
    expect(titles).toEqual(["~", "2024"]);
  });

  test("REG-WU-002-RC-005-d: benign scalars stay bare and byte-identical", () => {
    expect(yamlScalar("plain")).toBe("plain");
    expect(yamlScalar("hello world")).toBe("hello world");
    expect(yamlScalar("yes")).toBe("yes");
    expect(yamlScalar("a:b")).toBe('"a:b"');
    expect(yamlScalar("v1.2.3")).toBe("v1.2.3");
    expect(yamlScalar("C:\\tmp")).toBe('"C:\\\\tmp"');
  });

  test("REG-WU-002-RC-005-e: an escaped quote before ' #' is not a comment", () => {
    expect(parseCanonicalYaml('k: "a\\" # b"').k).toBe('a" # b');
  });
});

describe("WU-002 RC-003 — carrier values cannot break the host comment", () => {
  test("REG-WU-002-RC-003-a: a BEM-named SVG stays well-formed and its path round-trips", async () => {
    const root = tmp();
    const out = tmp();
    const file = path.join(root, "icon--dark.svg");
    fs.writeFileSync(file, '<svg xmlns="http://www.w3.org/2000/svg"/>\n');
    const result = await runPipelineAsync(pipelineCfg(root, out));
    expect(result.verification.passed).toBe(true);
    const text = fs.readFileSync(file, "utf8");
    const block = blockText(text, "<!--", "-->");
    expect(block.slice(4, -3)).not.toContain("--");
    const yaml = extractInjectedYaml(text, resolveStrategy(file, text));
    expect(yaml === null ? undefined : parseCanonicalYaml(yaml).source_path).toBe("icon--dark.svg");
    if (HAS_XMLLINT) expect(spawnSync("xmllint", ["--noout", file]).status).toBe(0);
  });

  test("REG-WU-002-RC-003-b: a '*/' value cannot close a CSS comment early", () => {
    const r = inject("a.css", "body{}\n", "x */ y");
    expect(r.out.split("*/")).toHaveLength(2); // only the block's own close
    expect(r.out.indexOf("*/")).toBe(r.out.indexOf("l9:meta:end */") + "l9:meta:end ".length);
    expect(r.parsed?.title).toBe("x */ y");
  });

  test("REG-WU-002-RC-003-c: a '-->' value cannot close an HTML comment early", () => {
    const r = inject("page.html", "<p/>\n", "a --> b -- c");
    expect(r.out.indexOf("-->")).toBe(r.out.indexOf("l9:meta:end -->") + "l9:meta:end ".length);
    expect(blockText(r.out, "<!--", "l9:meta:end -->").slice(4, -3)).not.toContain("--");
    expect(r.parsed?.title).toBe("a --> b -- c");
  });

  test("REG-WU-002-RC-003-d: CR and U+2028 cannot end a '//' comment line", () => {
    for (const title of ["x\rconsole.log(1)", "x\u2028console.log(1)", "x\u2029y\u0085z"]) {
      const r = inject("a.js", "export {};\n", title);
      const block = blockText(r.out, "// >>> l9:meta >>>", "// <<< l9:meta <<<");
      for (const line of block.split(/\r\n|[\n\r\u2028\u2029\u0085]/)) expect(line.startsWith("//")).toBe(true);
      expect(r.parsed?.title).toBe(title);
      if (spawnSync("node", ["--version"]).status === 0) {
        expect(spawnSync("node", ["--check", r.file]).status).toBe(0);
      }
    }
  });

  test("REG-WU-002-RC-003-e: '#{' cannot reach an SCSS loud comment", () => {
    const r = inject("a.scss", "a{}\n", "x #{1+1} y");
    expect(blockText(r.out, "/* l9:meta:start", "l9:meta:end */")).not.toContain("#{");
    expect(r.parsed?.title).toBe("x #{1+1} y");
  });

  test("REG-WU-002-RC-003-f: the carrier's own END sentinel text in a value round-trips", () => {
    for (const [name, title] of [["a.py", "<<< l9:meta <<<"], ["a.html", "l9:meta:end -->"], ["a.css", "l9:meta:end */"]]) {
      const body = name === "a.py" ? "x = 1\n" : "z\n";
      const r = inject(name, body, title);
      expect(r.parsed?.title).toBe(title);
      expect(stripInjectedBlock(r.out, r.spec)).toBe(body);
    }
  });

  test("REG-WU-002-RC-003-g: benign values produce the same block bytes as before", () => {
    const yaml = serializeYamlObject(
      { id: "a.ts", title: "My Title", callable: false, token_cost_estimate: 13, tags: ["x", "y"], path: "src/a.ts" },
      { fences: false, forbidden: carrierForbiddenSequences(resolveStrategy("a.svg", "")) },
    );
    expect(yamlToBlock(yaml, resolveStrategy("a.svg", ""))).toBe([
      "<!-- l9:meta:start", "id: a.ts", "title: My Title", "callable: false", "token_cost_estimate: 13",
      "tags:", "  - x", "  - y", "path: src/a.ts", "l9:meta:end -->",
    ].join("\n"));
  });

  test("REG-WU-002-RC-003-h: every hazardous case is idempotent on a second run", () => {
    const cases: Array<[string, string, string]> = [
      ["icon--dark.svg", "<svg/>\n", "icon--dark"],
      ["a.css", "body{}\n", "x */ y"],
      ["page.html", "<p/>\n", "a --> b"],
      ["a.js", "export {};\n", "x\ry\u2028z"],
      ["a.scss", "a{}\n", "x #{1} y"],
      ["a.py", "x = 1\n", "<<< l9:meta <<<"],
    ];
    for (const [name, body, title] of cases) {
      const root = tmp();
      const first = inject(name, body, title, root);
      const second = inject(name, body, title, root);
      expect(second.rec.wouldChange, name).toBe(false);
      expect(second.out).toBe(first.out);
    }
  });

  test("REG-WU-002-RC-003: a key that the carrier cannot express is refused, never written", () => {
    expect(() => serializeYamlObject({ "a--b": "x" }, { fences: false, forbidden: ["--"] })).toThrow(/CARRIER_UNREPRESENTABLE/);
    expect(() => yamlToBlock("title: x -- y", resolveStrategy("a.svg", ""))).toThrow(/CARRIER_UNREPRESENTABLE/);
  });
});

function pipelineCfg(root: string, out: string): PipelineConfig {
  return {
    root, glob: "**/*", dryRun: false, outDir: out, namespace: "l9",
    authority: "l9.doctrine.platform", nearDupThreshold: 0.9, hashPrefixLength: 16,
    indexDir: out, verbose: false, llmEnabled: false, normalizeFilenames: false,
  };
}
