// local_source_field_selection.test.ts — which existing evidence fields a run intent
// surfaces for each kind of document, and why, through the real local-source CLI.
//
// Four documents a design corpus actually holds — a WIP design, an accepted
// decision record, a development handoff and a superseded (historical) record —
// plus a byte-identical copy of the accepted record. Each is run through
// `local-source --architecture-evidence --field-selection <intent>`; the view the
// generation publishes is read back and checked against the documents' own
// declarations. The source tree is hashed before and after: the view's carrier
// is the external generation, and nothing under the observed root changes.
import * as cp from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ArchitectureEvidenceRecord } from "../src/corpus_architecture_evidence";
import {
  DEFAULT_FIELD_SELECTION_BUDGET,
  FIELD_DISPOSITIONS,
  FIELD_SELECTION_POLICY_ID,
  STATEMENT_FIELDS_COVER_CLASSES,
  fieldSelectionPolicyHash,
  buildFieldSelectionExport,
  fieldSelectionProfileHash,
  selectFieldsForDocument,
  verifyFieldSelectionExport,
} from "../src/corpus_field_selection";
import type { FieldSelectionManifest, FieldSelectionRecord } from "../src/corpus_field_selection";

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

const ACCEPTED_ADR = [
  "# ADR-012: Gate is the routing authority",
  "",
  "## Status",
  "",
  "Accepted.",
  "",
  "## Context",
  "",
  "Assumption: Every node can reach Gate.",
  "",
  "## Decision",
  "",
  "Gate is the only routing authority.",
  "",
  "## Constraints",
  "",
  "- Nodes never call each other.",
  "- Packets change only through derive() or withHop().",
  "",
].join("\n");

const CORPUS: Record<string, string> = {
  "design/gate-retry-design.md": [
    "---",
    "type: design",
    "status: wip",
    "---",
    "# Gate retry budgets",
    "",
    "Objective: Bound retries per tenant so one tenant cannot starve Gate.",
    "",
    "## Assumptions",
    "",
    "- Retries are idempotent at the node.",
    "",
    "## Open Questions",
    "",
    "- Is the budget per tenant or per route?",
    "- Who resets an exhausted budget?",
    "",
    "## Constraints",
    "",
    "- Nodes never retry on their own.",
    "",
    "Decision: Gate owns the retry counter.",
    "",
  ].join("\n"),
  "decisions/adr-012-gate-routing.md": ACCEPTED_ADR,
  "copies/adr-012-gate-routing-copy.md": ACCEPTED_ADR,
  "handoffs/chassis-auth-handoff.md": [
    "---",
    "type: checklist",
    "status: active",
    "---",
    "# Chassis auth handoff",
    "",
    "Depends on: gate-sdk 2.4",
    "",
    "- [ ] Wire tenant resolution into the chassis",
    "- [ ] Remove the node-local token check",
    "- [x] Move auth middleware out of the engine",
    "",
    "Blocked by: secrets rotation",
    "",
    "## Constraints",
    "",
    "- Engines own no auth.",
    "",
    "## Open Questions",
    "",
    "- Does the chassis cache tenant lookups?",
    "",
  ].join("\n"),
  "archive/adr-003-peer-routing.md": [
    "# ADR-003: Peer routing",
    "",
    "## Status",
    "",
    "Superseded by ADR-012.",
    "",
    "## Decision",
    "",
    "Nodes resolve their peers from configuration.",
    "",
    "## Objectives",
    "",
    "- Keep routing out of the hub.",
    "",
  ].join("\n"),
};

let root: string;

interface Run {
  out: string;
  status: number | null;
  stdout: string;
  stderr: string;
}

function run(extra: string[]): Run {
  const out = path.join(tmp("l9-fieldsel-out-"), "observation");
  const cache = path.join(tmp("l9-fieldsel-cache-"), "cache");
  const result = cp.spawnSync(
    process.execPath,
    [SCAN_CLI, "--root", `${root}=Designs`, "--out", out, "--cache-dir", cache, "--no-diff", ...extra],
    { encoding: "utf8" },
  );
  return { out, status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function generation(out: string): string {
  const current = JSON.parse(fs.readFileSync(path.join(out, "CURRENT.json"), "utf8"));
  return path.join(out, ...String(current.generation_ref).split("/"));
}

function readView(out: string): { records: FieldSelectionRecord[]; manifest: FieldSelectionManifest; bytes: string } {
  const dir = generation(out);
  const bytes = fs.readFileSync(path.join(dir, "field-selection.jsonl"), "utf8");
  return {
    bytes,
    records: bytes.split("\n").filter((line) => line.length > 0).map((line) => JSON.parse(line) as FieldSelectionRecord),
    manifest: JSON.parse(fs.readFileSync(path.join(dir, "field-selection.manifest.json"), "utf8")),
  };
}

function snapshot(out: string): { corpus_source_snapshot_id: string; analysis: Record<string, unknown> } {
  return JSON.parse(fs.readFileSync(path.join(generation(out), "corpus-snapshot.json"), "utf8"));
}

function treeHash(dir: string): string {
  const hash = crypto.createHash("sha256");
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const absolute = path.join(current, entry.name);
      const label = path.relative(dir, absolute);
      if (entry.isDirectory()) {
        const stat = fs.statSync(absolute);
        hash.update(`${label}\0${stat.mode}\0${stat.mtimeMs}\0`);
        walk(absolute);
        continue;
      }
      // One descriptor for the metadata and the bytes, so both describe the same file.
      const fd = fs.openSync(absolute, "r");
      try {
        const stat = fs.fstatSync(fd);
        hash.update(`${label}\0${stat.mode}\0${stat.mtimeMs}\0`);
        hash.update(fs.readFileSync(fd));
      } finally {
        fs.closeSync(fd);
      }
    }
  };
  walk(dir);
  return hash.digest("hex");
}

function selected(record: FieldSelectionRecord | undefined): string[] {
  return (record?.fields ?? []).filter((field) => field.disposition === "selected").map((field) => field.field).sort();
}

function decision(record: FieldSelectionRecord | undefined, field: string) {
  return record?.fields.find((entry) => entry.field === field);
}

let review: Run;
let review2: Run;
let handoff: Run;
let archOnly: Run;
let plain: Run;
let rootHashBefore: string;

beforeAll(() => {
  root = path.join(tmp("l9-fieldsel-src-"), "Designs");
  for (const [relative, contents] of Object.entries(CORPUS)) {
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    fs.writeFileSync(path.join(root, relative), contents, "utf8");
  }
  rootHashBefore = treeHash(root);
  review = run(["--architecture-evidence", "--field-selection", "architecture_review"]);
  review2 = run(["--architecture-evidence", "--field-selection", "architecture_review"]);
  handoff = run(["--architecture-evidence", "--field-selection", "development_handoff"]);
  archOnly = run(["--architecture-evidence"]);
  plain = run([]);
  for (const result of [review, review2, handoff, archOnly, plain]) {
    if (result.status !== 0) throw new Error(`scan failed: ${result.stderr}`);
  }
});

describe("one intent, four kinds of document, four different views", () => {
  it("surfaces what each document's declared role makes useful, and says which rule did", () => {
    const { records } = readView(review.out);
    const by = (sourcePath: string) => records.find((record) => record.source_path === sourcePath);

    const design = by("design/gate-retry-design.md");
    expect(design?.roles).toEqual(["wip_proposal"]);
    expect(selected(design)).toEqual([
      "statement.assumption", "statement.constraint", "statement.decision_statement",
      "statement.intent", "statement.open_question", "work.status",
    ]);
    expect(decision(design, "statement.open_question")?.reasons[0]).toBe("declared role wip_proposal promotes statement.open_question to core");

    const accepted = by("decisions/adr-012-gate-routing.md") ?? by("copies/adr-012-gate-routing-copy.md");
    expect(accepted?.roles).toEqual(["decision_record"]);
    expect(decision(accepted, "declaration.declared_status")?.selected_values.map((value) => value.value)).toEqual(["accepted"]);

    const work = by("handoffs/chassis-auth-handoff.md");
    expect(work?.roles).toEqual(["development_handoff"]);
    expect(selected(work)).toEqual([
      "statement.constraint", "work.blocked_by", "work.depends_on", "work.status", "work.task.open",
    ]);
    expect(decision(work, "work.task.open")?.reasons).toContain("declared role development_handoff promotes work.task.open to core");
    // The completed task is evidence too, and this intent does not ask for it.
    expect(decision(work, "work.task.completed")?.disposition).toBe("not_selected_for_intent");

    const historical = by("archive/adr-003-peer-routing.md");
    expect(historical?.roles).toEqual(["decision_record", "historical_record"]);
    expect(decision(historical, "declaration.declared_status")?.selected_values.map((value) => value.value)).toEqual(["superseded"]);
    expect(decision(historical, "declaration.declared_status")?.reasons).toContain(
      "declared role historical_record promotes declaration.declared_status to core",
    );
    // A supersession it declared only in prose is not invented as a field value.
    expect(decision(historical, "work.superseded_by")?.disposition).toBe("unavailable");

    const views = [design, accepted, work, historical].map((record) => selected(record).join(","));
    expect(new Set(views).size).toBe(4);
  });

  it("re-plans every document for another intent", () => {
    const first = readView(review.out).records;
    const second = readView(handoff.out).records;
    const design = (records: FieldSelectionRecord[]) => records.find((record) => record.source_path === "design/gate-retry-design.md");
    expect(selected(design(second))).not.toEqual(selected(design(first)));
    expect(decision(design(second), "statement.intent")?.disposition).toBe("not_selected_for_intent");
    expect(decision(design(first), "statement.intent")?.disposition).toBe("selected");
  });

  it("marks the byte-identical copy redundant with its cluster representative and selects nothing from it", () => {
    const { records } = readView(review.out);
    const copies = records.filter((record) => record.exact_duplicate_cluster_id !== null);
    expect(copies).toHaveLength(2);
    const [kept, redundant] = [...copies].sort((a, b) => b.selected_field_count - a.selected_field_count);
    expect(kept?.selected_field_count).toBeGreaterThan(0);
    expect(redundant?.selected_field_count).toBe(0);
    for (const field of redundant?.fields ?? []) {
      if (field.available_value_count === 0 || field.tier === null) continue;
      expect(field.disposition).toBe("redundant");
      expect(field.reasons.at(-1)).toContain(`exact duplicate cluster ${redundant?.exact_duplicate_cluster_id}`);
    }
  });
});

describe("every selected value is an existing record of the same generation", () => {
  it("cites architecture evidence, declarations and packet assertions by the ids their payloads gave them", () => {
    const dir = generation(review.out);
    const evidence = fs.readFileSync(path.join(dir, "architecture-evidence.jsonl"), "utf8")
      .split("\n").filter((line) => line.length > 0).map((line) => JSON.parse(line) as ArchitectureEvidenceRecord);
    const known = new Set<string>();
    for (const record of evidence) {
      known.add(record.evidence_id);
      for (const declaration of record.work_context.declarations) known.add(declaration.declaration_id);
    }
    const { records } = readView(review.out);
    let packetValues = 0;
    for (const record of records) {
      for (const field of record.fields) {
        expect(FIELD_DISPOSITIONS).toContain(field.disposition);
        expect(field.reasons.length).toBeGreaterThan(0);
        for (const value of field.selected_values) {
          if (value.source === "architecture_evidence") {
            expect(known.has(value.record_id), value.record_id).toBe(true);
          } else {
            // Resolved through the real query CLI against the same pinned generation.
            packetValues += 1;
            const answer = JSON.parse(cp.spawnSync(process.execPath, [
              QUERY_CLI, "--out", review.out, "--artifact", record.artifact_id, "--source", value.source, "--limit", "500",
            ], { encoding: "utf8" }).stdout);
            expect(answer.results.map((result: { record_id: string }) => result.record_id)).toContain(value.record_id);
          }
        }
      }
    }
    expect(packetValues).toBeGreaterThan(0);
  });
});

describe("a derived view: nothing removed, nothing written to the source", () => {
  it("writes to the external generation only and leaves the observed tree byte-for-byte unchanged", () => {
    const { manifest } = readView(review.out);
    expect(manifest.carrier.disposition).toBe("external_generation");
    expect(manifest.carrier.observed_files_mutated).toBe(false);
    expect(manifest.carrier.refused.map((entry) => entry.carrier)).toEqual(["central_manifest", "inline_managed"]);
    for (const record of readView(review.out).records) expect(record.carrier_disposition).toBe("external_generation");
    expect(treeHash(root)).toBe(rootHashBefore);
  });

  it("leaves the complete payloads and every evidence id exactly as the run without the view wrote them", () => {
    const withView = generation(review.out);
    const without = generation(archOnly.out);
    for (const file of ["architecture-evidence.jsonl", "document-work-signals.jsonl"]) {
      expect(fs.readFileSync(path.join(withView, file), "utf8")).toBe(fs.readFileSync(path.join(without, file), "utf8"));
    }
  });
});

describe("identity, determinism and the default run", () => {
  it("binds the policy, intent and budget into the analysis identity and nothing else", () => {
    const { manifest } = readView(review.out);
    expect(manifest.policy_id).toBe(FIELD_SELECTION_POLICY_ID);
    expect(manifest.policy_hash).toBe(fieldSelectionPolicyHash());
    expect(manifest.profile_hash).toBe(fieldSelectionProfileHash("architecture_review", DEFAULT_FIELD_SELECTION_BUDGET));
    const a = snapshot(review.out);
    const b = snapshot(handoff.out);
    const c = snapshot(archOnly.out);
    expect(a.analysis.field_selection_profile).toBe(manifest.profile_hash);
    expect(new Set([a.corpus_source_snapshot_id, b.corpus_source_snapshot_id, c.corpus_source_snapshot_id]).size).toBe(1);
    expect(new Set([a.analysis.corpus_analysis_id, b.analysis.corpus_analysis_id, c.analysis.corpus_analysis_id]).size).toBe(3);
    expect(c.analysis.field_selection_profile).toBeUndefined();
  });

  it("writes byte-identical views on two runs of the same corpus", () => {
    expect(readView(review2.out).bytes).toBe(readView(review.out).bytes);
  });

  it("changes nothing in a run that did not ask for it: no files, no index entries, no summary line", () => {
    for (const result of [plain, archOnly]) {
      const dir = generation(result.out);
      expect(fs.existsSync(path.join(dir, "field-selection.jsonl"))).toBe(false);
      const index = JSON.parse(fs.readFileSync(path.join(dir, "corpus-index.json"), "utf8"));
      expect(index.documents.map((document: { name: string }) => document.name)).not.toContain("field_selection");
      expect(result.stdout).not.toContain("field selection");
    }
    const index = JSON.parse(fs.readFileSync(path.join(generation(review.out), "corpus-index.json"), "utf8"));
    expect(index.documents.filter((document: { name: string }) => document.name.startsWith("field_selection"))).toEqual([
      { name: "field_selection", path: "field-selection.jsonl", schema: "l9.local-source-field-selection/v1", present: true },
      { name: "field_selection_manifest", path: "field-selection.manifest.json", schema: "l9.local-source-field-selection-manifest/v1", present: true },
    ]);
    expect(review.stdout).toContain("field selection  ");
  });
});

describe("bounded output", () => {
  it("never exceeds the stated budget, and names every field it left out for the budget", () => {
    const bounded = run([
      "--architecture-evidence", "--field-selection", "architecture_review",
      "--field-selection-max-fields", "2", "--field-selection-max-values", "1",
    ]);
    expect(bounded.status).toBe(0);
    const { records, manifest } = readView(bounded.out);
    expect(manifest.budget).toEqual({ max_fields: 2, max_values_per_field: 1, max_characters: 2000 });
    expect(snapshot(bounded.out).analysis.corpus_analysis_id).not.toBe(snapshot(review.out).analysis.corpus_analysis_id);
    const design = records.find((record) => record.source_path === "design/gate-retry-design.md");
    expect(design?.selected_field_count).toBe(2);
    const omitted = design?.fields.filter((field) => field.disposition === "omitted_by_budget") ?? [];
    expect(omitted.length).toBeGreaterThan(0);
    expect(omitted[0]?.reasons.at(-1)).toBe("the view already holds 2 field(s), the budget's maximum");
    for (const record of records) {
      for (const field of record.fields) expect(field.selected_values.length).toBeLessThanOrEqual(1);
    }
  });
});

describe("refusals", () => {
  it("refuses the view without the architecture evidence it reads, an unknown intent, and a stray budget flag", () => {
    expect(run(["--field-selection", "architecture_review"]).status).toBe(2);
    const unknown = run(["--architecture-evidence", "--field-selection", "summarize_everything"]);
    expect(unknown.status).not.toBe(0);
    expect(unknown.stderr).toContain("is not a field-selection intent");
    expect(run(["--architecture-evidence", "--field-selection-max-fields", "3"]).status).toBe(2);
  });
});

describe("marginal utility inside one document", () => {
  it("marks a field redundant when every value is already in the view under an earlier field", () => {
    const record = selectFieldsForDocument(
      {
        artifactId: "vsrc:a",
        rmpArtifactId: "artifact:a",
        sourcePath: "a.md",
        format: "markdown",
        architectureRecords: [],
        workValues: [
          { record_id: "assertion:1", source: "repository_model_packet", predicate: "work.status", object: "superseded" },
          { record_id: "assertion:2", source: "repository_model_packet", predicate: "document.title", object: "Superseded" },
        ],
        exactDuplicate: null,
        nearDuplicateCandidateIds: [],
      },
      "history_audit",
      DEFAULT_FIELD_SELECTION_BUDGET,
    );
    expect(decision(record, "work.status")?.disposition).toBe("selected");
    expect(decision(record, "document.title")?.disposition).toBe("redundant");
    expect(decision(record, "document.title")?.reasons.at(-1)).toBe(
      "every value of document.title is already in this document's view under an earlier field",
    );
    expect(record.roles).toEqual(["unknown"]);
    expect(STATEMENT_FIELDS_COVER_CLASSES).toBe(true);
  });
});

describe("the view's own verifier enforces every budget and identity it states", () => {
  it("refuses a view over the per-field value budget, under another intent, or naming another carrier", () => {
    const built = buildFieldSelectionExport({
      corpusSourceSnapshotId: "corpus-source-snapshot:x",
      corpusAnalysisId: "corpus-analysis:x",
      intent: "history_audit",
      budget: { maxFields: 6, maxValuesPerField: 1, maxCharacters: 2000 },
      documents: [
        {
          artifactId: "vsrc:a",
          rmpArtifactId: "artifact:a",
          sourcePath: "a.md",
          format: "markdown",
          architectureRecords: [],
          workValues: [{ record_id: "assertion:1", source: "repository_model_packet", predicate: "work.status", object: "superseded" }],
          exactDuplicate: null,
          nearDuplicateCandidateIds: [],
        },
      ],
    });
    const verify = (records: FieldSelectionRecord[]) => {
      const payloadJsonl = records.map((record) => `${JSON.stringify(record)}\n`).join("");
      return verifyFieldSelectionExport({
        manifest: built.manifest,
        payloadJsonl,
        knownRecordIds: new Set(["assertion:1", "assertion:2"]),
        knownArtifactIds: new Set(["vsrc:a"]),
      });
    };
    const record = built.records[0] as FieldSelectionRecord;
    const status = record.fields.find((field) => field.field === "work.status");
    const overBudget = {
      ...record,
      fields: record.fields.map((field) =>
        field === status
          ? { ...field, selected_values: [...field.selected_values, { record_id: "assertion:2", source: "repository_model_packet" as const, value: "archived" }] }
          : field),
    };
    expect(verify([overBudget])).toContain(
      `view ${record.view_id} selects 2 value(s) of work.status, over the budget's 1 per field`,
    );
    expect(verify([{ ...record, intent: "architecture_review" }])).toContain(
      `view ${record.view_id} was not selected under the manifest's intent and policy`,
    );
    expect(verify([{ ...record, carrier_disposition: "inline_managed" as never }])).toContain(
      `view ${record.view_id} names carrier 'inline_managed', not the external generation`,
    );
  });
});
