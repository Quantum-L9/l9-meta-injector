// architecture_document_roles.test.ts — which kind of document a statement came from,
// established only by what the document declared, and asked through the real CLI.
//
// A design corpus is mostly decision records, and a decision record says what it is
// in one place: `## Status` followed by `Accepted.`, `Proposed.` or `Superseded by
// ADR-012.` Selection policy v2 reads exactly that (and an `ADR-NNN` title, and a
// `Status:` label the work reader does not already read), cites the block it read
// it from, and keeps every statement whatever the role decided. These tests build
// a corpus of each role, run the real `local-source` CLI over it, read the published
// payload, and ask the real `corpus-query` CLI for roles and the selected view.
import * as cp from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  ArchitectureEvidenceManifest,
  ArchitectureEvidenceRecord,
} from "../src/corpus_architecture_evidence";
import {
  ARCHITECTURE_DOCUMENT_ROLES,
  ARCHITECTURE_SELECTION_POLICY_VERSION,
  ARCHITECTURE_SELECTION_PROFILE_ID,
  architectureSelectionPolicyHash,
} from "../src/corpus_architecture_evidence";
import type { EvidenceQueryResponse } from "../src/corpus_query";

const REPO = path.resolve(__dirname, "..");
const SCAN_CLI = path.join(REPO, "scripts", "local-source-cli.js");
const QUERY_CLI = path.join(REPO, "scripts", "corpus-query-cli.js");

const scratch: string[] = [];
function tmp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
});

// Titles are chosen so they declare no work.kind: the work reader reads the first
// and last title word as a kind (`# Notes` is a notes document, `# Rollout plan` a
// plan), and a role test must not get its role from a title by accident.

/** A Markdown document: blocks separated by one blank line, ending in a newline. */
function markdown(...blocks: string[]): string {
  return `${blocks.join("\n\n")}\n`;
}

/** A `## heading` and the lines under it, as one block. */
function section(heading: string, ...lines: string[]): string {
  return `## ${heading}\n\n${lines.join("\n")}`;
}

/** YAML frontmatter, immediately followed by the document. */
function withFrontmatter(fields: string[], document: string): string {
  return `---\n${fields.join("\n")}\n---\n${document}`;
}

const CORPUS: Record<string, string> = {
  "decisions/adr-012-gate-routing.md": markdown(
    "# ADR-012: Gate is the routing authority",
    section("Status", "Accepted."),
    section("Decision", "Gate is the only routing authority."),
    section("Constraints", "- Nodes never call each other."),
    section("Assumptions", "- Nodes are stateless."),
    section("Open Questions", "- Should Gate own retries?"),
  ),
  "decisions/adr-003-peer-routing.md": markdown(
    "# ADR-003: Peer routing",
    section("Status", "Superseded by ADR-012."),
    section("Decision", "Nodes resolve their peers from configuration."),
    section("Objectives", "- Keep routing out of the hub."),
  ),
  "decisions/adr-020-retry-budget.md": markdown(
    "# ADR-020: Retry budgets",
    section("Status", "**Proposed** (2026-11-08)"),
    "Decision: Gate owns a retry budget per tenant.",
  ),
  "research/caching-study.md": withFrontmatter(
    ["type: research"],
    markdown(
      "# Caching study",
      [
        "Objective: Measure whether packet caching pays for itself.",
        "Assumption: Most packets are read once.",
        "Open question: Is the cache tenant-scoped?",
        "Constraint: The study writes nothing to production.",
      ].join("\n"),
    ),
  ),
  "archive/old-plan.md": markdown(
    "# Rollout of peer routing",
    "Status: archived",
    "Objective: Roll out peer routing to every node.\nConstraint: One node at a time.",
  ),
  "plans/conflicted.md": withFrontmatter(
    ["status: wip"],
    markdown("# Retry plan", section("Status", "Accepted."), "Decision: Retries live in Gate."),
  ),
  "notes/prose-status.md": markdown(
    "# Meeting log",
    "The status is accepted by everyone we asked.",
    "Objective: Keep the notes short.",
  ),
  "notes/label-accepted.md": markdown(
    "# Label check",
    "Status: Accepted",
    "Decision: Labels are read as declarations.",
  ),
  "notes/label-superseded.md": markdown(
    "# Replaced approach",
    "Status: superseded",
    "Decision: This was replaced.",
  ),
};

let out: string;
let records: ArchitectureEvidenceRecord[];
let manifest: ArchitectureEvidenceManifest;
let plainOut: string;

function scan(root: string, extra: string[]): string {
  const target = path.join(tmp("l9-roles-out-"), "observation");
  const cache = path.join(tmp("l9-roles-cache-"), "cache");
  const result = cp.spawnSync(
    process.execPath,
    [
      SCAN_CLI,
      "--root",
      `${root}=Designs`,
      "--out",
      target,
      "--cache-dir",
      cache,
      "--no-diff",
      ...extra,
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(`scan failed: ${result.stderr}`);
  return target;
}

function generationDir(target: string): string {
  const current = JSON.parse(fs.readFileSync(path.join(target, "CURRENT.json"), "utf8"));
  return path.join(target, ...String(current.generation_ref).split("/"));
}

function query(args: string[]): {
  status: number | null;
  response: EvidenceQueryResponse;
  stdout: string;
} {
  const result = cp.spawnSync(process.execPath, [QUERY_CLI, ...args], { encoding: "utf8" });
  return {
    status: result.status,
    response: JSON.parse(result.stdout) as EvidenceQueryResponse,
    stdout: result.stdout,
  };
}

function of(sourcePath: string): ArchitectureEvidenceRecord[] {
  return records.filter((record) => record.source_path === sourcePath);
}

function sourceLine(sourcePath: string, line: number): string {
  return (CORPUS[sourcePath] as string).split("\n")[line - 1] as string;
}

beforeAll(() => {
  const root = path.join(tmp("l9-roles-src-"), "Designs");
  for (const [relative, contents] of Object.entries(CORPUS)) {
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    fs.writeFileSync(path.join(root, relative), contents, "utf8");
  }
  out = scan(root, ["--architecture-evidence"]);
  plainOut = scan(root, []);
  const generation = generationDir(out);
  records = fs
    .readFileSync(path.join(generation, "architecture-evidence.jsonl"), "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as ArchitectureEvidenceRecord);
  manifest = JSON.parse(
    fs.readFileSync(path.join(generation, "architecture-evidence.manifest.json"), "utf8"),
  );
});

describe("roles are established by what the document declared", () => {
  it("reads an accepted decision record from its Status section and its ADR title, and cites both", () => {
    const adr = of("decisions/adr-012-gate-routing.md");
    expect(adr.length).toBe(4);
    const selection = adr[0]?.selection;
    expect(selection?.roles).toEqual(["decision_record"]);
    expect(selection?.status_families).toEqual(["settled"]);
    const evidence = selection?.role_evidence ?? [];
    expect(evidence.map((item) => [item.predicate, item.object, item.source])).toEqual([
      ["document.decision_record_title", "adr", "document_declaration"],
      ["document.declared_status", "accepted", "document_declaration"],
    ]);
    // The cited coordinate is the line that declared it.
    const status = evidence.find((item) => item.predicate === "document.declared_status");
    const locator = status?.structured_locator as { line_start: number };
    expect(sourceLine("decisions/adr-012-gate-routing.md", locator.line_start)).toBe("Accepted.");
    expect(status?.assertion_id.startsWith("architecture_declaration:")).toBe(true);
    // A decision record selects decisions, constraints and assumptions. The open
    // question is still emitted, outside the selected view.
    const byClass = new Map(
      adr.map((record) => [record.statement_class, record.selection.selected]),
    );
    expect(byClass).toEqual(
      new Map([
        ["assumption", true],
        ["constraint", true],
        ["decision_statement", true],
        ["open_question", false],
      ]),
    );
  });

  it("reads a superseded decision record as both a decision record and historical material", () => {
    const old = of("decisions/adr-003-peer-routing.md");
    expect(old.map((record) => record.statement_class).sort()).toEqual([
      "decision_statement",
      "intent",
    ]);
    expect(old[0]?.selection.roles).toEqual(["decision_record", "historical_record"]);
    expect(old[0]?.selection.status_families).toEqual(["retired"]);
    for (const record of old) {
      expect(record.selection.selected).toBe(true);
      expect(record.epistemic_class).toBe("source-declared");
      expect(record.authority_verified).toBe(false);
    }
    const intent = old.find((record) => record.statement_class === "intent");
    expect(intent?.selection.reasons).toEqual([
      expect.stringContaining(
        "historical_record selects intent: document.declared_status=superseded",
      ),
    ]);
  });

  it("reads a proposed record as a decision record still in progress, emphasis and qualifier notwithstanding", () => {
    const proposed = of("decisions/adr-020-retry-budget.md");
    expect(proposed[0]?.selection.roles).toEqual(["decision_record", "wip_proposal"]);
    expect(proposed[0]?.selection.status_families).toEqual(["in_progress"]);
  });

  it("reads research from its declared kind and selects what a research reader is after", () => {
    const study = of("research/caching-study.md");
    expect(study[0]?.selection.roles).toEqual(["research"]);
    expect(study[0]?.selection.role_evidence[0]).toMatchObject({
      predicate: "work.kind",
      object: "research",
      source: "work_assertion",
    });
    const selected = study
      .filter((record) => record.selection.selected)
      .map((record) => record.statement_class)
      .sort();
    expect(selected).toEqual(["assumption", "intent", "open_question"]);
    expect(
      study.find((record) => record.statement_class === "constraint")?.selection.selected,
    ).toBe(false);
  });

  it("reads archived work as historical material from the existing work.status assertion", () => {
    const old = of("archive/old-plan.md");
    expect(old[0]?.selection.roles).toEqual(["historical_record"]);
    expect(old[0]?.selection.role_evidence[0]).toMatchObject({
      predicate: "work.status",
      object: "archived",
      source: "work_assertion",
    });
    expect(old[0]?.work_context.declarations).toEqual([]);
  });

  it("keeps a contradictory declaration, applies both roles, and says the document contradicted itself", () => {
    const conflicted = of("plans/conflicted.md");
    expect(conflicted).toHaveLength(1);
    const selection = conflicted[0]?.selection;
    expect(selection?.roles).toEqual(["decision_record", "wip_proposal"]);
    expect(selection?.status_families).toEqual(["in_progress", "settled"]);
    expect(selection?.status_conflict).toBe(true);
    expect(conflicted[0]?.work_context.statuses.map((ref) => ref.object)).toEqual(["wip"]);
    expect(conflicted[0]?.work_context.declarations.map((item) => item.object)).toEqual([
      "accepted",
    ]);
  });

  it("does not read a status from prose, and an unknown role keeps every class", () => {
    const prose = of("notes/prose-status.md");
    expect(prose[0]?.selection.roles).toEqual(["unknown"]);
    expect(prose[0]?.work_context.declarations).toEqual([]);
    expect(prose[0]?.selection.selected).toBe(true);
  });

  it("reads a Status label the work reader does not read, and never reads one it does twice", () => {
    expect(of("notes/label-accepted.md")[0]?.selection.roles).toEqual(["decision_record"]);
    const superseded = of("notes/label-superseded.md")[0];
    expect(superseded?.selection.roles).toEqual(["historical_record"]);
    expect(superseded?.work_context.declarations).toEqual([]);
    expect(superseded?.selection.role_evidence.map((item) => item.source)).toEqual([
      "work_assertion",
    ]);
  });
});

describe("the selection view is inspectable and removes nothing", () => {
  it("gives every selected record a reason, and role evidence unless the role is unknown", () => {
    for (const record of records) {
      expect(record.selection.profile_id).toBe(ARCHITECTURE_SELECTION_PROFILE_ID);
      expect(record.selection.policy_version).toBe(ARCHITECTURE_SELECTION_POLICY_VERSION);
      expect(record.selection.selected).toBe(record.selection.reasons.length > 0);
      for (const role of record.selection.roles)
        expect(ARCHITECTURE_DOCUMENT_ROLES).toContain(role);
      if (record.selection.selected && !record.selection.roles.includes("unknown")) {
        expect(record.selection.role_evidence.length).toBeGreaterThan(0);
      }
    }
    expect(manifest.record_count).toBe(records.length);
    expect(manifest.selected_record_count).toBeLessThan(manifest.record_count);
  });

  it("versions and hashes the policy in the manifest, inside the analysis identity", () => {
    expect(manifest.selection_profile_id).toBe(ARCHITECTURE_SELECTION_PROFILE_ID);
    expect(manifest.selection_policy_version).toBe(ARCHITECTURE_SELECTION_POLICY_VERSION);
    expect(manifest.selection_policy_hash).toBe(architectureSelectionPolicyHash());
    const withIt = JSON.parse(
      fs.readFileSync(path.join(generationDir(out), "corpus-snapshot.json"), "utf8"),
    );
    const without = JSON.parse(
      fs.readFileSync(path.join(generationDir(plainOut), "corpus-snapshot.json"), "utf8"),
    );
    expect(withIt.corpus_source_snapshot_id).toBe(without.corpus_source_snapshot_id);
    expect(withIt.analysis.corpus_analysis_id).not.toBe(without.analysis.corpus_analysis_id);
    expect(withIt.analysis.architecture_evidence_profile).toBe(manifest.profile_hash);
  });
});

describe("the corpus-query CLI asks for roles and the selected view, opt-in", () => {
  it("returns only records whose document holds the role", () => {
    const { status, response } = query([
      "--out",
      out,
      "--role",
      "historical_record",
      "--limit",
      "500",
    ]);
    expect(status).toBe(0);
    expect(response.query.role).toBe("historical_record");
    const paths = [...new Set(response.results.map((result) => result.source_path))].sort();
    expect(paths).toEqual([
      "archive/old-plan.md",
      "decisions/adr-003-peer-routing.md",
      "notes/label-superseded.md",
    ]);
    for (const result of response.results) {
      expect(result.source).toBe("architecture_evidence");
      expect(result.selection?.roles).toContain("historical_record");
    }
  });

  it("returns only selected records with --selected-only, and the unselected ones are still in the generation", () => {
    const selected = query(["--out", out, "--selected-only", "--limit", "500"]).response;
    expect(selected.query.selected_only).toBe(true);
    expect(selected.match_count).toBe(manifest.selected_record_count);
    expect(selected.results.every((result) => result.selection?.selected === true)).toBe(true);
    const all = query([
      "--out",
      out,
      "--source",
      "architecture_evidence",
      "--limit",
      "500",
    ]).response;
    expect(all.match_count).toBe(manifest.record_count);
  });

  it("leaves a default query's request echo and results exactly as they were", () => {
    const { response, stdout } = query([
      "--out",
      out,
      "--class",
      "decision_statement",
      "--limit",
      "500",
    ]);
    expect(Object.keys(response.query)).not.toContain("role");
    expect(Object.keys(response.query)).not.toContain("selected_only");
    const sameWithFlags = query([
      "--out",
      out,
      "--class",
      "decision_statement",
      "--limit",
      "500",
      "--selected-only",
    ]).response;
    // Every decision in this corpus is selected, so the opt-in narrows nothing here
    // and the only difference is the echoed flag.
    expect(sameWithFlags.results).toEqual(response.results);
    expect(stdout).not.toContain("selected_only");
  });

  it("refuses an unknown role, and a role question to a generation that never read statements", () => {
    const unknown = query(["--out", out, "--role", "accepted_adr"]);
    expect(unknown.status).toBe(3);
    expect(unknown.response.outcome).toBe("unsupported");
    expect(unknown.response.diagnostics[0]?.code).toBe("query.unknown_role");
    const notRun = query(["--out", plainOut, "--selected-only"]);
    expect(notRun.status).toBe(3);
    expect(notRun.response.diagnostics.at(-1)?.code).toBe("query.architecture_evidence_not_run");
  });
});
