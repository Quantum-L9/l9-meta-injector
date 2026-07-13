import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { parseCanonicalYaml, toMetaSchema, applySchema, MetaSchema } from "../src/meta_schema";
import { inventoryTree, loadMetaSchema } from "../src/inventory";

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), "l9-ms-")); }

describe("parseCanonicalYaml — constrained YAML subset", () => {
  const y = `
# comment line
schema_id: demo
version: 1.2.3
description: "a: quoted, string"
flag: true
count: 7
ratio: 0.5
nothing: null
target: [file_header, sidecar, manifest]
fields:
  - name: id
    source: artifact_id
    required: true
  - name: owner
    default: "Unknown"
`;
  const o = parseCanonicalYaml(y);
  it("scalars: string/bool/int/float/null", () => {
    expect(o.schema_id).toBe("demo");
    expect(o.version).toBe("1.2.3");
    expect(o.flag).toBe(true);
    expect(o.count).toBe(7);
    expect(o.ratio).toBe(0.5);
    expect(o.nothing).toBeNull();
  });
  it("quoted string keeps punctuation", () => expect(o.description).toBe("a: quoted, string"));
  it("a '#' inside a quoted string is not treated as a comment", () => {
    expect(parseCanonicalYaml('description: "hello # world"').description).toBe("hello # world");
    expect(parseCanonicalYaml("note: 'a # b'").note).toBe("a # b");
    expect(parseCanonicalYaml("key: value # trailing comment").key).toBe("value");
  });
  it("double-quoted escape sequences are unescaped", () => {
    expect(parseCanonicalYaml('winpath: "C:\\\\tmp\\\\x"').winpath).toBe("C:\\tmp\\x");
    expect(parseCanonicalYaml('multiline: "a\\nb"').multiline).toBe("a\nb");
    expect(parseCanonicalYaml("quoted: 'it''s'").quoted).toBe("it's");
  });
  it("nested maps (depth > 2) fail fast instead of silently flattening", () => {
    expect(() => parseCanonicalYaml("outer:\n  inner:\n    deep: 1")).toThrow(/nested map/i);
  });
  it("inline list", () => expect(o.target).toEqual(["file_header", "sidecar", "manifest"]));
  it("list of maps", () => {
    expect(Array.isArray(o.fields)).toBe(true);
    const f = o.fields as Array<Record<string, unknown>>;
    expect(f).toHaveLength(2);
    expect(f[0]).toEqual({ name: "id", source: "artifact_id", required: true });
    expect(f[1]).toEqual({ name: "owner", default: "Unknown" });
  });
});

describe("toMetaSchema — validation", () => {
  it("builds a schema", () => {
    const s = toMetaSchema(parseCanonicalYaml("schema_id: x\nfields:\n  - name: id\n    source: artifact_id\n"));
    expect(s.schema_id).toBe("x");
    expect(s.fields[0].name).toBe("id");
    expect(s.target).toContain("file_header"); // default target when omitted
  });
  it("throws without schema_id", () => expect(() => toMetaSchema(parseCanonicalYaml("fields:\n  - name: id\n"))).toThrow(/schema_id/));
  it("throws without fields", () => expect(() => toMetaSchema(parseCanonicalYaml("schema_id: x\n"))).toThrow(/fields/));
});

describe("applySchema — source resolution, defaults, required", () => {
  const schema: MetaSchema = {
    schema_id: "t", version: "1", target: ["file_header"],
    fields: [
      { name: "id", source: "artifact_id", required: true },
      { name: "type", source: "artifact_type" },
      { name: "owner", default: "Unknown", required: true },
      { name: "missing", source: "not_a_field", required: true },
    ],
  };
  it("resolves source, applies default, flags missing required", () => {
    const rec = { artifact_id: "inv-1", artifact_type: "code" };
    const { fields, missingRequired } = applySchema(rec, schema);
    expect(fields.id).toBe("inv-1");
    expect(fields.type).toBe("code");
    expect(fields.owner).toBe("Unknown");     // default filled
    expect(fields.missing).toBeNull();         // no source, no default
    expect(missingRequired).toEqual(["missing"]);
  });
});

describe("inventory + schema + dedup integration", () => {
  it("emits schema-defined header fields and a duplicate cluster", () => {
    const root = tmp();
    fs.mkdirSync(path.join(root, "a")); fs.mkdirSync(path.join(root, "b"));
    fs.writeFileSync(path.join(root, "a", "g.md"), "# D\nhello\n");
    fs.writeFileSync(path.join(root, "b", "g2.md"), "# D\nhello\n"); // duplicate content
    fs.writeFileSync(path.join(root, "app.ts"), "const x=1;\n");
    const out = tmp();
    const schema: MetaSchema = {
      schema_id: "s", version: "1", target: ["file_header", "sidecar", "manifest"],
      fields: [
        { name: "id", source: "artifact_id", required: true },
        { name: "review_status", default: "unreviewed" },
      ],
    };
    const r = inventoryTree({ root, outDir: out, schema, now: "2026-01-01T00:00:00.000Z" });

    // custom header fields present, built-in injector fields absent
    const ts = fs.readFileSync(path.join(root, "app.ts"), "utf8");
    expect(ts).toContain("// review_status: unreviewed");
    expect(ts).not.toContain("mcp_primitive");
    // dedup detected the two identical markdown files
    expect(r.duplicates).toHaveLength(1);
    expect(r.duplicates[0].count).toBe(2);
    expect(r.duplicates[0].keeper).toBe("a/g.md");
    expect(fs.existsSync(path.join(out, "inventory-duplicates.json"))).toBe(true);
  });

  it("rejects outDir === root (would re-inventory its own manifests)", () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, "a.ts"), "const x=1;\n");
    expect(() => inventoryTree({ root, outDir: root, now: "2026-01-01T00:00:00.000Z" })).toThrow(/outDir/i);
  });

  it("target=[sidecar,manifest] does NOT inject headers into files", () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, "app.ts"), "const y=2;\n");
    const out = tmp();
    const schema: MetaSchema = { schema_id: "m", version: "1", target: ["sidecar", "manifest"], fields: [{ name: "id", source: "artifact_id", required: true }] };
    inventoryTree({ root, outDir: out, schema, now: "2026-01-01T00:00:00.000Z" });
    expect(fs.readFileSync(path.join(root, "app.ts"), "utf8")).toBe("const y=2;\n"); // untouched
    expect(fs.existsSync(path.join(root, "app.ts.l9meta.yaml"))).toBe(true);          // sidecar instead
  });

  it("loadMetaSchema reads the shipped example schema file", () => {
    const s = loadMetaSchema(path.join(__dirname, "..", "examples", "meta-schema.example.yaml"));
    expect(s.schema_id).toBe("inventory_example");
    expect(s.fields.length).toBeGreaterThan(5);
  });
});
