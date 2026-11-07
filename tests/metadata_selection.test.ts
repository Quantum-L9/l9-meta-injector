// metadata_selection.test.ts — which of the evidence a run already has is the
// most useful to carry for the purpose the run was made for.
//
// One mixed corpus — a WIP proposal, an accepted specification, a development
// handoff, an archived design, a research note and an untyped note — is read
// once with the architecture-evidence projection and then viewed under each of
// the four run intents. Every test answers from the emitted view alone: which
// records each intent carried, which fields, and the reason the record states
// for each. The second half guards what the view is not: it invents no field,
// deletes no evidence, moves no identity but the analysis one, and refuses to
// exist without the evidence it derives from.
import * as cp from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ArchitectureEvidenceRecord } from "../src/corpus_architecture_evidence";
import {
  METADATA_ALWAYS_FIELDS,
  METADATA_CARRIER_DISPOSITION,
  METADATA_FIELD_CATALOG,
  METADATA_SELECTION_INTENTS,
  METADATA_SELECTION_MANIFEST_SCHEMA,
  METADATA_SELECTION_POLICY_ID,
  METADATA_SELECTION_SCHEMA,
  buildMetadataSelectionExport,
  metadataSelectionPolicyHash,
  metadataSelectionProfileHash,
  verifyMetadataSelectionExport,
} from "../src/corpus_metadata_selection";
import type { MetadataSelectionIntent, MetadataSelectionRecord } from "../src/corpus_metadata_selection";
import { runCorpusScan } from "../src/corpus_scan";
import type { CorpusScanResult } from "../src/corpus_scan";
import { writeDocx } from "./helpers/document_fixtures";

const REPO = path.resolve(__dirname, "..");
const SCAN_CLI = path.join(REPO, "scripts", "local-source-cli.js");

const scratch: string[] = [];
function tmp(prefix = "l9-metadata-selection-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
});

function write(root: string, relative: string, contents: string): void {
  const absolute = path.join(root, relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, contents, "utf8");
}

/**
 * The four document kinds the contract names, each declaring its own status —
 * a source declaration, never a verified authority — plus a research note and an
 * untyped note so unknown-role recall and role overlap are both exercised.
 */
function writeCorpus(root: string): void {
  write(root, "plans/gate-routing-proposal.md", [
    "---",
    "type: proposal",
    "status: wip",
    "---",
    "# Routing Through Gate",
    "",
    "Objective: Make every inter-node call pass through Gate so routing has one authority.",
    "",
    "## Constraints",
    "",
    "- TransportPacket is the only wire format.",
    "- No node holds a peer URL.",
    "",
    "Assumption: Nodes never need to call each other directly.",
    "",
    "## Open Questions",
    "",
    "- Does Gate need a retry budget per tenant?",
    "- Who owns the audit log schema?",
    "",
    "Decision: Routing tables are derived from the packet header, not from node config.",
    "Decision: Audit log writes are append-only.",
    "",
  ].join("\n"));
  writeDocx(path.join(root, "specs", "transport-packet-spec.docx"), {
    title: "TransportPacket Specification",
    headings: ["Invariants"],
    paragraphs: [
      "Type: specification",
      "Status: active",
      "Every packet change uses derive() or withHop(); nothing mutates a packet in place.",
      "Decision: The hop list is append-only.",
      "Open question: Is a hop limit part of the contract?",
    ],
  });
  write(root, "handoffs/chassis-auth-handoff.md", [
    "# Chassis Auth Handoff",
    "",
    "Status: blocked",
    "",
    "Constraints:",
    "- Engines contain no auth, routing or FastAPI routes.",
    "- Tenant resolution stays in the chassis.",
    "",
    "- [ ] Move the auth middleware into the chassis",
    "- [x] Delete the engine-side token check",
    "",
    "Blocked by: security review",
    "Depends on: chassis-core",
    "",
    "Unresolved: Which tenant header the gateway forwards on a cross-tenant hop.",
    "",
  ].join("\n"));
  write(root, "history/old-routing.md", [
    "# Routing Table History",
    "",
    "Status: archived",
    "Superseded by: plans/gate-routing-proposal.md",
    "",
    "Decision: Each node kept its own routing table.",
    "Constraint: Routing tables were refreshed hourly.",
    "Assumption: Every node could reach every other node.",
    "Open question: Was the hourly refresh ever fast enough?",
    "",
  ].join("\n"));
  write(root, "research/latency-study.md", [
    "---",
    "type: research",
    "---",
    "# Latency Study",
    "",
    "Objective: Measure hop latency through Gate.",
    "Assumption: The benchmark corpus is representative.",
    "Open question: Does p99 latency change with tenant count?",
    "",
  ].join("\n"));
  write(root, "notes/untyped.md", "Objective: Keep the gateway stateless.\n");
}

function corpusRoot(populate: (root: string) => void = writeCorpus): string {
  const root = path.join(tmp(), "ArchDocs");
  fs.mkdirSync(root);
  populate(root);
  return root;
}

async function scan(root: string, extra: Record<string, unknown> = {}): Promise<CorpusScanResult> {
  return runCorpusScan({
    roots: [{ path: root, name: "ArchDocs" }],
    producerVersion: "test",
    architectureEvidence: true,
    ...extra,
  });
}

function view(result: CorpusScanResult): MetadataSelectionRecord[] {
  if (result.metadataSelection === null) throw new Error("the view was not selected");
  return result.metadataSelection.records;
}

function evidence(result: CorpusScanResult): ArchitectureEvidenceRecord[] {
  if (result.architectureEvidence === null) throw new Error("the projection was not selected");
  return result.architectureEvidence.records;
}

function included(records: readonly MetadataSelectionRecord[], sourcePath: string): MetadataSelectionRecord[] {
  return records.filter((record) => record.source_path === sourcePath && record.included);
}

function excluded(records: readonly MetadataSelectionRecord[], sourcePath: string): MetadataSelectionRecord[] {
  return records.filter((record) => record.source_path === sourcePath && !record.included);
}

function classes(records: readonly MetadataSelectionRecord[]): string[] {
  return records.map((record) => record.statement_class).sort();
}

function carried(record: MetadataSelectionRecord): string[] {
  return Object.keys(record.fields ?? {}).sort();
}

/**
 * The fields an intent that selects `bounded_excerpt` carries on one record: the
 * named set, plus the excerpt exactly when it says more than the statement. The
 * dispositions must agree with the presence, which the verifier also checks.
 */
function expectedFields(record: MetadataSelectionRecord, named: readonly string[]): string[] {
  const source = record.fields;
  const excerptReason = record.field_reasons?.find((reason) => reason.field === "bounded_excerpt");
  const differs = excerptReason?.disposition === "intent_selects";
  if (differs) {
    expect(String(source?.bounded_excerpt)).toContain(String(source?.declared_text));
    expect(source?.bounded_excerpt).not.toBe(source?.declared_text);
  } else {
    expect(excerptReason).toEqual({ field: "bounded_excerpt", disposition: "redundant", reason: "equals declared_text" });
  }
  return [...named, ...(differs ? ["bounded_excerpt"] : [])].sort();
}

/** Every intent's view over one evidence export, built in-process from one scan. */
async function allViews(root: string): Promise<Map<MetadataSelectionIntent, CorpusScanResult>> {
  const out = new Map<MetadataSelectionIntent, CorpusScanResult>();
  for (const intent of METADATA_SELECTION_INTENTS) {
    out.set(intent, await scan(root, { metadataSelection: intent }));
  }
  return out;
}

// ───────────────────────── four intents, one corpus ─────────────────────────

describe("the view an intent takes of the same evidence", () => {
  it("for a WIP design carries the proposal whole, with where it stands, and the research beside it", async () => {
    const result = await scan(corpusRoot(), { metadataSelection: "wip_design" });
    const records = view(result);
    const proposal = included(records, "plans/gate-routing-proposal.md");
    expect(classes(proposal)).toEqual([
      "assumption", "constraint", "constraint", "decision_statement", "decision_statement",
      "intent", "open_question", "open_question",
    ]);
    expect(excluded(records, "plans/gate-routing-proposal.md")).toEqual([]);
    expect(proposal.every((record) => record.reason === "role_matches_intent")).toBe(true);
    // Both cases occur in one document: the labelled fields carry their label,
    // the section items repeat nothing.
    expect(new Set(proposal.map((record) => carried(record).includes("bounded_excerpt")))).toEqual(new Set([true, false]));
    expect(proposal[0]?.explanation).toBe("document role wip_proposal is in wip_design's roles");
    // The status the document declares travels with every statement. The
    // excerpt travels only where it says more than the statement: a labelled
    // field's excerpt carries the label it was read from, a section item's
    // excerpt is the item itself. The handoff field never travels here,
    // because the proposal carries no tasks.
    for (const record of proposal) {
      expect(carried(record)).toEqual(expectedFields(record, [
        ...METADATA_ALWAYS_FIELDS, "selection.roles", "work_context.statuses",
      ]));
      expect(record.fields?.["work_context.statuses"]).toEqual(
        expect.arrayContaining([expect.objectContaining({ predicate: "work.status", object: "wip" })]),
      );
      expect(record.field_reasons?.find((reason) => reason.field === "work_context.handoff")).toEqual({
        field: "work_context.handoff", disposition: "empty", reason: "the record carries nothing under it",
      });
      expect(record.field_reasons?.find((reason) => reason.field === "raw_content_hash")).toEqual({
        field: "raw_content_hash", disposition: "not_in_intent", reason: "wip_design does not select it",
      });
    }
    // Research is design in progress too; an untyped note is kept for recall;
    // the accepted, handoff and archived documents are not what this run is for.
    expect(classes(included(records, "research/latency-study.md"))).toEqual(["assumption", "intent", "open_question"]);
    const untyped = included(records, "notes/untyped.md");
    expect(untyped.map((record) => record.reason)).toEqual(["role_unknown_retained"]);
    expect(carried(untyped[0] as MetadataSelectionRecord)).toEqual(expectedFields(
      untyped[0] as MetadataSelectionRecord, [...METADATA_ALWAYS_FIELDS, "selection.roles"],
    ));
    for (const other of ["specs/transport-packet-spec.docx", "handoffs/chassis-auth-handoff.md", "history/old-routing.md"]) {
      expect(included(records, other)).toEqual([]);
      expect(new Set(excluded(records, other).map((record) => record.reason))).toEqual(new Set(["role_outside_intent"]));
    }
  });

  it("for an accepted declaration carries what the accepted documents are bound by and decided, with the bytes behind them", async () => {
    const result = await scan(corpusRoot(), { metadataSelection: "accepted_declaration" });
    const records = view(result);
    const spec = included(records, "specs/transport-packet-spec.docx");
    expect(classes(spec)).toEqual(["constraint", "decision_statement"]);
    expect(excluded(records, "specs/transport-packet-spec.docx").map((record) => [record.statement_class, record.reason]))
      .toEqual([["open_question", "class_outside_intent"]]);
    expect(spec[0]?.explanation).toBe("document role accepted_declaration, specification is in accepted_declaration's roles");
    const chassis = included(records, "specs/accepted-chassis.md");
    expect(chassis).toEqual([]);
    for (const record of spec) {
      expect(carried(record)).toEqual([
        ...METADATA_ALWAYS_FIELDS, "authority_verified", "raw_content_hash", "selection.role_evidence",
        "selection.roles", "work_context.statuses",
      ].sort());
      // Carried so a consumer reading the view alone still sees it is unverified.
      expect(record.fields?.authority_verified).toBe(false);
      expect(String(record.fields?.raw_content_hash)).toMatch(/^sha256:/);
      expect(record.fields?.["selection.role_evidence"]).toEqual(
        expect.arrayContaining([expect.objectContaining({ predicate: "work.status", object: "active" })]),
      );
    }
    // Accepted means declared accepted: an untyped note is not retained here.
    expect(included(records, "notes/untyped.md")).toEqual([]);
    expect(excluded(records, "notes/untyped.md")[0]?.explanation)
      .toBe("document role unknown is not in accepted_declaration's roles (accepted_declaration, specification)");
    expect(included(records, "plans/gate-routing-proposal.md")).toEqual([]);
    expect(included(records, "history/old-routing.md")).toEqual([]);
  });

  it("for a development handoff carries the constraints and open questions with the tasks and blockers counted", async () => {
    const result = await scan(corpusRoot(), { metadataSelection: "development_handoff" });
    const records = view(result);
    const handoff = included(records, "handoffs/chassis-auth-handoff.md");
    expect(classes(handoff)).toEqual(["constraint", "constraint", "open_question"]);
    for (const record of handoff) {
      expect(carried(record)).toEqual(expectedFields(record, [
        ...METADATA_ALWAYS_FIELDS, "selection.role_evidence", "selection.roles", "work_context.handoff",
      ]));
      expect(record.fields?.["work_context.handoff"]).toEqual(
        expect.arrayContaining([
          { predicate: "work.task.open", count: 1 },
          { predicate: "work.task.completed", count: 1 },
          { predicate: "work.blocked_by", count: 1 },
          { predicate: "work.depends_on", count: 1 },
        ]),
      );
      // `Status: blocked` is already in statuses, which this intent does not
      // carry; applicability would repeat it and says nothing more.
      expect(record.field_reasons?.find((reason) => reason.field === "work_context.applicability")?.disposition).toBe("redundant");
    }
    // The proposal is in scope for a handoff — what may not change, what is
    // open, what was decided — but not its objective or its assumption.
    const proposal = included(records, "plans/gate-routing-proposal.md");
    expect(classes(proposal)).toEqual([
      "constraint", "constraint", "decision_statement", "decision_statement", "open_question", "open_question",
    ]);
    expect(excluded(records, "plans/gate-routing-proposal.md").map((record) => [record.statement_class, record.reason]).sort())
      .toEqual([["assumption", "class_outside_intent"], ["intent", "class_outside_intent"]]);
    expect(excluded(records, "notes/untyped.md").map((record) => record.reason)).toEqual(["class_outside_intent"]);
  });

  it("for a historical review carries what the archived design decided and assumed, and what it says replaced it", async () => {
    const result = await scan(corpusRoot(), { metadataSelection: "historical_review" });
    const records = view(result);
    const history = included(records, "history/old-routing.md");
    expect(classes(history)).toEqual(["assumption", "constraint", "decision_statement"]);
    expect(excluded(records, "history/old-routing.md").map((record) => [record.statement_class, record.reason]))
      .toEqual([["open_question", "class_outside_intent"]]);
    for (const record of history) {
      expect(carried(record)).toEqual([
        ...METADATA_ALWAYS_FIELDS, "raw_content_hash", "selection.role_evidence", "selection.roles",
        "work_context.applicability", "work_context.statuses",
      ].sort());
      expect(record.fields?.["work_context.applicability"]).toEqual([
        expect.objectContaining({ predicate: "work.status", object: "archived" }),
        expect.objectContaining({ predicate: "work.superseded_by", object: "plans/gate-routing-proposal.md" }),
      ]);
    }
    // Nothing else declares itself history, and nothing undeclared is history.
    expect(records.filter((record) => record.included).every((record) => record.source_path === "history/old-routing.md")).toBe(true);
    expect(new Set(records.filter((record) => !record.included && record.source_path !== "history/old-routing.md").map((record) => record.reason)))
      .toEqual(new Set(["role_outside_intent"]));
  });

  it("gives the four intents materially different, pairwise distinct views of one evidence set", async () => {
    const root = corpusRoot();
    const views = await allViews(root);
    const sets = new Map<MetadataSelectionIntent, string>();
    const fieldSets = new Map<MetadataSelectionIntent, string>();
    for (const [intent, result] of views) {
      const records = view(result);
      sets.set(intent, JSON.stringify(records.filter((record) => record.included).map((record) => record.evidence_id).sort()));
      fieldSets.set(intent, JSON.stringify([...new Set(records.flatMap(carried))].sort()));
    }
    expect(new Set(sets.values()).size).toBe(4);
    expect(new Set(fieldSets.values()).size).toBe(4);
    // Every intent reads the same evidence, record for record.
    const ids = [...views.values()].map((result) => JSON.stringify(evidence(result).map((record) => record.evidence_id)));
    expect(new Set(ids).size).toBe(1);
    for (const result of views.values()) {
      expect(view(result).map((record) => record.evidence_id)).toEqual(evidence(result).map((record) => record.evidence_id));
    }
  });
});

// ───────────────────────── bounds and reasons ─────────────────────────

describe("the bound and the reasons", () => {
  it("takes the per-document bound in class order and lists what it dropped", async () => {
    const root = corpusRoot((dir) => {
      write(dir, "history/wide.md", [
        "# Wide History",
        "",
        "Status: superseded",
        "",
        ...[1, 2, 3, 4, 5].map((n) => `Decision: Decision number ${n}.`),
        ...[1, 2, 3].map((n) => `Constraint: Constraint number ${n}.`),
        "",
      ].join("\n"));
    });
    const result = await scan(root, { metadataSelection: "historical_review" });
    const records = view(result);
    const kept = included(records, "history/wide.md");
    expect(kept).toHaveLength(6);
    expect(classes(kept)).toEqual(["constraint", "decision_statement", "decision_statement", "decision_statement", "decision_statement", "decision_statement"]);
    const dropped = excluded(records, "history/wide.md");
    expect(dropped.map((record) => [record.statement_class, record.reason])).toEqual([
      ["constraint", "bounded_out"], ["constraint", "bounded_out"],
    ]);
    expect(dropped[0]?.explanation).toContain("historical_review carries at most 6 record(s) per document");
    expect(result.metadataSelection?.manifest.by_reason).toEqual([
      { reason: "role_matches_intent", record_count: 6 },
      { reason: "bounded_out", record_count: 2 },
    ]);
  });

  it("explains every field on every included record, from the catalog and nothing else", async () => {
    const result = await scan(corpusRoot(), { metadataSelection: "wip_design" });
    const catalog = METADATA_FIELD_CATALOG.map((entry) => entry.field);
    for (const record of view(result)) {
      if (!record.included) {
        expect(record.fields).toBeUndefined();
        expect(record.field_reasons).toBeUndefined();
        continue;
      }
      expect(record.field_reasons?.map((reason) => reason.field)).toEqual(catalog);
      for (const key of carried(record)) expect(catalog).toContain(key);
      // A carried value is the evidence record's own value, byte for byte.
      const source = evidence(result).find((candidate) => candidate.evidence_id === record.evidence_id);
      expect(record.fields?.declared_text).toBe(source?.declared_text);
      expect(record.fields?.structured_locator).toEqual(source?.structured_locator);
    }
  });

  it("carries the whole policy in the manifest, with the carrier disposition and the evidence it derives from", async () => {
    const result = await scan(corpusRoot(), { metadataSelection: "development_handoff" });
    const manifest = result.metadataSelection?.manifest;
    expect(manifest?.schema).toBe(METADATA_SELECTION_MANIFEST_SCHEMA);
    expect(manifest?.policy_id).toBe(METADATA_SELECTION_POLICY_ID);
    expect(manifest?.policy_hash).toBe(metadataSelectionPolicyHash());
    expect(manifest?.profile_hash).toBe(metadataSelectionProfileHash("development_handoff"));
    expect(manifest?.policy.intents.map((rule) => rule.intent)).toEqual([
      "wip_design", "accepted_declaration", "development_handoff", "historical_review",
    ]);
    expect(manifest?.policy.field_catalog.map((entry) => entry.field)).toEqual(METADATA_FIELD_CATALOG.map((entry) => entry.field));
    expect(manifest?.carrier).toEqual({
      disposition: METADATA_CARRIER_DISPOSITION,
      mutates_observed_files: false,
      statement: expect.stringContaining("no observed file is opened for writing"),
    });
    expect(manifest?.derived_from.payload_semantic_hash).toBe(result.architectureEvidence?.manifest.payload_semantic_hash);
    expect(manifest?.derived_from.record_count).toBe(result.architectureEvidence?.manifest.record_count);
    expect(manifest?.authority_verified).toBe(false);
    expect(manifest?.epistemic_class).toBe("source-declared");
    expect(result.snapshot.metadata_selection?.intent).toBe("development_handoff");
    expect(result.snapshot.metadata_selection?.payload_artifact_hash).toBe(manifest?.payload_artifact_hash);
  });
});

// ───────────────────────── what the view is not ─────────────────────────

describe("selecting the view moves the analysis identity and nothing else", () => {
  it("is null by default and refuses to exist without the evidence it derives from", async () => {
    const root = corpusRoot();
    expect((await scan(root)).metadataSelection).toBeNull();
    await expect(runCorpusScan({
      roots: [{ path: root, name: "ArchDocs" }],
      producerVersion: "test",
      metadataSelection: "wip_design",
    })).rejects.toThrow("--metadata-selection derives its view from the architecture-evidence payload");
  });

  it("leaves the source snapshot, the evidence payload and every evidence id unchanged, and moves only the analysis id", async () => {
    const root = corpusRoot();
    const plain = await scan(root);
    const views = await allViews(root);
    const analysisIds = new Set<string>([plain.snapshot.analysis.corpus_analysis_id]);
    for (const [intent, result] of views) {
      expect(result.snapshot.corpus_source_snapshot_id).toBe(plain.snapshot.corpus_source_snapshot_id);
      expect(result.architectureEvidence?.payloadJsonl.replace(plain.snapshot.analysis.corpus_analysis_id, ""))
        .toBe(plain.architectureEvidence?.payloadJsonl.replace(plain.snapshot.analysis.corpus_analysis_id, ""));
      expect(evidence(result).map((record) => record.evidence_id)).toEqual(evidence(plain).map((record) => record.evidence_id));
      expect(result.snapshot.analysis.architecture_evidence_profile).toBe(plain.snapshot.analysis.architecture_evidence_profile);
      expect(result.snapshot.analysis.metadata_selection_profile).toBe(metadataSelectionProfileHash(intent));
      expect(result.rootPackets.map((root) => root.packet.packet_id)).toEqual(plain.rootPackets.map((root) => root.packet.packet_id));
      analysisIds.add(result.snapshot.analysis.corpus_analysis_id);
    }
    expect(plain.snapshot.analysis.metadata_selection_profile).toBeUndefined();
    expect(plain.snapshot.metadata_selection).toBeUndefined();
    // One analysis without the view, four with: five distinct conclusions of one source.
    expect(analysisIds.size).toBe(5);
  });

  it("emits identical bytes on a second run and a different profile for a different intent", async () => {
    const root = corpusRoot();
    const first = await scan(root, { metadataSelection: "wip_design" });
    const second = await scan(root, { metadataSelection: "wip_design" });
    expect(second.metadataSelection?.payloadJsonl).toBe(first.metadataSelection?.payloadJsonl);
    expect(second.metadataSelection?.manifestJson).toBe(first.metadataSelection?.manifestJson);
    expect(metadataSelectionProfileHash("wip_design")).not.toBe(metadataSelectionProfileHash("historical_review"));
  });

  it("refuses a view that disagrees with its manifest or with the evidence beside it", async () => {
    const result = await scan(corpusRoot(), { metadataSelection: "accepted_declaration" });
    const exported = result.metadataSelection;
    const source = result.architectureEvidence;
    if (exported === null || source === null) throw new Error("not selected");
    const known = new Set(source.records.map((record) => record.evidence_id));
    const verify = (payload: string, hash = source.manifest.payload_semantic_hash): string[] => verifyMetadataSelectionExport({
      manifest: exported.manifest, payloadJsonl: payload, knownEvidenceIds: known, evidencePayloadSemanticHash: hash,
    });
    expect(verify(exported.payloadJsonl)).toEqual([]);
    expect(verify(exported.payloadJsonl.replace('"included":true', '"included":false')).length).toBeGreaterThan(0);
    expect(verify(exported.payloadJsonl, "sha256:0000")).toContain("the view derives from evidence other than the payload beside it");
    const lines = exported.payloadJsonl.split("\n").filter((line) => line.length > 0);
    expect(verify(`${lines.slice(1).join("\n")}\n`)).toEqual(expect.arrayContaining([
      expect.stringContaining("manifest says"),
    ]));
    // Rebuilding from the same evidence reproduces the same view, byte for byte.
    const rebuilt = buildMetadataSelectionExport({
      intent: "accepted_declaration", evidence: source,
      corpusSourceSnapshotId: result.snapshot.corpus_source_snapshot_id,
      corpusAnalysisId: result.snapshot.analysis.corpus_analysis_id,
    });
    expect(rebuilt.payloadJsonl).toBe(exported.payloadJsonl);
    expect(rebuilt.manifest.schema).toBe(METADATA_SELECTION_MANIFEST_SCHEMA);
    expect(JSON.parse(rebuilt.records.map((r) => JSON.stringify(r))[0] ?? "{}")).toHaveProperty("evidence_id");
    expect(METADATA_SELECTION_SCHEMA).toBe("l9.metadata-selection/v1");
  });
});

// ───────────────────────── the command line ─────────────────────────

describe("the local-source command line", () => {
  function run(root: string, extra: string[]): { status: number | null; stdout: string; stderr: string; out: string } {
    const out = path.join(tmp("l9-metadata-selection-out-"), "observation");
    const cache = path.join(tmp("l9-metadata-selection-cache-"), "cache");
    const result = cp.spawnSync(process.execPath, [
      SCAN_CLI, "--root", `${root}=Designs`, "--out", out, "--cache-dir", cache, "--no-diff", ...extra,
    ], { encoding: "utf8" });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr, out };
  }
  function generationDir(out: string): string {
    const current = JSON.parse(fs.readFileSync(path.join(out, "CURRENT.json"), "utf8"));
    return path.join(out, ...String(current.generation_ref).split("/"));
  }

  it("refuses the intent without the evidence, and an intent it does not know, before reading anything", () => {
    const root = corpusRoot();
    const alone = run(root, ["--metadata-selection", "wip_design"]);
    expect(alone.status).toBe(2);
    expect(alone.stderr).toContain("--metadata-selection derives its view from the architecture-evidence payload");
    expect(fs.existsSync(path.join(alone.out, "CURRENT.json"))).toBe(false);
    const unknown = run(root, ["--architecture-evidence", "--metadata-selection", "canonical"]);
    expect(unknown.status).toBe(2);
    expect(unknown.stderr).toContain("'canonical' is not a run intent this package knows");
    expect(unknown.stderr).toContain("wip_design");
    expect(fs.existsSync(path.join(unknown.out, "CURRENT.json"))).toBe(false);
  });

  it("writes the view beside the evidence in the same generation, lists it in the index, and touches no observed file", () => {
    const root = corpusRoot();
    const before = fs.readdirSync(root, { recursive: true }).map(String).sort();
    const stamps = before.map((relative) => fs.statSync(path.join(root, relative)).mtimeMs);
    const result = run(root, ["--architecture-evidence", "--metadata-selection", "development_handoff"]);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/metadata view {4}development_handoff: \d+ of \d+ evidence record\(s\) carried/);
    expect(result.stdout).toContain("carrier external-generation, no observed file written");
    expect(fs.readdirSync(root, { recursive: true }).map(String).sort()).toEqual(before);
    expect(before.map((relative) => fs.statSync(path.join(root, relative)).mtimeMs)).toEqual(stamps);

    const dir = generationDir(result.out);
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "metadata-selection.manifest.json"), "utf8"));
    const payload = fs.readFileSync(path.join(dir, "metadata-selection.jsonl"), "utf8");
    expect(payload.split("\n").filter((line) => line.length > 0)).toHaveLength(manifest.record_count);
    expect(payload).not.toContain(root);
    expect(payload).not.toContain(os.tmpdir());
    const current = JSON.parse(fs.readFileSync(path.join(result.out, "CURRENT.json"), "utf8"));
    const names = current.files.map((file: { path: string }) => file.path);
    expect(names).toEqual(expect.arrayContaining(["metadata-selection.jsonl", "metadata-selection.manifest.json", "architecture-evidence.jsonl"]));
    const index = JSON.parse(fs.readFileSync(path.join(dir, "corpus-index.json"), "utf8"));
    const listed = index.documents.filter((document: { name: string }) => document.name.startsWith("metadata_selection"));
    expect(listed.map((document: { present: boolean }) => document.present)).toEqual([true, true]);
    const snapshot = JSON.parse(fs.readFileSync(path.join(dir, "corpus-snapshot.json"), "utf8"));
    expect(snapshot.metadata_selection.payload_artifact_hash).toBe(manifest.payload_artifact_hash);
    expect(snapshot.analysis.metadata_selection_profile).toBe(manifest.profile_hash);
    expect(snapshot.analysis.corpus_analysis_id).toBe(manifest.corpus_analysis_id);
  });

  it("lists the view as not written on a run that did not ask for it", () => {
    const result = run(corpusRoot(), ["--architecture-evidence"]);
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("metadata view");
    const dir = generationDir(result.out);
    const index = JSON.parse(fs.readFileSync(path.join(dir, "corpus-index.json"), "utf8"));
    const listed = index.documents.filter((document: { name: string }) => document.name.startsWith("metadata_selection"));
    expect(listed.map((document: { present: boolean }) => document.present)).toEqual([false, false]);
    expect(fs.existsSync(path.join(dir, "metadata-selection.jsonl"))).toBe(false);
  });
});
