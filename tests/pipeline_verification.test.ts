import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { runPipelineAsync } from "../src/pipeline";
import { PipelineConfig } from "../src/schema";

function tmpDir() { const d = path.join(os.tmpdir(), `l9-verify-${Date.now()}-${Math.random().toString(36).slice(2)}`); fs.mkdirSync(d, { recursive: true }); return d; }

const SKILL_MD = `## Role
Senior auditor agent reviewing code for lint violations.

## Constraints
- Must produce structured output

## Validation Gates
- All findings have line numbers

## Stop Conditions
- Error count > 100
`;

// A prompt file that is missing every required prompt-schema field → verify() must
// report issues, giving us a deterministic verification failure through the pipeline.
const INCOMPLETE_PROMPT_MD = `Some freeform prose with no role, objective, inputs, output format, or model target.
`;

function cfgFor(root: string, out: string): PipelineConfig {
  return {
    root, glob: "**/*.md", dryRun: false, outDir: out, namespace: "l9",
    authority: "l9.doctrine.platform", nearDupThreshold: 0.9, hashPrefixLength: 16,
    indexDir: out, verbose: false, llmEnabled: false, normalizeFilenames: false,
  };
}

test("verification summary is consumed and internally consistent (OBS-002)", async () => {
  const root = tmpDir(); const out = tmpDir();
  const skills = path.join(root, "skills"); fs.mkdirSync(skills);
  fs.writeFileSync(path.join(skills, "lint_file.md"), SKILL_MD);

  const result = await runPipelineAsync(cfgFor(root, out));

  // The verification signal is now part of the result — not swallowed into a file.
  expect(result.verification).toBeDefined();
  const expectedFailures = result.verified.filter((v) => v.issues.length > 0);
  expect(result.verification.total).toBe(result.verified.length);
  expect(result.verification.withIssues).toBe(expectedFailures.length);
  expect(result.verification.clean).toBe(result.verification.total - result.verification.withIssues);
  expect(result.verification.passed).toBe(expectedFailures.length === 0);
  expect(result.verification.failures.map((f) => f.sourcePath).sort())
    .toEqual(expectedFailures.map((v) => v.sourcePath).sort());
}, 15000);

test("a file that fails verification flips passed=false and is listed (OBS-002)", async () => {
  const root = tmpDir(); const out = tmpDir();
  const prompts = path.join(root, "prompts"); fs.mkdirSync(prompts);
  const fp = path.join(prompts, "Prompt-Incomplete.md");
  fs.writeFileSync(fp, INCOMPLETE_PROMPT_MD);

  const result = await runPipelineAsync(cfgFor(root, out));

  expect(result.verification.passed).toBe(false);
  expect(result.verification.withIssues).toBeGreaterThanOrEqual(1);
  const failure = result.verification.failures.find((f) => f.sourcePath === fp);
  expect(failure).toBeDefined();
  expect(failure!.issues.length).toBeGreaterThan(0);
}, 15000);
