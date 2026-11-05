// P1.2 — versioned native-header normalization (ADR-082).
import { describe, expect, test } from "vitest";
import { parseNativeMetadata } from "../src/native_metadata";
import { nativeMetadataExtractor } from "../src/extractors/native_metadata";
import type { AssertionDraft, ExtractorDiagnostic } from "../src/interpretation";

function parse(sourcePath: string, content: string) {
  return parseNativeMetadata(sourcePath, content);
}

function fieldsOf(sourcePath: string, content: string): Record<string, { state: string; values: string[]; lines: number[] }> {
  const out: Record<string, { state: string; values: string[]; lines: number[] }> = {};
  for (const declaration of parse(sourcePath, content).declarations) {
    for (const field of declaration.fields) {
      out[`${declaration.carrier}:${field.key}`] = {
        state: field.state,
        values: field.values.map((value) => value.text),
        lines: field.values.map((value) => value.line),
      };
    }
  }
  return out;
}

function extract(sourcePath: string, content: string): { drafts: AssertionDraft[]; diagnostics: ExtractorDiagnostic[] } {
  const diagnostics: ExtractorDiagnostic[] = [];
  const drafts = nativeMetadataExtractor.extract({
    subjectId: "artifact:x",
    sourcePath,
    content,
    contentHash: "sha256:0",
    pathExists: () => false,
    report: (diagnostic) => diagnostics.push(diagnostic),
  });
  return { drafts, diagnostics };
}

const LEGACY_V1 = [
  "# --- L9_META ---",
  "# l9_schema: 1",
  "# artifact_type: runtime_module",
  "# tags: [transportpacket, 'canonical-contract', \"validation\"]",
  "# owner: platform",
  "# status: active",
  "# --- /L9_META ---",
  "import os",
].join("\n");

describe("P1.2 carriers", () => {
  test("reads a legacy v1 hash block with exact provenance", () => {
    const [declaration] = parse("src/transport.py", LEGACY_V1).declarations;
    expect(declaration).toMatchObject({ carrier: "legacy-hash", declared_schema: "l9_schema:1", source_span: { start_line: 1, end_line: 7 } });
    expect(fieldsOf("src/transport.py", LEGACY_V1)["legacy-hash:tags"]).toEqual({
      state: "declared", values: ["transportpacket", "canonical-contract", "validation"], lines: [4, 4, 4],
    });
  });

  test("keeps schema 1 and schema 2 apart in every predicate", () => {
    const v2 = LEGACY_V1.replace("l9_schema: 1", "l9_schema: 2");
    const predicates = (text: string) => extract("a.md", text).drafts.map((draft) => draft.predicate);
    expect(predicates(LEGACY_V1)).toContain("meta.l9v1.governance.owner");
    expect(predicates(v2)).toContain("meta.l9v2.governance.owner");
    expect(predicates(v2).some((predicate) => predicate.startsWith("meta.l9v1."))).toBe(false);
  });

  test("reads the HTML-comment, docstring and pipe-delimited legacy forms", () => {
    const html = "<!-- L9_META\nl9_schema: 1\nlayer: [kernel, build]\nowner: platform\n/L9_META -->\n# Title\n";
    expect(parse("k.md", html).declarations[0]).toMatchObject({ carrier: "legacy-html", source_span: { start_line: 1, end_line: 5 } });
    const docstring = '"""\n--- L9_META ---\nl9_schema: 1\nengine: graph\n--- /L9_META ---\n\nprose\n"""\n';
    expect(fieldsOf("e.py", docstring)["legacy-docstring:engine"]).toMatchObject({ values: ["graph"], lines: [4] });
    const pipes = "# L9_META\n# l9_schema: 1 | origin: harvest | layer: kernel\n# /L9_META\n";
    expect(fieldsOf("k.yaml", pipes)).toMatchObject({
      "legacy-hash-bare:origin": { values: ["harvest"], lines: [2] },
      "legacy-hash-bare:layer": { values: ["kernel"], lines: [2] },
    });
  });

  test("reads a managed comment header through the managed carrier rules", () => {
    const managed = "#!/usr/bin/env python3\n# >>> l9:meta >>>\n# id: x.script\n# authority: Example/repo\n# owner: Unknown\n# <<< l9:meta <<<\nprint(1)\n";
    const [declaration] = parse("tool.py", managed).declarations;
    expect(declaration).toMatchObject({ carrier: "managed-comment", declared_schema: "managed:l9-meta-injector", source_span: { start_line: 2, end_line: 6 } });
    expect(fieldsOf("tool.py", managed)["managed-comment:owner"]).toEqual({ state: "unresolved", values: [], lines: [] });
    expect(extract("tool.py", managed).drafts.map((d) => [d.predicate, d.object])).toContainEqual(["meta.managed.unresolved_field", "owner"]);
  });

  test("reads L9 frontmatter, and skips frontmatter that is not L9 metadata", () => {
    const front = "---\nl9_schema: 1\nartifact_type: documentation\ntags: [docs, mcp]\n---\n# Readme\n";
    expect(parse("README.md", front).declarations[0]).toMatchObject({ carrier: "frontmatter", source_span: { start_line: 1, end_line: 5 } });
    const skill = "---\nname: review\ndescription: a skill\n---\n<!-- L9_META\nid: review\n/L9_META -->\n";
    const declarations = parse("SKILL.md", skill).declarations;
    expect(declarations.map((d) => d.carrier)).toEqual(["legacy-html"]);
    expect(declarations[0]).toMatchObject({ declared_schema: "none", source_span: { start_line: 5, end_line: 7 } });
  });
});

describe("P1.2 versions, ambiguity and refusal", () => {
  test("preserves an unknown schema version without assigning it known semantics", () => {
    const future = "---\nl9_schema: 3\nowner: someone\n---\n";
    const { drafts } = extract("f.md", future);
    expect(drafts.map((d) => [d.predicate, d.object])).toEqual([
      ["meta.declaration.carrier", "frontmatter"],
      ["meta.declaration.schema", "l9_schema:3"],
      ["meta.unversioned.field", "owner"],
    ]);
  });

  test("refuses a header that declares a field twice", () => {
    const duplicate = "# --- L9_META ---\n# l9_schema: 1\n# status: active\n# status: deprecated\n# --- /L9_META ---\n";
    const result = parse("d.yaml", duplicate);
    expect(result.declarations).toEqual([]);
    expect(result.diagnostics.map((d) => d.code)).toEqual(["native_metadata.duplicate_field"]);
  });

  test("refuses a body line that is not a key: value pair", () => {
    const malformed = "# --- L9_META ---\n# l9_schema: 1\n# this is prose\n# --- /L9_META ---\n";
    expect(parse("m.yaml", malformed).diagnostics.map((d) => d.code)).toEqual(["native_metadata.malformed"]);
  });

  test("marks unsupported YAML one field at a time, and refuses complex frontmatter whole", () => {
    const nested = "<!-- L9_META\nl9_schema: 1\ninputs:\n  - name: diff\n    type: text\nowner: platform\n/L9_META -->\n";
    expect(fieldsOf("s.md", nested)).toMatchObject({
      "legacy-html:inputs": { state: "unsupported" },
      "legacy-html:owner": { state: "declared", values: ["platform"] },
    });
    const complex = "---\nl9_schema: 1\nmeta:\n  nested: true\n---\n";
    expect(parse("c.md", complex).diagnostics.map((d) => d.code)).toEqual(["native_metadata.frontmatter_unsupported"]);
  });

  test("detects competing declarations across carriers without resolving them", () => {
    const competing = "---\nl9_schema: 1\nowner: platform\n---\n<!-- L9_META\nl9_schema: 1\nowner: engine-team\n/L9_META -->\n";
    const result = parse("o.md", competing);
    expect(result.declarations.map((d) => d.conflicts)).toEqual([["owner"], ["owner"]]);
    expect(result.diagnostics.map((d) => d.code)).toEqual(["native_metadata.competing_declarations"]);
    const owners = extract("o.md", competing).drafts.filter((d) => d.predicate === "meta.l9v1.governance.owner");
    expect(owners.map((d) => [d.object, d.sourceRange.start_line])).toEqual([["platform", 3], ["engine-team", 7]]);
  });

  test("reports a single-line header instead of guessing at it", () => {
    const single = "# L9_META: origin: kernel | layer: evals\nkey: 1\n";
    const result = parse("x.yaml", single);
    expect(result.declarations).toEqual([]);
    expect(result.diagnostics.map((d) => d.code)).toEqual(["native_metadata.unsupported_carrier"]);
  });
});

describe("P1.2 header position and line conventions", () => {
  test("numbers lines identically under CRLF, LF and a BOM", () => {
    const lf = "# --- L9_META ---\n# l9_schema: 1\n# status: active\n# --- /L9_META ---\n";
    const crlf = `﻿${lf.replace(/\n/g, "\r\n")}`;
    expect(fieldsOf("a.yaml", crlf)).toEqual(fieldsOf("a.yaml", lf));
    expect(parse("a.yaml", crlf).declarations[0].source_span).toEqual({ start_line: 1, end_line: 4 });
  });

  test("treats a marker outside the header region as body text", () => {
    const body = "# Doctrine\n\nTemplate:\n\n```\n# --- L9_META ---\n# l9_schema: 1\n# --- /L9_META ---\n```\n";
    const result = parse("doctrine.md", body);
    expect(result.declarations).toEqual([]);
    expect(result.diagnostics.map((d) => d.code)).toEqual(["native_metadata.marker_outside_header"]);
  });

  test("ignores a comment that merely mentions the format", () => {
    const prose = "\"\"\"Notes.\"\"\"\n\n# The L9_META header format is documented elsewhere.\nVALUE = 1\n";
    expect(parse("notes.py", prose).declarations).toEqual([]);
    expect(extract("notes.py", prose).drafts).toEqual([]);
  });

  test("returns nothing for a file with no metadata", () => {
    expect(parse("plain.py", "import os\nprint(os.name)\n")).toEqual({ declarations: [], diagnostics: [] });
  });

  test("is deterministic and never modifies its input", () => {
    const text = `${LEGACY_V1}\n`;
    const copy = String(text);
    const first = JSON.stringify(parse("p.py", text));
    expect(JSON.stringify(parse("p.py", text))).toBe(first);
    expect(text).toBe(copy);
  });
});

describe("P1.2 extractor epistemics", () => {
  test("files every claim as a source declaration about the artifact", () => {
    expect(nativeMetadataExtractor.subjectScope).toBe("artifact");
    const { drafts } = extract("src/transport.py", LEGACY_V1);
    expect(new Set(drafts.map((d) => d.authority))).toEqual(new Set(["source"]));
    const owner = drafts.find((d) => d.predicate === "meta.l9v1.governance.owner");
    expect(owner).toMatchObject({ object: "platform", evidenceClass: "declared", confidence: "medium" });
  });

  test("never turns references, load_when or ssot_for into dependency or authority predicates", () => {
    const text = "<!-- L9_META\nl9_schema: 1\nssot_for: [scope-a]\nload_when: [review]\nreferences: [docs/a.md]\n/L9_META -->\n";
    const predicates = extract("k.md", text).drafts.map((d) => d.predicate);
    expect(predicates).toEqual(expect.arrayContaining([
      "meta.l9v1.governance.ssot_for", "meta.l9v1.retrieval.load_when", "meta.l9v1.retrieval.references",
    ]));
    expect(predicates.some((p) => p === "package.dependency" || p.startsWith("authority.") || p.startsWith("work."))).toBe(false);
  });
});
