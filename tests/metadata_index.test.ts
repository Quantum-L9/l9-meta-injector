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
