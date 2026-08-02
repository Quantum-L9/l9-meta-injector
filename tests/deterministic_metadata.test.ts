import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { extract } from "../src/extract";
import { buildMeta, serializeToYamlFrontMatter } from "../src/normalize_meta";
import type { ClassifyResult } from "../src/schema";
import { UNKNOWN } from "../src/schema";
import type { NamespaceConfig } from "../src/namespace";

const roots: string[] = [];
const namespace: NamespaceConfig = {
  namespace: "fixture",
  authority: "fixture.authority",
  nearDupThreshold: 0.9,
  hashPrefixLength: 16,
  outputDir: ".",
  indexDir: ".",
};
const classification: ClassifyResult = {
  artifactType: "prompt",
  family: "planner",
  signals: ["build"],
  confidence: "high",
};

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function makeRoot(prefix: string): { root: string; file: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(root);
  const file = path.join(root, "prompts", "build.md");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "# Build\n\nObjective: produce a plan.\n", "utf8");
  return { root, file };
}

describe("deterministic persisted metadata identity", () => {
  test("two checkout roots produce identical metadata bytes", () => {
    const first = makeRoot("l9-meta-a-");
    const second = makeRoot("l9-meta-b-");
    const body = fs.readFileSync(first.file, "utf8");
    const fields = extract(body);
    const a = buildMeta(first.file, body, fields, classification, namespace, "fixture.authority", UNKNOWN, first.root);
    const b = buildMeta(second.file, body, fields, classification, namespace, "fixture.authority", UNKNOWN, second.root);
    expect(a).toEqual(b);
    expect(a.source_path).toBe("prompts/build.md");
    expect(a.created_or_detected_at).toBe(UNKNOWN);
    expect(serializeToYamlFrontMatter(a)).toBe(serializeToYamlFrontMatter(b));
  });

  test("rejects a source path outside the declared repository root", () => {
    const first = makeRoot("l9-meta-root-");
    const outside = path.join(os.tmpdir(), "outside.md");
    const body = "outside";
    expect(() => buildMeta(outside, body, extract(body), classification, namespace, "fixture.authority", UNKNOWN, first.root)).toThrow(/escapes repository root/);
  });
});
