/**
 * WU-015 — LLM assist results are normalised to the declared field shape
 * (RC-019 / F-033).
 *
 * `assistField` returned the trimmed reply string for every prose-origin field, so an
 * LLM-assisted `activation_signals` (typed `string[] | Unknown`) was first written as a
 * comma string, and the next run's reconcile rewrote it as a list: the header was not
 * idempotent.
 */
import * as fs from "node:fs";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { assistField, DEFAULT_ASSIST_CONFIG } from "../src/assist";
import { resetAdapter, setAdapter } from "../src/llm";
import { MetricsCollector } from "../src/metrics";
import { runPipelineAsync } from "../src/pipeline";
import { UNKNOWN, type PipelineConfig } from "../src/schema";
import { runSkillsPipelineAsync } from "../src/skills_pipeline";

const dirs: string[] = [];

function tmpDir(prefix = "l9-wu015-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  resetAdapter();
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(`${dir}.out`, { recursive: true, force: true });
  }
});

const ENABLED = { ...DEFAULT_ASSIST_CONFIG, enabled: true };

function replying(reply: string): void {
  setAdapter({ estimateTokens: () => 1, classify: async () => reply });
}

describe("WU-015 assistField shapes list-typed fields", () => {
  test("REG-WU-015-RC-019-a: activation_signals resolves to a trimmed, de-duplicated list", async () => {
    replying("a, b, b ,c");
    const result = await assistField("activation_signals", UNKNOWN, "body", ENABLED);
    expect(result).toEqual(["a", "b", "c"]);
  });

  test("REG-WU-015-RC-019-c: a reply with no usable item falls back to the seed and records llm_failed_fallback", async () => {
    replying(" , ;\n");
    const metrics = new MetricsCollector();
    const result = await assistField("activation_signals", UNKNOWN, "body", ENABLED, metrics);
    expect(result).toBe(UNKNOWN);
    const paths = metrics.snapshot().decisionPaths;
    expect(paths.llm_failed_fallback).toBe(1);
    expect(paths.llm_ok).toBe(0);
  });

  test("REG-WU-015-RC-019-d: description stays a trimmed string", async () => {
    replying("  Processes documents and emits output for retrieval.  ");
    const result = await assistField("description", UNKNOWN, "processes docs", ENABLED);
    expect(result).toBe("Processes documents and emits output for retrieval.");
  });
});

/** Deterministic OpenAI-compatible chat-completions endpoint on loopback. */
async function fakeChatServer(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => { raw += String(chunk); });
    req.on("end", () => {
      const body = JSON.parse(raw) as { messages?: Array<{ content?: string }> };
      const prompt = (body.messages ?? []).map((m) => m.content ?? "").join("\n");
      let content = "";
      if (prompt.includes("trigger phrases")) content = "alpha phrase, beta phrase, gamma phrase";
      else if (prompt.includes("describing what this artifact does")) content = "Summarises release notes into a short changelog digest for maintainers.";
      else content = "no";
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content } }] }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe("WU-015 assisted pipeline writes are idempotent", () => {
  test("REG-WU-015-RC-019-b: activation_signals is a list on first write and a second run changes no bytes", async () => {
    const server = await fakeChatServer();
    try {
      const root = tmpDir();
      const fp = path.join(root, "notes.md");
      fs.writeFileSync(fp, "# Notes\n\nPlain notes.\n");
      const out = `${root}.out`;
      const config: PipelineConfig = {
        root, glob: "**/*.md", dryRun: false, outDir: out, indexDir: out, namespace: "l9",
        authority: "l9.doctrine.platform", nearDupThreshold: 0.9, hashPrefixLength: 16,
        verbose: false, llmEnabled: true, normalizeFilenames: false,
        llmBaseUrl: server.baseUrl, llmApiKey: "test-key", llmModel: "fake", llmAllowInsecure: true,
      };

      const first = await runPipelineAsync(config);
      expect(first.injected[0]?.meta.activation_signals).toEqual(["alpha phrase", "beta phrase", "gamma phrase"]);
      const afterFirst = fs.readFileSync(fp, "utf8");

      await runPipelineAsync(config);
      expect(fs.readFileSync(fp, "utf8")).toBe(afterFirst);
    } finally {
      await server.close();
    }
  }, 30000);
});

describe("WU-015 skills mode is unchanged", () => {
  test("REG-WU-015-RC-019-e: skills activation_signals list is identical to the parsed reply", async () => {
    const root = tmpDir();
    const dir = path.join(root, "skills", "reviewer");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "SKILL.md"), "---\nname: reviewer\ndescription: Reviews stuff\n---\n\n# reviewer\n\nCheck things carefully.\n");
    setAdapter({
      estimateTokens: (t) => Math.ceil(t.length / 4),
      classify: async (prompt: string) => {
        if (prompt.includes("materially more informative")) return "yes";
        if (prompt.includes("Cursor Agent Skill description")) {
          return "Reviews pull requests for quality. Use when reviewing PRs, code changes, or when the user asks for a code review.";
        }
        if (prompt.includes("trigger phrases")) return "code review, pull request, PR review";
        return null;
      },
    });
    const result = await runSkillsPipelineAsync({
      root, authority: "l9.auto", dryRun: true, outDir: `${root}.out`, verbose: false, llmEnabled: true,
    });
    const signals = result.files[0]?.diffs.find((d) => d.field === "activation_signals");
    expect(signals?.newValue).toEqual(["code review", "pull request", "PR review"]);
  });
});
