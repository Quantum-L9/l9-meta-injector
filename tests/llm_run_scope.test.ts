// llm_run_scope.test.ts — WU-014 / RC-018 / F-032 (ADR-064).
//
// Each pipeline or skills run uses only the LLM adapter it configured, and its own
// metrics collector. A run never changes the adapter observed outside it, so runs
// cannot cross-wire endpoints or credentials, and a finished run's adapter cannot
// leak into a later one.
import * as fs from "node:fs";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { getAdapter, localAdapter, resetAdapter, setAdapter, type LlmAdapter } from "../src/llm";
import { runPipelineAsync } from "../src/pipeline";
import type { PipelineConfig } from "../src/schema";
import { runSkillsPipelineAsync } from "../src/skills_pipeline";

const dirs: string[] = [];
function tmpDir(prefix = "l9-wu014-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

beforeEach(() => resetAdapter());
afterEach(() => {
  resetAdapter();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

interface FakeServer { baseUrl: string; authorizations: string[]; close: () => Promise<void> }

/** OpenAI-compatible endpoint on loopback that records every Authorization header. */
async function fakeChatServer(delayMs = 5): Promise<FakeServer> {
  const authorizations: string[] = [];
  const server = http.createServer((req, res) => {
    authorizations.push(String(req.headers.authorization ?? ""));
    let raw = "";
    req.on("data", (chunk) => { raw += String(chunk); });
    req.on("end", () => {
      const body = JSON.parse(raw) as { messages?: Array<{ content?: string }> };
      const prompt = (body.messages ?? []).map((m) => m.content ?? "").join("\n");
      let content = "no";
      if (prompt.includes("trigger phrases")) content = "alpha phrase, beta phrase";
      else if (prompt.includes("describing what this artifact does")) content = "Summarises release notes into a short changelog digest for maintainers.";
      setTimeout(() => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ choices: [{ message: { content } }] }));
      }, delayMs);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    authorizations,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** A tree of weak prose files: every file asks the adapter for description and signals. */
function proseTree(count: number): string {
  const root = tmpDir();
  for (let i = 0; i < count; i++) fs.writeFileSync(path.join(root, `note_${i}.md`), `# Note ${i}\n\nPlain notes.\n`);
  return root;
}

function pipelineConfig(root: string, overrides: Partial<PipelineConfig> = {}): PipelineConfig {
  const out = `${root}.out`;
  dirs.push(out);
  return {
    root, glob: "**/*.md", dryRun: true, outDir: out, indexDir: out, namespace: "l9",
    authority: "l9.doctrine.platform", nearDupThreshold: 0.9, hashPrefixLength: 16,
    verbose: false, llmEnabled: false, normalizeFilenames: false, persistOutputs: false,
    ...overrides,
  };
}

function credentialed(server: FakeServer, key: string): Partial<PipelineConfig> {
  return { llmEnabled: true, llmBaseUrl: server.baseUrl, llmApiKey: key, llmModel: "fake", llmAllowInsecure: true };
}

function weakSkillTree(): string {
  const root = tmpDir();
  const dir = path.join(root, "skills", "review");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), "---\nname: review\ndescription: Reviews stuff\n---\n\n# Review\n\nCheck PRs carefully.\n");
  return root;
}

const callerAdapter: LlmAdapter = {
  estimateTokens: (t) => Math.ceil(t.length / 4),
  classify: async (prompt: string) => {
    if (prompt.includes("materially more informative")) return "yes";
    if (prompt.includes("Cursor Agent Skill description")) {
      return "Reviews pull requests for quality. Use when reviewing PRs, code changes, or when the user asks for a code review.";
    }
    if (prompt.includes("trigger phrases")) return "code review, pull request, PR review";
    return null;
  },
};

describe("WU-014: per-run LLM adapter scope", () => {
  test("REG-WU-014-RC-018-a: concurrent credentialed runs reach only their own endpoint with their own key and metrics", async () => {
    const x = await fakeChatServer();
    const y = await fakeChatServer();
    try {
      const [b, c] = await Promise.all([
        runPipelineAsync(pipelineConfig(proseTree(1), credentialed(x, "KEY-B"))),
        runPipelineAsync(pipelineConfig(proseTree(5), credentialed(y, "KEY-C"))),
      ]);
      expect(x.authorizations.length).toBeGreaterThan(0);
      expect(y.authorizations.length).toBeGreaterThan(0);
      expect(new Set(x.authorizations)).toEqual(new Set(["Bearer KEY-B"]));
      expect(new Set(y.authorizations)).toEqual(new Set(["Bearer KEY-C"]));
      // Both trees hold identical weak files, so each endpoint serves its own run's
      // per-file calls: 1 file on X and 5 on Y.
      expect(y.authorizations.length).toBe(5 * x.authorizations.length);
      expect(b.metrics.llmCalls).toBe(x.authorizations.length);
      expect(c.metrics.llmCalls).toBe(y.authorizations.length);
    } finally {
      await x.close();
      await y.close();
    }
  }, 30000);

  test("REG-WU-014-RC-018-b: a concurrent non-LLM run does not strip the LLM run of its adapter", async () => {
    const x = await fakeChatServer();
    try {
      const [llm] = await Promise.all([
        runPipelineAsync(pipelineConfig(proseTree(3), credentialed(x, "KEY-X"))),
        runPipelineAsync(pipelineConfig(proseTree(3))),
      ]);
      expect(llm.metrics.decisionPaths.no_adapter).toBe(0);
      expect(llm.metrics.llmCalls).toBe(x.authorizations.length);
      expect(llm.metrics.llmCalls).toBeGreaterThan(0);
    } finally {
      await x.close();
    }
  }, 30000);

  test("REG-WU-014-RC-018-c: a run leaves a caller-installed adapter in place whether it completes or throws", async () => {
    const x = await fakeChatServer();
    try {
      setAdapter(callerAdapter);
      await runPipelineAsync(pipelineConfig(proseTree(1), credentialed(x, "KEY-X")));
      expect(getAdapter()).toBe(callerAdapter);
      await runPipelineAsync(pipelineConfig(proseTree(1)));
      expect(getAdapter()).toBe(callerAdapter);

      const colliding = tmpDir();
      fs.writeFileSync(path.join(colliding, "a-b.md"), "## A\nbody\n");
      fs.writeFileSync(path.join(colliding, "a_b.md"), "## B\nbody\n");
      await expect(runPipelineAsync(pipelineConfig(colliding, credentialed(x, "KEY-X")))).rejects.toThrow(/DUPLICATE_METADATA_ID/);
      expect(getAdapter()).toBe(callerAdapter);
      await expect(runPipelineAsync(pipelineConfig(colliding))).rejects.toThrow(/DUPLICATE_METADATA_ID/);
      expect(getAdapter()).toBe(callerAdapter);
    } finally {
      await x.close();
    }
  }, 30000);

  test("REG-WU-014-RC-018-d: a finished credentialed run's adapter does not leak into a later skills run without credentials", async () => {
    const x = await fakeChatServer();
    try {
      await runPipelineAsync(pipelineConfig(proseTree(1), credentialed(x, "KEY-A")));
      const before = x.authorizations.length;
      expect(before).toBeGreaterThan(0);

      const root = weakSkillTree();
      const out = tmpDir();
      const result = await runSkillsPipelineAsync({
        root, authority: "l9.doctrine.platform", outDir: out, dryRun: true, verbose: false, llmEnabled: true,
      });
      expect(x.authorizations.length).toBe(before);
      expect(result.metrics.llmCalls).toBe(0);
      expect(result.metrics.decisionPaths.no_adapter).toBeGreaterThan(0);
      expect(getAdapter()).toBe(localAdapter);
    } finally {
      await x.close();
    }
  }, 30000);

  test("REG-WU-014-RC-018-e: a skills run with llmEnabled and no credentials still consults the caller-installed adapter", async () => {
    setAdapter(callerAdapter);
    const root = weakSkillTree();
    const out = tmpDir();
    const result = await runSkillsPipelineAsync({
      root, authority: "l9.doctrine.platform", outDir: out, dryRun: true, verbose: false, llmEnabled: true,
    });
    expect(result.considered).toBe(1);
    expect(result.changed).toBe(1);
    const descriptionDiff = result.files[0]?.diffs.find((d) => d.field === "description");
    expect(String(descriptionDiff?.newValue)).toMatch(/Use when/);
    expect(result.metrics.decisionPaths.no_adapter).toBe(0);
    expect(getAdapter()).toBe(callerAdapter);
  }, 30000);

  test("REG-WU-014-RC-018-f: with no run active, setAdapter/getAdapter/resetAdapter keep their global semantics", () => {
    expect(getAdapter()).toBe(localAdapter);
    setAdapter(callerAdapter);
    expect(getAdapter()).toBe(callerAdapter);
    resetAdapter();
    expect(getAdapter()).toBe(localAdapter);
    expect(localAdapter.classify).toBeUndefined();
  });
});
