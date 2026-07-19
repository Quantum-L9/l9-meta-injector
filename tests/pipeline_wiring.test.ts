import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { runPipelineAsync } from "../src/pipeline";
import { hasAllPlanes } from "../src/meta_v3";
import { PipelineConfig } from "../src/schema";

function tmpDir() { const d = path.join(os.tmpdir(), `l9-wire-${Date.now()}-${Math.random().toString(36).slice(2)}`); fs.mkdirSync(d, { recursive: true }); return d; }

const SKILL_MD = `## Role
Senior auditor agent reviewing code for lint violations.

## Constraints
- Must produce structured output

## Validation Gates
- All findings have line numbers

## Stop Conditions
- Error count > 100
`;

test("pipeline wires in semantic classifier, placement compiler, and MetaV3 (DWL-001/002/003)", async () => {
  const root = tmpDir(); const out = tmpDir();
  const skills = path.join(root, "skills"); fs.mkdirSync(skills);
  fs.writeFileSync(path.join(skills, "lint_file.md"), SKILL_MD);

  const cfg: PipelineConfig = {
    root, glob: "**/*.md", dryRun: false, outDir: out, namespace: "l9",
    authority: "l9.doctrine.platform", nearDupThreshold: 0.9, hashPrefixLength: 16,
    indexDir: out, verbose: false, llmEnabled: false, normalizeFilenames: false,
  };

  const result = await runPipelineAsync(cfg);
  expect(result.injected.length).toBeGreaterThan(0);

  // DWL-002: a placement plan per injected artifact.
  expect(result.placementPlans.length).toBe(result.injected.length);
  const plan = result.placementPlans[0];
  expect(plan.targetPath.length).toBeGreaterThan(0);
  expect(plan.writesRequired).toBe(false); // advisory only, never writes

  // DWL-001 + DWL-003: a complete v3 record per artifact, carrying its semantic class.
  expect(result.metaV3.length).toBe(result.injected.length);
  const rec = result.metaV3[0];
  expect(rec.semanticClass).toBe("skill_definition"); // 17-class classifier reached the pipeline
  expect(hasAllPlanes(rec.metaV3)).toBe(true);
  expect(rec.metaV3.lineage.schema_version).toBe(3);
  // placement plane is fed by the placement compiler
  expect(rec.metaV3.placement.output_path).toBe(
    result.placementPlans.find((p) => p.sourcePath === rec.sourcePath)!.targetPath,
  );

  // Both new index artifacts are emitted.
  expect(fs.existsSync(path.join(out, "placement-plan.json"))).toBe(true);
  expect(fs.existsSync(path.join(out, "meta-v3-index.json"))).toBe(true);
  const onDisk = JSON.parse(fs.readFileSync(path.join(out, "meta-v3-index.json"), "utf8"));
  expect(Array.isArray(onDisk)).toBe(true);
  expect(onDisk[0].metaV3.identity.id).toBe(rec.metaV3.identity.id);
}, 15000);

test("dry-run computes wiring in-memory but writes no index files", async () => {
  const root = tmpDir(); const out = tmpDir();
  const skills = path.join(root, "skills"); fs.mkdirSync(skills);
  fs.writeFileSync(path.join(skills, "lint_file.md"), SKILL_MD);

  const cfg: PipelineConfig = {
    root, glob: "**/*.md", dryRun: true, outDir: out, namespace: "l9",
    authority: "l9.doctrine.platform", nearDupThreshold: 0.9, hashPrefixLength: 16,
    indexDir: out, verbose: false, llmEnabled: false, normalizeFilenames: false,
  };

  const result = await runPipelineAsync(cfg);
  expect(result.metaV3.length).toBe(result.injected.length);
  expect(fs.existsSync(path.join(out, "meta-v3-index.json"))).toBe(false);
  expect(fs.existsSync(path.join(out, "placement-plan.json"))).toBe(false);
}, 15000);
