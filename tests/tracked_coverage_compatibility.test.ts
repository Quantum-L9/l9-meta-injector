import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  compileTrackedMetadataIndex, compileMetadataIndex, parseMetadataIndex, serializeMetadataIndex, readVersionedMetadataIndex,
  parseMetadataIndexV2, assertLegacyMetadataIndexWrite, writeMetadataIndex, type MetadataIndexRecord,
} from "../src/metadata_index";
import type { AuthorityConfig } from "../src/operation_contracts";
import { runApplyAsync } from "../src/apply";

const authority: AuthorityConfig = { schema: "l9.meta-authority/v1", writer: { repository: "Quantum-L9/l9-meta-injector", ref: "a".repeat(40) }, default_carrier: "central_manifest", legacy_writers: "forbidden", inline_allow: [] };
const v1: MetadataIndexRecord = { schema: "l9.metadata-index/v1", path: "src/a.ts", carrier: "central_manifest", artifact_type: "source", content_hash: "a".repeat(64), metadata: { id: "l9.source.src_a__ts", content_hash: "a".repeat(64), source_path: "src/a.ts" } };
const v2 = () => compileTrackedMetadataIndex({ snapshot: { repository_id: "r", revision: "a".repeat(40), tree_oid: "b".repeat(40), object_format: "sha1", entries: [] }, producerVersion: "4.3.0" });
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function root(): string { const result = fs.mkdtempSync(path.join(os.tmpdir(), "l9-v2-compat-")); roots.push(result); fs.mkdirSync(path.join(result, ".l9")); return result; }

describe("G12-G13 versioned universal index does not widen legacy behavior", () => {
  test("v1 canonical bytes and compiler/parser stay byte-for-byte stable", () => {
    const bytes = `{"artifact_type":"source","carrier":"central_manifest","content_hash":"${"a".repeat(64)}","metadata":{"content_hash":"${"a".repeat(64)}","id":"l9.source.src_a__ts","source_path":"src/a.ts"},"path":"src/a.ts","schema":"l9.metadata-index/v1"}\n`;
    expect(serializeMetadataIndex([v1])).toBe(bytes);
    expect(parseMetadataIndex(bytes)).toEqual([v1]);
    expect(readVersionedMetadataIndex(bytes)).toEqual({ schema: "l9.metadata-index/v1", records: [v1] });
    const compiled = compileMetadataIndex({ authority, mode: "check", subjects: [{ path: v1.path, artifactType: "source", strategy: "sidecar", contentHash: v1.content_hash, metadata: v1.metadata }] });
    expect(compiled.bytes).toBe(bytes);
    expect(parseMetadataIndex("")).toEqual([]);
    expect(readVersionedMetadataIndex("")).toEqual({ schema: "l9.metadata-index/v1", records: [] });
  });
  test("old parser still rejects v2; explicit reader recognizes even header-only v2", () => {
    const result = v2();
    expect(() => parseMetadataIndex(result.bytes)).toThrow();
    expect(readVersionedMetadataIndex(result.bytes)).toEqual({ schema: "l9.metadata-index/v2", header: result.header, records: [] });
    expect(() => parseMetadataIndexV2(serializeMetadataIndex([v1]))).toThrow();
  });
  test("mixed/unsupported versions, missing header, and extra v1 fields remain rejected", () => {
    expect(() => readVersionedMetadataIndex(v2().bytes + serializeMetadataIndex([v1]))).toThrow(/mixed/);
    expect(() => readVersionedMetadataIndex('{"schema":"l9.metadata-index/v99"}\n')).toThrow(/unsupported/);
    expect(() => parseMetadataIndex(`${JSON.stringify({ ...v1, content_hash_scope: "not_inspected" })}\n`)).toThrow();
    expect(() => serializeMetadataIndex([{ ...v1, path: ".unknown/x" }])).toThrow(/start/);
    expect(() => serializeMetadataIndex([{ ...v1, content_hash: null as never }])).toThrow(/SHA-256/);
  });
  test("legacy write guard recognizes explicit v2/unknown markers, not ordinary corrupt-v1", () => {
    expect(() => assertLegacyMetadataIndexWrite(v2().bytes)).toThrow(/downgrade/);
    expect(() => assertLegacyMetadataIndexWrite('{"schema":"l9.metadata-index/v99"}\n')).toThrow(/downgrade/);
    expect(() => assertLegacyMetadataIndexWrite('{"schema":"l9.metadata-index/v2",broken\n')).toThrow(/downgrade/);
    expect(() => assertLegacyMetadataIndexWrite("ordinary corrupt legacy content\n")).not.toThrow();
    expect(() => assertLegacyMetadataIndexWrite('{"schema":"l9.metadata-index/v1",broken\n')).not.toThrow();
  });
  test("legacy write guard sees a version marker split across lines (PR #124 review)", () => {
    expect(() => assertLegacyMetadataIndexWrite('{"schema"\n: "l9.metadata-index/v2"}\n')).toThrow(/downgrade active l9\.metadata-index\/v2/);
    expect(() => assertLegacyMetadataIndexWrite('{"schema":\r\n  "l9.metadata-index/v2"}\n')).toThrow(/downgrade/);
    expect(() => assertLegacyMetadataIndexWrite('{"schema"\n:\n"l9.metadata-index/v1"}\n')).not.toThrow();
    // An escaped marker inside a JSON string value is data, not a store version.
    expect(() => assertLegacyMetadataIndexWrite('{"schema":"l9.metadata-index/v1","note":"\\"schema\\":\\n\\"l9.metadata-index/v2\\""}\n')).not.toThrow();
  });
  test("legacy direct index writer refuses active v2 with no replacement", () => {
    const directory = root();
    const result = v2();
    const target = path.join(directory, ".l9/metadata-index.jsonl");
    fs.writeFileSync(target, result.bytes);
    expect(() => writeMetadataIndex(directory, { authority, mode: "apply", subjects: [] })).toThrow(/downgrade/);
    expect(fs.readFileSync(target, "utf8")).toBe(result.bytes);
  });
  test("legacy unscoped apply refuses active v2 rather than silently rebuilding v1", async () => {
    const directory = root();
    fs.writeFileSync(path.join(directory, ".l9/meta-authority.yaml"), `schema: l9.meta-authority/v1\nwriter:\n  repository: Quantum-L9/l9-meta-injector\n  ref: ${"a".repeat(40)}\ndefault_carrier: central_manifest\nlegacy_writers: forbidden\ninline_allow: []\n`);
    fs.mkdirSync(path.join(directory, "src"));
    fs.writeFileSync(path.join(directory, "src/a.ts"), "export const answer = 42;\n");
    const target = path.join(directory, ".l9/metadata-index.jsonl");
    const bytes = v2().bytes;
    fs.writeFileSync(target, bytes);
    const output = `${directory}.l9out`; roots.push(output);
    await expect(runApplyAsync({ root: directory, glob: "**/*", namespace: "l9", authority: "Quantum-L9", outDir: output, indexDir: output, nearDupThreshold: 0.9, hashPrefixLength: 12, verbose: false, llmEnabled: false, normalizeFilenames: false, writeInjectLog: false, localFiles: false, persistOutputs: false })).rejects.toThrow(/downgrade/);
    expect(fs.readFileSync(target, "utf8")).toBe(bytes);
    expect(fs.readFileSync(path.join(directory, "src/a.ts"), "utf8")).toBe("export const answer = 42;\n");
  });
});
