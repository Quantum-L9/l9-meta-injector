// Drift guard for the producer-owned managed-header vocabulary contract (ADR-086).
// The contract in docs/managed-header-vocabulary.json must describe what the
// writer actually writes and what native-metadata/v1 actually reads back.
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { describe, expect, test } from "vitest";
import { buildMeta } from "../src/normalize_meta";
import { extract, splitContent } from "../src/extract";
import { injectFile } from "../src/inject";
import { inventoryTree } from "../src/inventory";
import { nativeMetadataExtractor } from "../src/extractors/native_metadata";
import { MANAGED_DECLARED_SCHEMA } from "../src/native_metadata";
import { PRIMITIVE_TAXONOMY } from "../src/schema";
import type { ArtifactType, ClassifyResult } from "../src/schema";
import type { NamespaceConfig } from "../src/namespace";
import type { HeaderIdentityResolution } from "../src/operation_contracts";

interface ContractField {
  field: string;
  category: string;
  value_kind: string;
  allowed_values?: string[];
  semantics: string;
}

const REPO = path.resolve(__dirname, "..");
const CONTRACT = JSON.parse(fs.readFileSync(path.join(REPO, "docs/managed-header-vocabulary.json"), "utf8")) as {
  vocabulary: string;
  version: string;
  identity: string;
  definition_ref_form: string;
  declared_schema: string;
  meaning: { projection: string };
  writers: Array<{ writer: string }>;
  unresolved_and_out_of_vocabulary: { written_outside_vocabulary: { annotate: string[]; inventory: string[] } };
  variants: { family: string[]; owner: string[]; neither: string[] };
  writer_invariants: { taxonomy: Record<string, { mcp_primitive: string; callable: boolean; injectable: boolean }> };
  fields: ContractField[];
};
const FIELD = new Map(CONTRACT.fields.map((entry) => [entry.field, entry]));

const NS: NamespaceConfig = {
  namespace: "l9", authority: "Quantum-L9/example", nearDupThreshold: 0.9,
  hashPrefixLength: 16, outputDir: ".out", indexDir: ".",
};
const IDENTITY = {
  authority: "Quantum-L9/example",
  namespace: "l9",
  source: "semantic_binding",
  conflicts: [],
  product: { id: "l9", owner: "Quantum-L9/example" },
} as unknown as HeaderIdentityResolution;

function cls(artifactType: ArtifactType): ClassifyResult {
  return { artifactType, family: "research", signals: [], confidence: "high" };
}

/** Write a managed header with the real writer, then read it back with the real extractor. */
function roundTrip(fileName: string, body: string, artifactType: ArtifactType) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "l9-managed-vocab-"));
  const fp = path.join(root, fileName);
  fs.writeFileSync(fp, body);
  const raw = fs.readFileSync(fp, "utf8");
  const content = fp.endsWith(".md") ? splitContent(raw).body : raw;
  const meta = buildMeta(fp, content, extract(content), cls(artifactType), NS, IDENTITY.authority, "2026-01-01T00:00:00.000Z", root, IDENTITY);
  injectFile(fp, meta, { dryRun: false, outDir: fs.mkdtempSync(path.join(os.tmpdir(), "l9-managed-out-")), verbose: false, writeInjectLog: false });
  const drafts = nativeMetadataExtractor.extract({
    subjectId: "artifact:x",
    sourcePath: fileName,
    content: fs.readFileSync(fp, "utf8"),
    contentHash: "sha256:0",
    pathExists: () => false,
    report: () => undefined,
  });
  return { meta: meta as unknown as Record<string, unknown>, drafts };
}

/** Annotate a fresh tree with the inventory writer, then read every header back. */
function inventoryRoundTrip(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "l9-managed-inv-"));
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(root, name), body);
  inventoryTree({
    root, outDir: fs.mkdtempSync(path.join(os.tmpdir(), "l9-managed-inv-out-")),
    writeSidecars: false, folderSidecars: false, now: "2026-01-01T00:00:00.000Z",
  });
  return Object.keys(files).map((name) => nativeMetadataExtractor.extract({
    subjectId: "artifact:x",
    sourcePath: name,
    content: fs.readFileSync(path.join(root, name), "utf8"),
    contentHash: "sha256:0",
    pathExists: () => false,
    report: () => undefined,
  }));
}

const INVENTORY_DRAFTS = inventoryRoundTrip({ "research-skill.md": "## Role\nAn agent.\n", "tool.py": "print(1)\n" });

const ROUND_TRIPS = [
  roundTrip("research-skill.md", "## Role\nAn agent.\n", "skill"),
  roundTrip("research-prompt.md", "## Role\nAn agent.\n", "prompt"),
  roundTrip("policy-doctrine.md", "# Policy\nA rule.\n", "doctrine"),
  roundTrip("tool.py", "print(1)\n", "source"),
];

/** The union of an enum written in src/schema.ts, read from the source text. */
function schemaUnion(name: string): string[] {
  const text = fs.readFileSync(path.join(REPO, "src/schema.ts"), "utf8");
  const match = new RegExp(`export type ${name} =([^;]+);`).exec(text);
  if (!match) throw new Error(`type ${name} not found in src/schema.ts`);
  return [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
}

describe("managed-header vocabulary contract (ADR-086)", () => {
  test("names a versioned identity the consumer can bind to", () => {
    expect(CONTRACT.vocabulary).toBe("l9-meta-injector:managed-header");
    expect(CONTRACT.identity).toBe(`${CONTRACT.vocabulary}@${CONTRACT.version}`);
    expect(CONTRACT.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(CONTRACT.definition_ref_form).toBe(`${CONTRACT.identity}#fields.<field>`);
    expect(CONTRACT.declared_schema).toBe(MANAGED_DECLARED_SCHEMA);
    expect(CONTRACT.meaning.projection).toBe("none");
    expect(CONTRACT.fields).toHaveLength(13);
  });

  test("every field the extractor assigns meaning to is a contract field, under the contract's category", () => {
    const read = new Map<string, string>();
    for (const { drafts } of ROUND_TRIPS) {
      for (const { predicate } of drafts) {
        const match = /^meta\.managed\.(identity|classification|governance)\.([a-z_]+)$/.exec(predicate);
        if (match) read.set(match[2], match[1]);
      }
    }
    // With a bound owner and a detected family, all thirteen fields are read back as values.
    expect([...read.keys()].sort()).toEqual([...FIELD.keys()].sort());
    for (const [field, category] of read) expect(FIELD.get(field)?.category, field).toBe(category);
  });

  test("every written field is either a contract field or listed as written outside the vocabulary", () => {
    const outside = new Set(CONTRACT.unresolved_and_out_of_vocabulary.written_outside_vocabulary.annotate);
    const written = new Set<string>();
    for (const { meta, drafts } of ROUND_TRIPS) {
      for (const key of Object.keys(meta)) {
        written.add(key);
        expect(FIELD.has(key) || outside.has(key), key).toBe(true);
      }
      for (const draft of drafts.filter((item) => item.predicate === "meta.managed.unsupported_field")) {
        expect(outside.has(draft.object), draft.object).toBe(true);
      }
    }
    for (const field of FIELD.keys()) expect(written.has(field), field).toBe(true);
    for (const key of outside) expect(written.has(key), key).toBe(true);
  });

  test("declared values stay inside each field's allowed values", () => {
    for (const { drafts } of ROUND_TRIPS) {
      for (const { predicate, object } of drafts) {
        const field = /^meta\.managed\.[a-z]+\.([a-z_]+)$/.exec(predicate)?.[1];
        const allowed = field ? FIELD.get(field)?.allowed_values : undefined;
        if (allowed) expect(allowed, `${field}=${object}`).toContain(object);
      }
    }
  });

  test("enum and boolean values match the producer's types and taxonomy", () => {
    expect(FIELD.get("artifact_type")?.allowed_values).toEqual(schemaUnion("ArtifactType"));
    expect(FIELD.get("artifact_type")?.allowed_values).toEqual(Object.keys(PRIMITIVE_TAXONOMY));
    expect(FIELD.get("mcp_primitive")?.allowed_values).toEqual(schemaUnion("McpPrimitive"));
    expect(FIELD.get("sharing_scope")?.allowed_values).toEqual(schemaUnion("SharingScope"));
    // "Unknown" is how the writer records an undetected family; it is read back as unresolved, never as a value.
    expect(FIELD.get("family")?.allowed_values).toEqual(schemaUnion("ArtifactFamily").filter((value) => value !== "Unknown"));
    for (const field of ["callable", "retrievable", "injectable"]) {
      expect(FIELD.get(field)).toMatchObject({ value_kind: "boolean", allowed_values: ["true", "false"] });
    }
    const taxonomy = Object.fromEntries(Object.entries(PRIMITIVE_TAXONOMY).map(([type, entry]) => [
      type, { mcp_primitive: entry.mcpPrimitive, callable: entry.callable, injectable: entry.injectable },
    ]));
    expect(CONTRACT.writer_invariants.taxonomy).toEqual(taxonomy);
  });

  test("family and owner presence by artifact type matches the writer's variants", () => {
    const covered = [...CONTRACT.variants.family, ...CONTRACT.variants.owner, ...CONTRACT.variants.neither].sort();
    expect(covered).toEqual(Object.keys(PRIMITIVE_TAXONOMY).sort());
    for (const type of Object.keys(PRIMITIVE_TAXONOMY) as ArtifactType[]) {
      const meta = buildMeta("x.md", "body\n", extract("body\n"), cls(type), NS, IDENTITY.authority, "2026-01-01T00:00:00.000Z", undefined, IDENTITY) as unknown as Record<string, unknown>;
      expect("family" in meta, `${type} family`).toBe(CONTRACT.variants.family.includes(type));
      expect("owner" in meta, `${type} owner`).toBe(CONTRACT.variants.owner.includes(type));
      expect(meta.retrievable, `${type} retrievable`).toBe(meta.injectable);
    }
  });

  test("the inventory writer stays inside the contract: no family or owner, and only its listed extra fields", () => {
    expect(CONTRACT.writers.map((entry) => entry.writer)).toEqual(["annotate", "inventory"]);
    const outside = new Set(CONTRACT.unresolved_and_out_of_vocabulary.written_outside_vocabulary.inventory);
    const valued = new Set<string>();
    const outsideKeys = new Set<string>();
    for (const drafts of INVENTORY_DRAFTS) {
      expect(drafts.length).toBeGreaterThan(0);
      for (const { predicate, object } of drafts) {
        const match = /^meta\.managed\.(identity|classification|governance)\.([a-z_]+)$/.exec(predicate);
        if (match) {
          valued.add(match[2]);
          expect(FIELD.get(match[2])?.category, match[2]).toBe(match[1]);
          const allowed = FIELD.get(match[2])?.allowed_values;
          if (allowed) expect(allowed, `${match[2]}=${object}`).toContain(object);
        }
        // An out-of-vocabulary key with no value (here an unavailable created_at) is unresolved, not unsupported.
        if (predicate === "meta.managed.unsupported_field") outsideKeys.add(object);
        if (predicate === "meta.managed.unresolved_field" && !FIELD.has(object)) outsideKeys.add(object);
      }
    }
    expect(valued.has("family")).toBe(false);
    expect(valued.has("owner")).toBe(false);
    for (const field of ["id", "title", "source_path", "artifact_type", "mcp_primitive", "callable", "retrievable", "injectable", "sharing_scope"]) {
      expect(valued.has(field), field).toBe(true);
    }
    expect([...outsideKeys].sort()).toEqual([...outside].sort());
    const id = INVENTORY_DRAFTS[0].find((draft) => draft.predicate === "meta.managed.identity.id")?.object;
    expect(id).toMatch(/^inv-[0-9a-f]{16}$/);
  });

  test("a claim object is the decoded scalar, not its quoted lexical form", () => {
    const { meta, drafts } = roundTrip("a: b.md", "## Role\nAn agent.\n", "skill");
    const title = drafts.find((draft) => draft.predicate === "meta.managed.identity.title")?.object;
    expect(title).toBe(meta.title);
    expect(title).toBe("a: b");
  });
});
