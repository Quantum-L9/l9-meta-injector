import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  METADATA_INDEX_RELATIVE_PATH,
  compileMetadataIndex,
  parseMetadataIndex,
  serializeMetadataIndex,
  writeMetadataIndex,
  type ManagedMetadataSubject,
} from "../src/metadata_index";
import type { AuthorityConfig } from "../src/operation_contracts";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const AUTHORITY: AuthorityConfig = {
  schema: "l9.meta-authority/v1",
  writer: { repository: "Quantum-L9/l9-meta-injector", ref: "0123456789012345678901234567890123456789" },
  default_carrier: "central_manifest",
  legacy_writers: "forbidden",
  inline_allow: ["prompts/**/*.md"],
};

function subject(pathName: string, artifactType: ManagedMetadataSubject["artifactType"], hash: string): ManagedMetadataSubject {
  return {
    path: pathName,
    artifactType,
    strategy: pathName.endsWith(".md") ? "yaml-frontmatter" : "line-comment",
    contentHash: hash,
    metadata: {
      zeta: 2,
      source_path: pathName,
      content_hash: hash,
      nested: { z: true, a: [3, { y: 2, x: 1 }] },
    },
  };
}

describe("metadata index compilation", () => {
  test("is stable across input order and recursively sorts object keys", () => {
    const one = compileMetadataIndex({ authority: AUTHORITY, mode: "apply", subjects: [
      subject("src/z.ts", "source", HASH_B),
      subject("src/a.ts", "source", HASH_A),
    ] });
    const two = compileMetadataIndex({ authority: AUTHORITY, mode: "apply", subjects: [
      subject("src/a.ts", "source", HASH_A),
      subject("src/z.ts", "source", HASH_B),
    ] });
    expect(one.bytes).toBe(two.bytes);
    expect(one.sha256).toBe(two.sha256);
    expect(one.bytes.indexOf('"path":"src/a.ts"')).toBeLessThan(one.bytes.indexOf('"path":"src/z.ts"'));
    expect(one.bytes).toContain('"nested":{"a":[3,{"x":1,"y":2}],"z":true}');
  });

  test("omits hard-skip subjects and records explicit inline authority", () => {
    const compiled = compileMetadataIndex({ authority: AUTHORITY, mode: "apply", subjects: [
      subject(".l9/private.json", "source", HASH_A),
      subject("prompts/a.md", "prompt", HASH_B),
    ] });
    expect(compiled.records).toHaveLength(1);
    expect(compiled.records[0].path).toBe("prompts/a.md");
    expect(compiled.records[0].carrier).toBe("inline_managed");
  });

  test("rejects volatile fields and metadata identity drift", () => {
    const volatile = subject("src/a.ts", "source", HASH_A);
    volatile.metadata = { ...volatile.metadata, absolute_path: "/tmp/a.ts" };
    expect(() => compileMetadataIndex({ authority: AUTHORITY, mode: "apply", subjects: [volatile] })).toThrow(/machine-specific/);

    const mismatch = subject("src/a.ts", "source", HASH_A);
    mismatch.metadata = { ...mismatch.metadata, source_path: "src/b.ts" };
    expect(() => compileMetadataIndex({ authority: AUTHORITY, mode: "apply", subjects: [mismatch] })).toThrow(/source_path mismatch/);
  });

  test("rejects duplicate paths and invalid hashes", () => {
    expect(() => compileMetadataIndex({ authority: AUTHORITY, mode: "apply", subjects: [
      subject("src/a.ts", "source", HASH_A), subject("src/a.ts", "source", HASH_B),
    ] })).toThrow(/duplicate carrier subject path/);
    const invalid = subject("src/a.ts", "source", "ABC");
    expect(() => compileMetadataIndex({ authority: AUTHORITY, mode: "apply", subjects: [invalid] })).toThrow(/lowercase SHA-256/);
  });

  test("round-trips only canonical path-sorted JSONL", () => {
    const compiled = compileMetadataIndex({ authority: AUTHORITY, mode: "apply", subjects: [subject("src/a.ts", "source", HASH_A)] });
    expect(parseMetadataIndex(compiled.bytes)).toEqual(compiled.records);
    expect(() => parseMetadataIndex(compiled.bytes.trimEnd())).toThrow(/end with a newline/);
    const parsed = JSON.parse(compiled.bytes.trim());
    const nonCanonical = `${JSON.stringify({ path: parsed.path, ...parsed })}\n`;
    expect(() => parseMetadataIndex(nonCanonical)).toThrow(/canonical JSON/);
  });

  test("serialize rejects hard_skip and duplicate record paths", () => {
    const compiled = compileMetadataIndex({ authority: AUTHORITY, mode: "apply", subjects: [subject("src/a.ts", "source", HASH_A)] });
    expect(() => serializeMetadataIndex([compiled.records[0], compiled.records[0]])).toThrow(/duplicate metadata index path/);
    expect(() => serializeMetadataIndex([{ ...compiled.records[0], carrier: "hard_skip" as never }])).toThrow(/unsupported materialized carrier/);
    expect(() => serializeMetadataIndex([{ ...compiled.records[0], carrier: "unknown_carrier" as never }])).toThrow(/unsupported materialized carrier/);
    expect(() => serializeMetadataIndex([{ ...compiled.records[0], artifact_type: "alien" as never }])).toThrow(/unsupported artifact type/);
    expect(() => serializeMetadataIndex([{ ...compiled.records[0], metadata: { ...compiled.records[0].metadata, source_path: "src/b.ts" } }])).toThrow(/source_path mismatch/);
  });
});

describe("metadata index writing", () => {
  test("dry-run is zero-write and real writes are byte-idempotent", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "l9-index-"));
    const input = { authority: AUTHORITY, mode: "apply" as const, subjects: [subject("src/a.ts", "source", HASH_A)] };
    const dry = writeMetadataIndex(root, input, { dryRun: true });
    expect(dry.changed).toBe(true);
    expect(dry.written).toBe(false);
    expect(fs.existsSync(path.join(root, ".l9"))).toBe(false);

    const first = writeMetadataIndex(root, input);
    expect(first.written).toBe(true);
    const target = path.join(root, METADATA_INDEX_RELATIVE_PATH);
    const beforeStat = fs.statSync(target).mtimeMs;
    const before = fs.readFileSync(target, "utf8");
    const second = writeMetadataIndex(root, input);
    expect(second.changed).toBe(false);
    expect(second.written).toBe(false);
    expect(fs.readFileSync(target, "utf8")).toBe(before);
    expect(fs.statSync(target).mtimeMs).toBe(beforeStat);
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("refuses .l9 and target symlinks", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "l9-index-"));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "l9-index-out-"));
    const input = { authority: AUTHORITY, mode: "apply" as const, subjects: [subject("src/a.ts", "source", HASH_A)] };
    fs.symlinkSync(outside, path.join(root, ".l9"), "dir");
    expect(() => writeMetadataIndex(root, input)).toThrow(/real directory/);
    fs.rmSync(path.join(root, ".l9"), { force: true });
    fs.mkdirSync(path.join(root, ".l9"));
    const externalFile = path.join(outside, "index.jsonl");
    fs.writeFileSync(externalFile, "");
    fs.symlinkSync(externalFile, path.join(root, METADATA_INDEX_RELATIVE_PATH));
    expect(() => writeMetadataIndex(root, input)).toThrow(/regular file/);
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });
});

describe("WU-006 index ordering and schema-faithful validation (RC-012, RC-013)", () => {
  const SCHEMA = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "schemas", "metadata-index-record.schema.json"), "utf8")) as {
    required: string[];
    additionalProperties: boolean;
    properties: { path: { pattern: string; maxLength: number; minLength: number } };
  };
  const SCHEMA_PATH = new RegExp(SCHEMA.properties.path.pattern, "u");

  function conformsToSchema(record: Record<string, unknown>): boolean {
    const keys = Object.keys(record).sort();
    if (JSON.stringify(keys) !== JSON.stringify([...SCHEMA.required].sort())) return false;
    const pathName = String(record.path);
    const length = [...pathName].length;
    return SCHEMA_PATH.test(pathName) && length >= SCHEMA.properties.path.minLength && length <= SCHEMA.properties.path.maxLength;
  }

  test("REG-WU-006-RC-012-a: records are ordered by code point, like carrier decisions", () => {
    const fullwidth = "docs/～.txt";
    const astral = "docs/\u{1F600}.txt";
    const compiled = compileMetadataIndex({ authority: AUTHORITY, mode: "apply", subjects: [subject(astral, "unknown", HASH_A), subject(fullwidth, "unknown", HASH_B)] });
    expect(compiled.carrierDecisions.map((item) => item.path)).toEqual([fullwidth, astral]);
    expect(compiled.records.map((record) => record.path)).toEqual([fullwidth, astral]);
    expect(compiled.bytes.indexOf(fullwidth)).toBeLessThan(compiled.bytes.indexOf(astral));
  });

  test("REG-WU-006-RC-012-b: the parser accepts code-point order and rejects the code-unit order", () => {
    const fullwidth = "docs/～.txt";
    const astral = "docs/\u{1F600}.txt";
    const compiled = compileMetadataIndex({ authority: AUTHORITY, mode: "apply", subjects: [subject(astral, "unknown", HASH_A), subject(fullwidth, "unknown", HASH_B)] });
    expect(parseMetadataIndex(compiled.bytes).map((record) => record.path)).toEqual([fullwidth, astral]);
    const lines = compiled.bytes.trimEnd().split("\n");
    const codeUnitOrder = `${[lines[1], lines[0]].join("\n")}\n`;
    expect(() => parseMetadataIndex(codeUnitOrder)).toThrow(/canonical path order/);
  });

  test("REG-WU-006-RC-012-d: ASCII-only indexes keep their bytes", () => {
    const compiled = compileMetadataIndex({ authority: AUTHORITY, mode: "apply", subjects: [
      subject("src/b.ts", "source", HASH_B), subject("src/a.ts", "source", HASH_A), subject("Z.md", "unknown", HASH_A), subject("_x.ts", "source", HASH_B),
    ] });
    expect(compiled.records.map((record) => record.path)).toEqual(["Z.md", "_x.ts", "src/a.ts", "src/b.ts"]);
    expect(parseMetadataIndex(compiled.bytes)).toEqual(compiled.records);
  });

  test("REG-WU-006-RC-013-a: a control-character path is refused by the producer naming the rule", () => {
    expect(() => compileMetadataIndex({ authority: AUTHORITY, mode: "apply", subjects: [subject("src/tab\there.ts", "source", HASH_A)] }))
      .toThrow(/control character/);
    expect(() => compileMetadataIndex({ authority: AUTHORITY, mode: "apply", subjects: [subject("src/del\u007F.ts", "source", HASH_A)] }))
      .toThrow(/control character/);
    expect(() => compileMetadataIndex({ authority: AUTHORITY, mode: "apply", subjects: [subject(".github/x.yml", "source", HASH_A)] }))
      .toThrow(/must not start with '\.'/);
    expect(() => compileMetadataIndex({ authority: AUTHORITY, mode: "apply", subjects: [subject(`src/${"a".repeat(4094)}`, "source", HASH_A)] }))
      .toThrow(/4096/);
  });

  test("REG-WU-006-RC-013-b: a record with a key outside the schema is refused by serialize and parse", () => {
    const compiled = compileMetadataIndex({ authority: AUTHORITY, mode: "apply", subjects: [subject("src/a.ts", "source", HASH_A)] });
    const parsed = JSON.parse(compiled.bytes.trim()) as Record<string, unknown>;
    const extra = `${JSON.stringify(Object.fromEntries(Object.entries({ ...parsed, zzz_extra: 1 }).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))))}\n`;
    expect(() => parseMetadataIndex(extra)).toThrow(/keys/);
    expect(() => serializeMetadataIndex([{ ...compiled.records[0], zzz_extra: 1 } as never])).toThrow(/keys/);
    const { metadata: _metadata, ...missing } = compiled.records[0];
    expect(() => serializeMetadataIndex([missing as never])).toThrow(/keys/);
  });

  test("REG-WU-006-RC-013-c: every produced record conforms to the shipped record schema", () => {
    expect(SCHEMA.additionalProperties).toBe(false);
    const compiled = compileMetadataIndex({ authority: AUTHORITY, mode: "apply", subjects: [
      subject("src/a.ts", "source", HASH_A),
      subject("prompts/a.md", "prompt", HASH_B),
      subject("docs/\u{1F600}.txt", "unknown", HASH_A),
      subject("docs/café file.txt", "unknown", HASH_B),
    ] });
    for (const line of compiled.bytes.trimEnd().split("\n")) {
      expect(conformsToSchema(JSON.parse(line) as Record<string, unknown>), line).toBe(true);
    }
    // The repository ships no persisted index fixture; the records every other test in
    // this file produces are the existing corpus and are checked the same way.
    const existing = compileMetadataIndex({ authority: AUTHORITY, mode: "apply", subjects: [
      subject("src/a.ts", "source", HASH_A), subject("src/b.ts", "source", HASH_B), subject("prompts/a.md", "prompt", HASH_A),
    ] });
    for (const record of parseMetadataIndex(existing.bytes)) {
      expect(conformsToSchema(record as unknown as Record<string, unknown>), record.path).toBe(true);
    }
  });
});
