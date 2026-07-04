import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { runPipelineAsync } from "../src/pipeline";
import { PipelineConfig } from "../src/schema";

function tmpDir() { const d = path.join(os.tmpdir(), `l9-test-${Date.now()}`); fs.mkdirSync(d, { recursive: true }); return d; }

const SKILL_MD = `## Role
Senior auditor agent reviewing code for lint violations.

## Constraints
- Must produce structured output
- Must not modify source files

## Validation Gates
- All findings have line numbers
- Severity levels are classified

## Stop Conditions
- Error count > 100
`;

const PROMPT_MD = `## Role
Expert legal analyst

## Objective
Analyze contract clauses for compliance risks.

## Input Variables
- document_text: string
- jurisdiction: string

## Output Format
Structured JSON with findings

## Model Target
claude-3-5-sonnet
`;

test("pipeline injects headers and produces indexes", async () => {
  const root = tmpDir();
  const out = tmpDir();
  const skillsDir = path.join(root, "skills");
  fs.mkdirSync(skillsDir);
  fs.writeFileSync(path.join(skillsDir, "lint_file.md"), SKILL_MD);

  const promptsDir = path.join(root, "prompts");
  fs.mkdirSync(promptsDir);
  fs.writeFileSync(path.join(promptsDir, "Prompt-LegalAnalysis.md"), PROMPT_MD);

  const cfg: PipelineConfig = {
    root, glob: "**/*.md", dryRun: false, outDir: out, namespace: "l9",
    authority: "l9.doctrine.platform", nearDupThreshold: 0.9, hashPrefixLength: 16,
    indexDir: out, verbose: false, llmEnabled: false, normalizeFilenames: false,
  };

  const result = await runPipelineAsync(cfg);
  expect(result.scanned.length).toBe(2);
  expect(result.injected.length).toBeGreaterThan(0);

  const injectedFile = path.join(skillsDir, "lint_file.md");
  const content = fs.readFileSync(injectedFile, "utf8");
  expect(content.startsWith("---")).toBe(true);
  expect(content).toContain("artifact_type:");
  expect(content).toContain("namespace: l9");
  expect(content).toContain("sharing_scope:");
  expect(content).toContain("id:");
}, 15000);

test("dry-run does not write to source files", async () => {
  const root = tmpDir();
  const out = tmpDir();
  const skillsDir = path.join(root, "skills");
  fs.mkdirSync(skillsDir);
  const fp = path.join(skillsDir, "test_skill.md");
  fs.writeFileSync(fp, SKILL_MD);
  const before = fs.readFileSync(fp, "utf8");

  const cfg: PipelineConfig = {
    root, glob: "**/*.md", dryRun: true, outDir: out, namespace: "l9",
    authority: "l9.doctrine.platform", nearDupThreshold: 0.9, hashPrefixLength: 16,
    indexDir: out, verbose: false, llmEnabled: false, normalizeFilenames: false,
  };

  await runPipelineAsync(cfg);
  expect(fs.readFileSync(fp, "utf8")).toBe(before);
}, 10000);
