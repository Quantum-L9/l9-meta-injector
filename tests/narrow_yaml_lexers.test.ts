// narrow_yaml_lexers.test.ts — WU-017 (RC-024): each hand-written YAML-subset lexer
// either reads its accepted subset as YAML would or refuses the input.
//
// One rule is shared: a quote character opens a quoted scalar only where a scalar
// (or a flow-list item) begins, so a mid-word apostrophe does not hide a trailing
// ` # comment`, and a backslash escapes the next character inside double quotes.
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, test } from "vitest";
import { parseCanonicalYaml } from "../src/meta_schema";
import { serializeYamlObject } from "../src/yaml_serialize";
import { parseAuthorityYaml } from "../src/authority";
import { documentStructureExtractor, workIntelligenceExtractor } from "../src/extractors/work_intelligence";
import type { AssertionDraft, Extractor } from "../src/interpretation";

const AUTHORITY = `schema: l9.meta-authority/v1
writer:
  repository: Quantum-L9/l9-meta-injector
  ref: v4.0.0
default_carrier: central_manifest
legacy_writers: forbidden
inline_allow:
  - prompts/**/*.md
  - kernels/**/*.md
validation_commands:
  - npm test
`;

function invalidCode(text: string): string | undefined {
  try {
    parseAuthorityYaml(text);
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

function extract(extractor: Extractor, lines: string[]): AssertionDraft[] {
  return extractor.extract({
    subjectId: "artifact:test",
    sourcePath: "docs/plan.md",
    content: `${lines.join("\n")}\n`,
    contentHash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    pathExists: () => false,
  });
}

function objects(drafts: AssertionDraft[], predicate: string): AssertionDraft[] {
  return drafts.filter((draft) => draft.predicate === predicate);
}

describe("WU-017 RC-024 — meta_schema canonical parser", () => {
  test("REG-WU-017-RC-024-a: a mid-word apostrophe does not hide a trailing comment", () => {
    expect(parseCanonicalYaml("description: it's fine # c").description).toBe("it's fine");
  });

  test("REG-WU-017-RC-024-b: plain scalars and list items with apostrophes drop their comments", () => {
    expect(parseCanonicalYaml("default: don't # comment").default).toBe("don't");
    expect(parseCanonicalYaml("items:\n  - it's x # c\n  - plain").items).toEqual(["it's x", "plain"]);
    // A quoted flow-list item still protects its '#'.
    expect(parseCanonicalYaml("tags: [a, 'b # c'] # trailing").tags).toEqual(["a", "b # c"]);
  });

  test("REG-WU-017-RC-024-c: quoted '#' and a '#' without leading whitespace are preserved", () => {
    expect(parseCanonicalYaml("key: 'a # b'").key).toBe("a # b");
    expect(parseCanonicalYaml('key: "hello # world"').key).toBe("hello # world");
    expect(parseCanonicalYaml("key: url#frag").key).toBe("url#frag");
    expect(parseCanonicalYaml("key: 'it''s # here' # gone").key).toBe("it's # here");
  });

  test("REG-WU-017-RC-024-d: an escaped quote before ' #' round-trips through the serializer", () => {
    for (const value of ['a" # b', 'x\\" # y', "it's # z"]) {
      expect(parseCanonicalYaml(serializeYamlObject({ k: value }, { fences: false })).k).toBe(value);
    }
  });
});

describe("WU-017 RC-024 — authority parser is narrow and fail-closed", () => {
  test("REG-WU-017-RC-024-e: an apostrophe in a plain ref does not keep the comment", () => {
    const parsed = parseAuthorityYaml(AUTHORITY.replace("ref: v4.0.0", "ref: maintainer's-v4 # pinned"));
    expect(parsed.writer.ref).toBe("maintainer's-v4");
    // The same rule inside an inline list: a quote opens a quoted item only at its start.
    const list = parseAuthorityYaml(AUTHORITY.replace(
      "inline_allow:\n  - prompts/**/*.md\n  - kernels/**/*.md",
      "inline_allow: [docs/it's/*.md, 'a,b # c', \"x\\\"y\"] # trailing",
    ));
    expect(list.inline_allow).toEqual(["docs/it's/*.md", "a,b # c", 'x"y']);
  });

  test("REG-WU-017-RC-024-f: plain null, ~ and bool tokens are refused", () => {
    for (const token of ["null", "~", "true", "false", "Null", "TRUE"]) {
      expect(invalidCode(AUTHORITY.replace("ref: v4.0.0", `ref: ${token}`)), token).toBe("META_AUTHORITY_CONFIG_INVALID");
    }
    // Quoted, they are ordinary strings.
    expect(parseAuthorityYaml(AUTHORITY.replace("ref: v4.0.0", 'ref: "null"')).writer.ref).toBe("null");
  });

  test("REG-WU-017-RC-024-g: a key without a separating space and a plain ': ' value are refused", () => {
    expect(invalidCode(AUTHORITY.replace("schema: l9.meta-authority/v1", "schema:l9.meta-authority/v1"))).toBe("META_AUTHORITY_CONFIG_INVALID");
    expect(invalidCode(AUTHORITY.replace("ref: v4.0.0", "ref: a: b"))).toBe("META_AUTHORITY_CONFIG_INVALID");
    expect(invalidCode(AUTHORITY.replace("ref: v4.0.0", "ref:v4.0.0"))).toBe("META_AUTHORITY_CONFIG_INVALID");
    expect(invalidCode(AUTHORITY.replace("  - npm test", "  - echo a: b"))).toBe("META_AUTHORITY_CONFIG_INVALID");
  });

  test("REG-WU-017-RC-024-h: an empty block list is refused; an explicit [] is accepted", () => {
    const empty = AUTHORITY.replace("inline_allow:\n  - prompts/**/*.md\n  - kernels/**/*.md\n", "inline_allow:\n");
    expect(invalidCode(empty)).toBe("META_AUTHORITY_CONFIG_INVALID");
    const explicit = AUTHORITY.replace("inline_allow:\n  - prompts/**/*.md\n  - kernels/**/*.md\n", "inline_allow: []\n");
    expect(parseAuthorityYaml(explicit).inline_allow).toEqual([]);
  });

  test("REG-WU-017-RC-024-i: the repository's own authority and the scan fixture parse as before", () => {
    const own = parseAuthorityYaml(fs.readFileSync(path.join(__dirname, "..", ".l9", "meta-authority.yaml"), "utf8"));
    expect(own.writer).toEqual({ repository: "Quantum-L9/l9-meta-injector", ref: "v4" });
    expect(own.default_carrier).toBe("central_manifest");
    expect(own.inline_allow).toEqual([]);
    expect(own.product?.archetype).toBe("l9.dependency-archetype/semantic-subsystem@1");
    expect(Object.keys(own.semantic_foundation?.ledgers ?? {})).toHaveLength(6);
    const fixture = parseAuthorityYaml(AUTHORITY);
    expect(fixture.writer).toEqual({ repository: "Quantum-L9/l9-meta-injector", ref: "v4.0.0" });
    expect(fixture.inline_allow).toEqual(["prompts/**/*.md", "kernels/**/*.md"]);
    expect(fixture.validation_commands).toEqual(["npm test"]);
    expect(parseAuthorityYaml(AUTHORITY.replace("ref: v4.0.0", "ref: 'v4 # quoted' # comment")).writer.ref).toBe("v4 # quoted");
  });
});

describe("WU-017 RC-024 — work-intelligence frontmatter scalars", () => {
  test("REG-WU-017-RC-024-j: a trailing comment does not hide the declared status", () => {
    const drafts = extract(workIntelligenceExtractor, ["---", "status: blocked  # draft | active | blocked | done", "---", "# Plan"]);
    const status = objects(drafts, "work.status").filter((d) => d.evidenceClass === "declared" && d.confidence === "high");
    expect(status.map((d) => d.object)).toEqual(["blocked"]);
    expect(status[0].sourceRange.start_line).toBe(2);
  });

  test("REG-WU-017-RC-024-k: a block-scalar indicator is never a title", () => {
    for (const indicator of [">", "|", ">-", "|2", "|+", ">2-"]) {
      const drafts = extract(documentStructureExtractor, ["---", `title: ${indicator}`, "  A long folded", "  title text", "---", "# Real Title"]);
      const titles = objects(drafts, "document.title").map((d) => d.object);
      expect(titles, indicator).not.toContain(indicator);
      expect(titles, indicator).toContain("Real Title");
    }
  });

  test("REG-WU-017-RC-024-l: quoted '#' in a title and a plain status are unchanged", () => {
    const structure = extract(documentStructureExtractor, ["---", 'title: "A # B"', "status: wip", "---", "body"]);
    expect(objects(structure, "document.title").map((d) => d.object)).toContain("A # B");
    const work = extract(workIntelligenceExtractor, ["---", 'title: "A # B"', "status: wip", "---", "body"]);
    expect(objects(work, "work.status").map((d) => d.object)).toContain("wip");
  });
});

describe("AUDIT G03 — ':' and '[' open a scalar only where YAML says they do", () => {
  test("REG-AUDIT-G03-a: meta_schema — a quote after a mid-word ':' or '[' is plain text", () => {
    // `x:'a` and `x['a` are plain scalars in YAML; the ' # b' that follows is a comment.
    expect(parseCanonicalYaml("key: x:'a # b").key).toBe("x:'a");
    expect(parseCanonicalYaml("key: x['a # b").key).toBe("x['a");
    expect(parseCanonicalYaml("items:\n  - 1x:\"a # b\n  - y").items).toEqual(['1x:"a', "y"]);
  });

  test("REG-AUDIT-G03-b: meta_schema — quotes after ': ' and inside a flow list still protect '#'", () => {
    expect(parseCanonicalYaml("key: 'a # b' # c").key).toBe("a # b");
    expect(parseCanonicalYaml("tags: [x, \"c # d\"] # e").tags).toEqual(["x", "c # d"]);
  });

  test("REG-AUDIT-G03-c: authority — a quote after a mid-word ':' or '[' does not keep the comment", () => {
    expect(parseAuthorityYaml(AUTHORITY.replace("ref: v4.0.0", "ref: x:'a # b")).writer.ref).toBe("x:'a");
    expect(parseAuthorityYaml(AUTHORITY.replace("ref: v4.0.0", "ref: x['a # b")).writer.ref).toBe("x['a");
    const list = parseAuthorityYaml(AUTHORITY.replace(
      "inline_allow:\n  - prompts/**/*.md\n  - kernels/**/*.md",
      "inline_allow: ['a # b', c] # trailing",
    ));
    expect(list.inline_allow).toEqual(["a # b", "c"]);
  });
});
