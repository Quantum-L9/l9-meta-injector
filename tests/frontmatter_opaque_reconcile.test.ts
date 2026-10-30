/**
 * WU-003 / RC-004 (finding F-003): opaque managed frontmatter values are visible to
 * reconciliation.
 *
 * An unquoted value the canonical scalar grammar declines (`2025-10-28T15:30:00Z`) is
 * carried as an *opaque* field: its bytes are known, its meaning is not, so it never
 * enters `inspection.meta` (ADR-035). Reconciliation used to read only `meta`, so for a
 * managed key it decided the new value without seeing the existing one, and the patcher
 * then wrote the incoming placeholder over a real user value. The quoted spelling of the
 * same value survived. These cases pin the corrected contract.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { injectFile } from "../src/inject";
import { buildMeta } from "../src/normalize_meta";
import { extract, splitContent } from "../src/extract";
import { classify } from "../src/classify";
import type { NamespaceConfig } from "../src/namespace";
import { UNKNOWN } from "../src/schema";
import {
  frontMatterReconciliationView,
  inspectFrontMatterDocument,
  opaqueFieldText,
  patchManagedFrontMatter,
} from "../src/frontmatter_patch";
import { runApplyAsync } from "../src/apply";
import type { CheckConfig } from "../src/check";
import { runSkillsPipelineAsync } from "../src/skills_pipeline";
import { harvestExistingMeta } from "../src/inventory_existing_meta";
import { resetAdapter, setAdapter } from "../src/llm";

const roots: string[] = [];

function tempDir(prefix = "l9-opaque-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

afterEach(() => {
  resetAdapter();
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(`${root}.out`, { recursive: true, force: true });
  }
});

const NS: NamespaceConfig = {
  namespace: "l9", authority: "l9.auto", nearDupThreshold: 0.9,
  hashPrefixLength: 16, outputDir: ".out", indexDir: ".",
};

/** Incoming meta as the pipeline builds it, with the placeholder timestamp. */
function incomingFor(fp: string) {
  const body = splitContent(fs.readFileSync(fp, "utf8")).body;
  return buildMeta(fp, body, extract(body), classify(fp, body, "none"), NS, "l9.auto", UNKNOWN);
}

function injectOnce(fp: string, dryRun = false) {
  return injectFile(fp, incomingFor(fp), { dryRun, outDir: tempDir("l9-opaque-out-"), verbose: false, writeInjectLog: false });
}

const UNQUOTED_NOTES = "---\ncreated_or_detected_at: 2025-10-28T15:30:00Z\n---\n# Notes\n";
const QUOTED_NOTES = '---\ncreated_or_detected_at: "2025-10-28T15:30:00Z"\n---\n# Notes\n';

const ISO_TIMESTAMP_DOC = `---
title: Runbook
created: 2025-10-28T15:30:00Z
owner: platform
---

# Runbook

Body text that must survive untouched.
`;

describe("WU-003 opaque managed values reconcile as their verbatim text", () => {
  test("REG-WU-003-RC-004-a: a real unquoted timestamp is kept over the Unknown placeholder, byte-identical", () => {
    const fp = path.join(tempDir(), "notes.md");
    fs.writeFileSync(fp, UNQUOTED_NOTES, "utf8");

    const incoming = incomingFor(fp);
    expect(incoming.created_or_detected_at).toBe(UNKNOWN);
    injectFile(fp, incoming, { dryRun: false, outDir: tempDir("l9-opaque-out-"), verbose: false, writeInjectLog: false });

    const after = fs.readFileSync(fp, "utf8");
    expect(after).toContain("\ncreated_or_detected_at: 2025-10-28T15:30:00Z\n");
    expect(after).not.toContain('created_or_detected_at: "Unknown"');
  });

  test("REG-WU-003-RC-004-b: quoted and unquoted spellings reconcile to the same string", () => {
    const root = tempDir();
    const plain = path.join(root, "plain.md");
    const quoted = path.join(root, "quoted.md");
    fs.writeFileSync(plain, UNQUOTED_NOTES, "utf8");
    fs.writeFileSync(quoted, QUOTED_NOTES, "utf8");

    const plainRec = injectOnce(plain, true);
    const quotedRec = injectOnce(quoted, true);

    expect(plainRec.meta.created_or_detected_at).toBe("2025-10-28T15:30:00Z");
    expect(quotedRec.meta.created_or_detected_at).toBe("2025-10-28T15:30:00Z");

    // The reconciliation view is where the unquoted spelling becomes visible.
    const inspected = inspectFrontMatterDocument(UNQUOTED_NOTES);
    expect(frontMatterReconciliationView(UNQUOTED_NOTES, inspected).created_or_detected_at).toBe("2025-10-28T15:30:00Z");
  });

  test("AC-WU-003-RC-004-03: the verbatim view sits beside inspection meta, never inside it", () => {
    const inspected = inspectFrontMatterDocument(ISO_TIMESTAMP_DOC);
    // ADR-035 — opaque values never enter parsed meta.
    expect(Object.hasOwn(inspected.meta, "created")).toBe(false);
    expect(opaqueFieldText(ISO_TIMESTAMP_DOC, inspected)).toEqual({ created: "2025-10-28T15:30:00Z" });
    const view = frontMatterReconciliationView(ISO_TIMESTAMP_DOC, inspected);
    expect(view).toEqual({ ...inspected.meta, created: "2025-10-28T15:30:00Z" });
    expect(Object.hasOwn(inspected.meta, "created")).toBe(false);
  });

  test("REG-WU-003-RC-004-c: an unmanaged opaque value stays byte-identical", () => {
    const inspected = inspectFrontMatterDocument(ISO_TIMESTAMP_DOC);
    expect(Object.hasOwn(inspected.meta, "created")).toBe(false);

    const patched = patchManagedFrontMatter(ISO_TIMESTAMP_DOC, { id: "artifact-1", artifact_type: "prompt" });
    expect(patched.safe).toBe(true);
    expect(patched.content).toContain("\ncreated: 2025-10-28T15:30:00Z\n");
  });

  test("REG-WU-003-RC-004-c: a managed opaque value equal to the managed value keeps its original bytes", () => {
    // AC-WU-003-RC-004-02
    const patched = patchManagedFrontMatter(ISO_TIMESTAMP_DOC, { created: "2025-10-28T15:30:00Z" });
    expect(patched.safe).toBe(true);
    expect(patched.content).toBe(ISO_TIMESTAMP_DOC);

    // A different managed value still replaces the opaque range wholesale (ADR-035).
    const replaced = patchManagedFrontMatter(ISO_TIMESTAMP_DOC, { created: "2026-01-01" });
    expect(replaced.content).toContain('created: "2026-01-01"');
  });

  test("REG-WU-003-RC-004-d: a second inject writes nothing", () => {
    const fp = path.join(tempDir(), "notes.md");
    fs.writeFileSync(fp, UNQUOTED_NOTES, "utf8");

    injectOnce(fp);
    const afterFirst = fs.readFileSync(fp, "utf8");
    const second = injectOnce(fp);

    expect(second.wouldChange).toBe(false);
    expect(fs.readFileSync(fp, "utf8")).toBe(afterFirst);
    expect(afterFirst).toContain("\ncreated_or_detected_at: 2025-10-28T15:30:00Z\n");
  });

  test("REG-WU-003-RC-004-g: a stale opaque derived field is still recomputed", () => {
    const fp = path.join(tempDir(), "notes.md");
    const stale = "old/notes:v1.md";
    fs.writeFileSync(fp, `---\nsource_path: ${stale}\n---\n# Notes\n`, "utf8");
    const field = inspectFrontMatterDocument(fs.readFileSync(fp, "utf8")).fields.find((f) => f.key === "source_path");
    expect(field?.kind).toBe("opaque");

    const incoming = incomingFor(fp);
    const rec = injectOnce(fp);
    expect(rec.meta.source_path).toBe(incoming.source_path);
    expect(rec.meta.source_path).not.toBe(stale);
    expect(fs.readFileSync(fp, "utf8")).not.toContain(stale);
  });
});

function authority(): string {
  return [
    "schema: l9.meta-authority/v1",
    "writer:",
    "  repository: Quantum-L9/l9-meta-injector",
    "  ref: v4.0.0",
    "default_carrier: inline_managed",
    "legacy_writers: migration_only",
    'inline_allow: ["**/*.md"]',
    "",
  ].join("\n");
}

function applyConfig(root: string): CheckConfig {
  const external = `${root}.out`;
  return {
    root,
    glob: "**/*.md",
    outDir: external,
    namespace: "fixture",
    authority: "l9.doctrine.platform",
    nearDupThreshold: 0.9,
    hashPrefixLength: 16,
    indexDir: external,
    verbose: false,
    llmEnabled: false,
    normalizeFilenames: false,
    writeInjectLog: false,
    localFiles: false,
    persistOutputs: false,
  };
}

describe("WU-003 governed apply over an opaque managed value", () => {
  test("REG-WU-003-RC-004-e: an inline-allowed prompt keeps its opaque value and renders without divergence", async () => {
    const root = tempDir("l9-opaque-apply-");
    fs.mkdirSync(path.join(root, ".l9"), { recursive: true });
    fs.writeFileSync(path.join(root, ".l9", "meta-authority.yaml"), authority(), "utf8");
    const doc = "---\ncreated_or_detected_at: 2025-10-28T15:30:00Z\ntitle: Runbook\n---\n\n# Runbook\n\nYou are a prompt. Do the task.\n";
    fs.writeFileSync(path.join(root, "prompt.md"), doc, "utf8");

    const result = await runApplyAsync(applyConfig(root));
    expect(JSON.stringify(result)).not.toContain("APPLY_RENDER_DIVERGENCE");
    expect(result.passed).toBe(true);
    expect(result.apply?.inlineChanged).toContain("prompt.md");
    const after = fs.readFileSync(path.join(root, "prompt.md"), "utf8");
    expect(after).toContain("\ncreated_or_detected_at: 2025-10-28T15:30:00Z\n");
    expect(after).not.toContain('created_or_detected_at: "Unknown"');

    const second = await runApplyAsync(applyConfig(root));
    expect(second.passed).toBe(true);
    expect(second.apply?.changed).toBe(0);
  });
});

describe("WU-003 skills mode sees an opaque description", () => {
  function writeSkill(root: string): string {
    const dir = path.join(root, "skills", "reviewer");
    fs.mkdirSync(dir, { recursive: true });
    const skillPath = path.join(dir, "SKILL.md");
    fs.writeFileSync(skillPath, "---\nname: reviewer\ndescription: Use when: x\n---\n\n# reviewer\n\nCheck things carefully.\n", "utf8");
    return skillPath;
  }

  test("REG-WU-003-RC-004-f: without an LLM the opaque description is left alone", async () => {
    const root = tempDir("l9-opaque-skills-");
    const skillPath = writeSkill(root);
    const before = fs.readFileSync(skillPath, "utf8");
    const result = await runSkillsPipelineAsync({
      root, authority: "l9.auto", dryRun: true, outDir: `${root}.out`, verbose: false, llmEnabled: false,
    });
    expect(result.considered).toBe(1);
    expect(result.files[0]?.diffs.filter((d) => d.field === "description")).toEqual([]);
    expect(fs.readFileSync(skillPath, "utf8")).toBe(before);
  });

  test("REG-WU-003-RC-004-f: an opaque description is an existing value, not a missing one", async () => {
    const root = tempDir("l9-opaque-skills-");
    writeSkill(root);
    setAdapter({
      estimateTokens: (t) => Math.ceil(t.length / 4),
      classify: async (prompt: string) => {
        if (prompt.includes("Cursor Agent Skill description")) {
          return "Reviews pull requests for quality. Use when reviewing PRs, code changes, or when asked for a code review.";
        }
        return null;
      },
    });
    // llmEnabled without endpoint settings keeps the injected adapter.
    const result = await runSkillsPipelineAsync({
      root, authority: "l9.auto", dryRun: true, outDir: `${root}.out`, verbose: false, llmEnabled: true,
    });
    const description = result.files[0]?.diffs.find((d) => d.field === "description");
    expect(description).toBeDefined();
    expect(description?.action).not.toBe("add");
    expect(description?.oldValue).toBe("Use when: x");
  });
});

describe("WU-003 inventory harvest sees an opaque value", () => {
  test("REG-WU-003-RC-004-a: an opaque title is harvested as its verbatim text", () => {
    const fp = path.join(tempDir("l9-opaque-inv-"), "runbook.md");
    fs.writeFileSync(fp, "---\ntitle: Runbook: ops guide\nowner: platform\n---\n# Runbook\n", "utf8");
    const harvested = harvestExistingMeta(fp, false);
    expect(harvested.title).toBe("Runbook: ops guide");
    expect(harvested.owner).toBe("platform");
  });
});
