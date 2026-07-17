import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { runPipelineAsync } from "../src/pipeline";
import { PipelineConfig } from "../src/schema";

function tmpDir() { const d = path.join(os.tmpdir(), `l9-cov-${Date.now()}-${Math.random().toString(36).slice(2)}`); fs.mkdirSync(d, { recursive: true }); return d; }

const SKILL_MD = `## Role
Auditor agent.

## Validation Gates
- All findings have line numbers
`;

test("coverage tally accounts for injected and skipped-non-injectable files (OBS-003)", async () => {
  const root = tmpDir(); const out = tmpDir();
  const skills = path.join(root, "skills"); fs.mkdirSync(skills);
  fs.writeFileSync(path.join(skills, "lint_file.md"), SKILL_MD);
  // A file under tests/ classifies as artifact_type "test" → injectable:false → skipped.
  const testsDir = path.join(root, "tests"); fs.mkdirSync(testsDir);
  const skippedPath = path.join(testsDir, "example_spec.md");
  fs.writeFileSync(skippedPath, "## Test fixture\nSome spec content.\n");

  const cfg: PipelineConfig = {
    root, glob: "**/*.md", dryRun: false, outDir: out, namespace: "l9",
    authority: "l9.doctrine.platform", nearDupThreshold: 0.9, hashPrefixLength: 16,
    indexDir: out, verbose: false, llmEnabled: false, normalizeFilenames: false,
  };

  const result = await runPipelineAsync(cfg);

  expect(result.coverage.scanned).toBe(2);
  expect(result.coverage.injected).toBe(result.injected.length);
  expect(result.coverage.injected).toBeGreaterThan(0);
  expect(result.coverage.skippedNonInjectable).toBe(1);
  expect(result.coverage.skipped.nonInjectable).toContain(skippedPath);
  expect(result.coverage.verifyFailed).toBe(result.verification.withIssues);

  // Internal consistency: every scanned file is either injected or skipped.
  const accounted = result.coverage.injected + result.coverage.skippedBinary + result.coverage.skippedNonInjectable;
  expect(accounted).toBe(result.coverage.scanned);
}, 15000);
