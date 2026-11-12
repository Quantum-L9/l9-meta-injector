// architecture_evidence.test.ts — the statements a design corpus declares, found
// by what they say and cited where they were said.
//
// A plan states its objective; a specification states its invariants and the
// decisions it records; a handoff states what the next engineer may not change
// and what nobody has resolved yet. Every test here asks a question a developer
// would ask of such a corpus and answers it from the emitted records alone —
// never from a hand-assembled example — and then checks the record's coordinate
// against the file it cites.
//
// The second half guards the boundary the profile promised: selecting it moves
// the analysis identity and nothing else. The source snapshot, the per-root
// packets, the work-signal payload and the cache are the same with or without
// it, and a run that did not ask for it reports the projection as not run.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ArchitectureEvidenceRecord } from "../src/corpus_architecture_evidence";
import {
  ARCHITECTURE_EVIDENCE_EPISTEMIC_CLASS,
  ARCHITECTURE_EVIDENCE_MANIFEST_SCHEMA,
  ARCHITECTURE_EVIDENCE_SCHEMA,
  ARCHITECTURE_SELECTION_PROFILE_ID,
  architectureEvidenceProfileHash,
  verifyArchitectureEvidenceExport,
} from "../src/corpus_architecture_evidence";
import { FileCorpusCache } from "../src/corpus_cache";
import type { CorpusScanResult } from "../src/corpus_scan";
import { runCorpusScan } from "../src/corpus_scan";
import {
  ARCHITECTURE_STATEMENT_CLASSES,
  readArchitectureStatements,
} from "../src/extractors/architecture_statements";
import { writeDocx } from "./helpers/document_fixtures";

const scratch: string[] = [];
function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "l9-arch-evidence-"));
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

const PROPOSAL = [
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
].join("\n");

const HANDOFF = [
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
  "References: specs/transport-packet-spec.docx",
  "",
  "Unresolved: Which tenant header the gateway forwards on a cross-tenant hop.",
  "",
].join("\n");

const SPARSE = [
  "# Sparse Notes",
  "",
  "Constraints:",
  "",
  "## Open Questions",
  "",
  "## Decisions",
  "",
  "| decision | owner |",
  "| --- | --- |",
  "| keep the lock | mel |",
  "",
  "Invariant: api_key = placeholder-value-never-issued",
  "",
].join("\n");

/**
 * The synthetic mixed-format corpus the contract asks for: a WIP proposal, a
 * specification with decisions and invariants, a development handoff, one
 * document with no declared role, and one that exercises every coverage
 * diagnostic.
 */
function writeCorpus(root: string): void {
  write(root, "plans/gate-routing-proposal.md", PROPOSAL);
  writeDocx(path.join(root, "specs", "transport-packet-spec.docx"), {
    title: "TransportPacket Specification",
    headings: ["Invariants"],
    paragraphs: [
      "Type: specification",
      "Status: active",
      "Every packet change uses derive() or withHop(); nothing mutates a packet in place.",
      "Decision: PacketEnvelope is retired; TransportPacket is the only wire format.",
      "Decision: Gate is the only routing authority.",
      "Open question: Should hop limits be enforced by Gate or by the chassis?",
    ],
  });
  write(root, "handoffs/chassis-auth-handoff.md", HANDOFF);
  write(root, "notes/untyped.md", "Objective: Keep the gateway stateless.\n");
  // Decodes to zero blocks: a document the reader is given and finds nothing in.
  write(root, "notes/empty.md", "\n");
  write(root, "plans/sparse-notes.md", SPARSE);
}

function corpusRoot(): string {
  const base = tmp();
  const root = path.join(base, "ArchDocs");
  fs.mkdirSync(root);
  writeCorpus(root);
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

function records(result: CorpusScanResult): ArchitectureEvidenceRecord[] {
  const evidence = result.architectureEvidence;
  if (evidence === null) throw new Error("the projection was not selected");
  return evidence.records;
}

function byPath(result: CorpusScanResult, sourcePath: string): ArchitectureEvidenceRecord[] {
  return records(result).filter((record) => record.source_path === sourcePath);
}

/** The exact line a `line_span` record cites, read from the file it names. */
function citedLine(root: string, record: ArchitectureEvidenceRecord): string {
  const locator = record.structured_locator as {
    kind: string;
    line_start: number;
    line_end: number;
  };
  expect(locator.kind).toBe("line_span");
  expect(locator.line_end).toBe(locator.line_start);
  const lines = fs.readFileSync(path.join(root, record.source_path), "utf8").split("\n");
  return lines[locator.line_start - 1] as string;
}

// ───────────────────────── the questions a developer asks ─────────────────────────

describe("the questions a developer asks of a design corpus", () => {
  it("names the documents that explicitly contain unresolved architecture questions", async () => {
    const root = corpusRoot();
    const result = await scan(root);
    const open = records(result).filter((record) => record.statement_class === "open_question");
    expect(new Set(open.map((record) => record.source_path))).toEqual(
      new Set([
        "plans/gate-routing-proposal.md",
        "handoffs/chassis-auth-handoff.md",
        "specs/transport-packet-spec.docx",
      ]),
    );
    // The sparse document labels an `## Open Questions` section and lists nothing
    // under it: it does not contain a question, and it is not in the answer.
    expect(open.some((record) => record.source_path === "plans/sparse-notes.md")).toBe(false);
    expect(open.map((record) => record.declared_text).sort()).toEqual([
      "Does Gate need a retry budget per tenant?",
      "Should hop limits be enforced by Gate or by the chassis?",
      "Which tenant header the gateway forwards on a cross-tenant hop.",
      "Who owns the audit log schema?",
    ]);
  });

  it("states exactly the constraints a given design document declared", async () => {
    const root = corpusRoot();
    const result = await scan(root);
    const constraints = byPath(result, "plans/gate-routing-proposal.md")
      .filter((record) => record.statement_class === "constraint")
      .map((record) => record.declared_text);
    // Records are ordered by artifact and block id, as the work-signal payload
    // is, so a document's statements are compared as the set it declared.
    expect(constraints.sort()).toEqual([
      "No node holds a peer URL.",
      "TransportPacket is the only wire format.",
    ]);
    // The handoff declared its constraints as `Constraints:` and a list — the
    // same two-line shape in another form, read as two constraints.
    const handoff = byPath(result, "handoffs/chassis-auth-handoff.md").filter(
      (record) => record.statement_class === "constraint",
    );
    expect(handoff.map((record) => record.declared_text).sort()).toEqual([
      "Engines contain no auth, routing or FastAPI routes.",
      "Tenant resolution stays in the chassis.",
    ]);
    expect(handoff.every((record) => record.recognition.form === "label_list")).toBe(true);
    // The specification declared an invariant, under an `Invariants` heading in a
    // Word document, and the sentence beside it is not promoted into one.
    const spec = byPath(result, "specs/transport-packet-spec.docx").filter(
      (record) => record.statement_class === "constraint",
    );
    expect(spec.map((record) => record.declared_text)).toEqual([
      "Every packet change uses derive() or withHop(); nothing mutates a packet in place.",
    ]);
  });

  it("lists the decision statements a WIP artifact recorded without calling them approved", async () => {
    const root = corpusRoot();
    const result = await scan(root);
    const decisions = byPath(result, "plans/gate-routing-proposal.md").filter(
      (record) => record.statement_class === "decision_statement",
    );
    expect(decisions.map((record) => record.declared_text).sort()).toEqual([
      "Audit log writes are append-only.",
      "Routing tables are derived from the packet header, not from node config.",
    ]);
    for (const record of decisions) {
      expect(record.epistemic_class).toBe(ARCHITECTURE_EVIDENCE_EPISTEMIC_CLASS);
      expect(record.authority_verified).toBe(false);
      // The document's own declared state travels with the statement, by the
      // assertion that declared it, so a reader can see this is a WIP proposal
      // without being told what to think about it.
      expect(record.work_context.statuses.map((ref) => ref.object)).toEqual(["wip"]);
      expect(record.work_context.kinds.map((ref) => ref.object)).toEqual(["proposal"]);
    }
    // Both decisions are retained. Two `Decision:` lines are two declarations,
    // and choosing one would be reconciliation this pass does not do.
    expect(decisions).toHaveLength(2);
    expect(new Set(decisions.map((record) => record.evidence_id)).size).toBe(2);
  });

  it("cites, for every result, the exact source passage that supports it", async () => {
    const root = corpusRoot();
    const result = await scan(root);
    const all = records(result);
    expect(all.length).toBeGreaterThan(10);
    for (const record of all) {
      if (record.structured_locator.kind === "line_span") {
        // A Markdown statement cites one line, and that line of the file holds
        // the excerpt the record quotes. The decoder strips a list item's bullet
        // from the block's text, so the line contains the excerpt rather than
        // equalling it.
        const line = citedLine(root, record);
        expect(line.replace(/\s+/g, " ").trim()).toContain(record.bounded_excerpt);
        expect(line).toContain(record.declared_text.split(" ")[0] as string);
      } else {
        // A Word statement cites the block of the part it came from. No line
        // number is invented for a format that has none.
        expect(record.structured_locator.kind).toBe("docx_block");
        expect(record.structured_locator.part).toBe("word/document.xml");
        expect(typeof record.structured_locator.block_index).toBe("number");
        expect(record.structured_locator).not.toHaveProperty("line_start");
      }
    }
    // The three readings cite three different shapes, and the record says which.
    const forms = new Set(all.map((record) => record.recognition.form));
    expect(forms).toEqual(new Set(["field_label", "label_list", "section_heading"]));
    const fielded = all.find(
      (record) => record.recognition.form === "field_label" && record.statement_class === "intent",
    );
    expect(fielded?.recognition.label).toBe("objective");
    expect(fielded?.source_path).toBe("plans/gate-routing-proposal.md");
    expect(fielded?.structured_locator).toEqual({ kind: "line_span", line_start: 7, line_end: 7 });
  });

  it("does not read a work declaration, a foreign label or a table as an architectural statement", async () => {
    const root = corpusRoot();
    const result = await scan(root);
    const texts = records(result).map((record) => record.declared_text);
    // `Status: active` and `Type: specification` sit under the `Invariants`
    // heading of the specification and are not invariants.
    expect(texts.some((text) => /^Status:/.test(text) || /^Type:/.test(text))).toBe(false);
    // The handoff's tasks, blocker and dependency are work signals, not constraints.
    expect(texts.some((text) => /auth middleware|security review|chassis-core/.test(text))).toBe(
      false,
    );
    // The table under `## Decisions` is a table.
    expect(texts.some((text) => text.includes("|"))).toBe(false);
    const manifest = result.architectureEvidence?.manifest;
    const codes = manifest?.diagnostics.map((diagnostic) => diagnostic.code) ?? [];
    expect(codes).toContain("architecture_evidence.unsupported_member_block");
    expect(codes).toContain("architecture_evidence.labelled_member_skipped");
  });
});

// ───────────────────────── the selection profile ─────────────────────────

describe("the architecture-development selection profile", () => {
  it("selects by the document's own declared role and says which declaration decided it", async () => {
    const root = corpusRoot();
    const result = await scan(root);
    const proposal = byPath(result, "plans/gate-routing-proposal.md");
    expect(
      proposal.every((record) => record.selection.profile_id === ARCHITECTURE_SELECTION_PROFILE_ID),
    ).toBe(true);
    expect(proposal[0]?.selection.roles).toEqual(["wip_proposal"]);
    expect(proposal.every((record) => record.selection.selected)).toBe(true);
    const evidence = proposal[0]?.selection.role_evidence ?? [];
    expect(evidence.map((item) => [item.role, item.predicate, item.object])).toEqual([
      ["wip_proposal", "work.kind", "proposal"],
      ["wip_proposal", "work.status", "wip"],
    ]);
    // The ids the reasons cite resolve to assertions in the root's own packet.
    const packetAssertionIds = new Set(
      result.rootPackets[0]?.packet.payload.assertions.map((assertion) => assertion.assertion_id) ??
        [],
    );
    for (const item of evidence) expect(packetAssertionIds.has(item.assertion_id)).toBe(true);
    for (const record of proposal) {
      expect(record.selection.reasons.length).toBeGreaterThan(0);
      expect(record.selection.reasons[0]).toContain(
        `wip_proposal selects ${record.statement_class}`,
      );
      expect(record.selection.reasons[0]).toContain("work.kind=proposal");
    }
  });

  it("keeps a statement outside the selected view rather than dropping it", async () => {
    const root = corpusRoot();
    const result = await scan(root);
    const spec = byPath(result, "specs/transport-packet-spec.docx");
    expect(spec[0]?.selection.roles).toEqual(["specification"]);
    const question = spec.find((record) => record.statement_class === "open_question");
    // The specification view asks for constraints and decisions. The open
    // question the document declared is still in the payload, unselected, with
    // no reason — because no rule selected it, not because it was judged.
    expect(question).toBeDefined();
    expect(question?.selection.selected).toBe(false);
    expect(question?.selection.reasons).toEqual([]);
    const decision = spec.find((record) => record.statement_class === "decision_statement");
    expect(decision?.selection.selected).toBe(true);
    expect(decision?.selection.reasons[0]).toContain("specification selects decision_statement");
    // Applicability evidence is carried where the document declared it.
    expect(decision?.work_context.applicability.map((ref) => [ref.predicate, ref.object])).toEqual([
      ["work.status", "active"],
    ]);
    const manifest = result.architectureEvidence?.manifest;
    expect(manifest?.selected_record_count).toBe((manifest?.record_count ?? 0) - 1);
  });

  it("reads a handoff by its tasks and blockers, and counts them beside each statement", async () => {
    const root = corpusRoot();
    const result = await scan(root);
    const handoff = byPath(result, "handoffs/chassis-auth-handoff.md");
    expect(handoff[0]?.selection.roles).toEqual(["development_handoff"]);
    expect(handoff[0]?.work_context.handoff).toEqual([
      { predicate: "work.blocked_by", count: 1 },
      { predicate: "work.depends_on", count: 1 },
      { predicate: "work.references", count: 1 },
      { predicate: "work.task.completed", count: 1 },
      { predicate: "work.task.open", count: 1 },
    ]);
    expect(handoff.map((record) => record.statement_class).sort()).toEqual([
      "constraint",
      "constraint",
      "open_question",
    ]);
    expect(handoff.every((record) => record.selection.selected)).toBe(true);
  });

  it("retains every class for a document whose role is not declared", async () => {
    const root = corpusRoot();
    const result = await scan(root);
    const untyped = byPath(result, "notes/untyped.md");
    expect(untyped).toHaveLength(1);
    expect(untyped[0]?.statement_class).toBe("intent");
    expect(untyped[0]?.selection.roles).toEqual(["unknown"]);
    expect(untyped[0]?.selection.selected).toBe(true);
    expect(untyped[0]?.selection.reasons[0]).toContain("unknown selects intent");
    expect(untyped[0]?.work_context).toEqual({
      kinds: [],
      statuses: [],
      applicability: [],
      handoff: [],
      declarations: [],
    });
  });

  it("roles overlap, and the selected classes are their union", () => {
    // A direct reading with a document that is both a plan and a handoff.
    const reading = readArchitectureStatements([
      {
        block_id: "b1",
        kind: "paragraph",
        text: "Objective: ship\nAssumption: time\nOpen question: who",
        locator: { kind: "line_span", line_start: 1, line_end: 3 },
      },
    ]);
    expect(reading.statements.map((statement) => statement.statement_class)).toEqual([
      "intent",
      "assumption",
      "open_question",
    ]);
    expect(reading.statements.map((statement) => statement.unit_index)).toEqual([0, 1, 2]);
  });
});

// ───────────────────────── identity and the default run ─────────────────────────

describe("selecting the projection moves the analysis identity and nothing else", () => {
  it("is not run by default, and says so rather than reporting nothing", async () => {
    const root = corpusRoot();
    const result = await runCorpusScan({
      roots: [{ path: root, name: "ArchDocs" }],
      producerVersion: "test",
    });
    expect(result.architectureEvidence).toBeNull();
    expect(result.snapshot.architecture_evidence).toBeUndefined();
    expect(result.snapshot.analysis).not.toHaveProperty("architecture_evidence_profile");
  });

  it("leaves the source snapshot, the packets, the work signals and the document index unchanged", async () => {
    const root = corpusRoot();
    const without = await runCorpusScan({
      roots: [{ path: root, name: "ArchDocs" }],
      producerVersion: "test",
    });
    const withProfile = await scan(root);

    expect(withProfile.snapshot.corpus_source_snapshot_id).toBe(
      without.snapshot.corpus_source_snapshot_id,
    );
    expect(withProfile.snapshot.analysis.corpus_analysis_id).not.toBe(
      without.snapshot.analysis.corpus_analysis_id,
    );
    expect(withProfile.snapshot.analysis.architecture_evidence_profile).toBe(
      architectureEvidenceProfileHash(),
    );
    // Every other profile is the one the default run applied.
    const {
      architecture_evidence_profile: _profile,
      corpus_analysis_id: _id,
      ...rest
    } = withProfile.snapshot.analysis;
    const { corpus_analysis_id: _defaultId, ...defaultRest } = without.snapshot.analysis;
    expect(rest).toEqual(defaultRest);

    expect(withProfile.rootPackets.map((root) => root.packet.packet_id)).toEqual(
      without.rootPackets.map((root) => root.packet.packet_id),
    );
    expect(withProfile.documentWorkSignals.payloadJsonl).toBe(
      without.documentWorkSignals.payloadJsonl,
    );
    expect(withProfile.documentWorkSignals.manifest.payload_semantic_hash).toBe(
      without.documentWorkSignals.manifest.payload_semantic_hash,
    );
    expect(withProfile.documentIndex.documents).toEqual(without.documentIndex.documents);
    expect(withProfile.snapshot.artifacts).toEqual(without.snapshot.artifacts);
    // The snapshot names the payload it wrote, and the reference matches the manifest.
    const reference = withProfile.snapshot.architecture_evidence;
    expect(reference?.schema).toBe(ARCHITECTURE_EVIDENCE_SCHEMA);
    expect(reference?.record_count).toBe(withProfile.architectureEvidence?.manifest.record_count);
    expect(reference?.payload_artifact_hash).toBe(
      withProfile.architectureEvidence?.manifest.payload_artifact_hash,
    );
  });

  it("counts every decoded document the reader was given, blocks or not, and refuses to run without interpretation", async () => {
    const root = corpusRoot();
    const result = await scan(root);
    const decoded = result.documentIndex.documents.filter((entry) => entry.decoded);
    expect(
      decoded.some(
        (entry) => entry.root_relative_path === "notes/empty.md" && entry.block_count === 0,
      ),
    ).toBe(true);
    expect(result.architectureEvidence?.manifest.documents_read).toBe(decoded.length);
    expect(result.architectureEvidence?.manifest.document_count).toBeLessThan(decoded.length);
    // Without the interpretation pass a Markdown proposal declares no kind or
    // status to the profile, and every text document would silently become an
    // unknown role. The combination is refused, not degraded.
    await expect(
      runCorpusScan({
        roots: [{ path: root, name: "ArchDocs" }],
        producerVersion: "test",
        architectureEvidence: true,
        interpret: false,
      }),
    ).rejects.toThrow(/--architecture-evidence needs the interpretation pass/);
  });

  it("invalidates no cache layer: a warm cache serves a run that newly selects the projection", async () => {
    const root = corpusRoot();
    const cacheRoot = path.join(tmp(), "cache");
    const cold = await runCorpusScan({
      roots: [{ path: root, name: "ArchDocs" }],
      producerVersion: "test",
      cache: new FileCorpusCache({ root: cacheRoot, producerVersion: "test" }),
    });
    expect(cold.cacheStats.misses).toBeGreaterThan(0);
    const warm = await runCorpusScan({
      roots: [{ path: root, name: "ArchDocs" }],
      producerVersion: "test",
      architectureEvidence: true,
      cache: new FileCorpusCache({ root: cacheRoot, producerVersion: "test" }),
    });
    expect(warm.cacheStats.misses).toBe(0);
    expect(warm.cacheStats.hits).toBeGreaterThan(0);
    expect(warm.architectureEvidence?.manifest.record_count).toBeGreaterThan(10);
  });
});

// ───────────────────────── determinism and the receipt ─────────────────────────

describe("the payload is a function of the corpus, not of the run", () => {
  it("emits identical bytes, ids and hashes on a second run", async () => {
    const root = corpusRoot();
    const first = await scan(root);
    const second = await scan(root);
    expect(second.architectureEvidence?.payloadJsonl).toBe(
      first.architectureEvidence?.payloadJsonl,
    );
    expect(second.architectureEvidence?.manifestJson).toBe(
      first.architectureEvidence?.manifestJson,
    );
    expect(second.architectureEvidence?.manifest.payload_artifact_hash).toBe(
      first.architectureEvidence?.manifest.payload_artifact_hash,
    );
  });

  it("emits the same bytes for the same bytes mounted somewhere else", async () => {
    const one = tmp();
    const two = tmp();
    for (const base of [one, two]) {
      fs.mkdirSync(path.join(base, "Drive"));
      writeCorpus(path.join(base, "Drive"));
    }
    const first = await runCorpusScan({
      roots: [{ path: path.join(one, "Drive"), name: "Drive" }],
      producerVersion: "test",
      architectureEvidence: true,
    });
    const second = await runCorpusScan({
      roots: [{ path: path.join(two, "Drive"), name: "Drive" }],
      producerVersion: "test",
      architectureEvidence: true,
    });
    expect(second.architectureEvidence?.payloadJsonl).toBe(
      first.architectureEvidence?.payloadJsonl,
    );
    expect(first.architectureEvidence?.payloadJsonl).not.toContain(one);
    expect(first.architectureEvidence?.payloadJsonl).not.toContain(os.tmpdir());
  });

  it("joins back to the document index and the work-signal payload by the ids it carries", async () => {
    const root = corpusRoot();
    const result = await scan(root);
    const documents = new Map(
      result.documentIndex.documents.map((entry) => [entry.artifact_id, entry]),
    );
    const artifacts = new Set(
      result.snapshot.artifacts.map((artifact) => artifact.virtual_source_id),
    );
    const signalIds = new Set(result.documentWorkSignals.records.map((record) => record.signal_id));
    const packetIds = new Set(
      result.rootPackets[0]?.packet.payload.assertions.map((assertion) => assertion.assertion_id) ??
        [],
    );
    for (const record of records(result)) {
      expect(artifacts.has(record.artifact_id)).toBe(true);
      const entry = documents.get(record.artifact_id);
      expect(entry?.decoded).toBe(true);
      expect(entry?.normalized_document_id).toBe(record.normalized_document_id);
      expect(entry?.content_hash).toBe(record.raw_content_hash);
      expect(entry?.decoder_id).toBe(record.decoder_id);
      expect(entry?.root_relative_path).toBe(record.source_path);
      expect(record.rmp_artifact_id.startsWith("artifact:")).toBe(true);
      for (const ref of [...record.work_context.kinds, ...record.work_context.statuses]) {
        expect(signalIds.has(ref.assertion_id) || packetIds.has(ref.assertion_id)).toBe(true);
      }
    }
  });

  it("writes a manifest whose counts the payload supports, and refuses one byte changed", async () => {
    const root = corpusRoot();
    const result = await scan(root);
    const evidence = result.architectureEvidence;
    if (evidence === null) throw new Error("not selected");
    expect(evidence.manifest.schema).toBe(ARCHITECTURE_EVIDENCE_MANIFEST_SCHEMA);
    expect(evidence.manifest.by_class.map((entry) => entry.statement_class)).toEqual([
      ...ARCHITECTURE_STATEMENT_CLASSES,
    ]);
    expect(evidence.manifest.by_class.reduce((sum, entry) => sum + entry.record_count, 0)).toBe(
      evidence.manifest.record_count,
    );
    expect(evidence.manifest.by_role.map((entry) => entry.role)).toEqual([
      "development_handoff",
      "specification",
      "unknown",
      "wip_proposal",
    ]);
    const known = {
      knownArtifactIds: new Set(
        result.snapshot.artifacts.map((artifact) => artifact.virtual_source_id),
      ),
      knownNormalizedDocumentIds: new Set(
        result.documentIndex.documents
          .map((entry) => entry.normalized_document_id)
          .filter((id): id is string => id !== null),
      ),
    };
    expect(
      verifyArchitectureEvidenceExport({
        manifest: evidence.manifest,
        payloadJsonl: evidence.payloadJsonl,
        ...known,
      }),
    ).toEqual([]);
    const tampered = evidence.payloadJsonl.replace("append-only", "append_only");
    expect(tampered).not.toBe(evidence.payloadJsonl);
    const problems = verifyArchitectureEvidenceExport({
      manifest: evidence.manifest,
      payloadJsonl: tampered,
      ...known,
    });
    expect(problems.some((problem) => problem.includes("artifact hash"))).toBe(true);
    // A record promoted to verified authority is refused: the contract is that
    // no record ever claims more than the document declared.
    const promoted = evidence.payloadJsonl.replace(
      '"authority_verified":false',
      '"authority_verified":true',
    );
    const promotedProblems = verifyArchitectureEvidenceExport({
      manifest: evidence.manifest,
      payloadJsonl: promoted,
      ...known,
    });
    expect(promotedProblems.some((problem) => problem.includes("authority_verified"))).toBe(true);
  });
});

// ───────────────────────── coverage diagnostics ─────────────────────────

describe("a declaration outside the grammar is a diagnostic, never an invented meaning", () => {
  it("reports the empty label, the empty section, the table and the suppressed secret", async () => {
    const root = corpusRoot();
    const result = await scan(root);
    const manifest = result.architectureEvidence?.manifest;
    const sparse =
      manifest?.diagnostics.filter(
        (diagnostic) => diagnostic.source_path === "plans/sparse-notes.md",
      ) ?? [];
    expect(sparse.map((diagnostic) => diagnostic.code).sort()).toEqual([
      "architecture_evidence.empty_declaration",
      "architecture_evidence.secret_value_suppressed",
      "architecture_evidence.section_without_items",
      "architecture_evidence.section_without_items",
      "architecture_evidence.unsupported_member_block",
    ]);
    for (const diagnostic of sparse) {
      expect(diagnostic.artifact_id.startsWith("vsrc:")).toBe(true);
      expect(diagnostic.block_id.startsWith("block:")).toBe(true);
    }
    expect(byPath(result, "plans/sparse-notes.md")).toEqual([]);
    expect(result.architectureEvidence?.payloadJsonl).not.toContain("never-issued");
    expect(manifest?.diagnostic_count).toBe(manifest?.diagnostics.length);
    expect(manifest?.diagnostics_omitted).toBe(0);
  });

  it("reads a label list that continues inside its own block, and a section that a code block ends", () => {
    const reading = readArchitectureStatements([
      {
        block_id: "b1",
        kind: "paragraph",
        text: "Constraints:\nNo network.\nNo clock.",
        locator: { kind: "line_span", line_start: 4, line_end: 6 },
      },
      {
        block_id: "b2",
        kind: "heading",
        text: "Decisions",
        locator: { kind: "line_span", line_start: 8, line_end: 8 },
      },
      {
        block_id: "b3",
        kind: "code",
        text: "Decision: not this one",
        locator: { kind: "line_span", line_start: 10, line_end: 12 },
      },
      {
        block_id: "b4",
        kind: "paragraph",
        text: "Nor this one.",
        locator: { kind: "line_span", line_start: 14, line_end: 14 },
      },
    ]);
    expect(
      reading.statements.map((statement) => [
        statement.statement_class,
        statement.declared_text,
        statement.unit_index,
      ]),
    ).toEqual([
      ["constraint", "No network.", 1],
      ["constraint", "No clock.", 2],
    ]);
    expect(reading.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "architecture_evidence.section_without_items",
    ]);
  });

  it("drops a statement whose text resembles a credential and says so", () => {
    const reading = readArchitectureStatements([
      {
        block_id: "b1",
        kind: "paragraph",
        text: "Decision: token = placeholder-value-never-issued",
        locator: { kind: "line_span", line_start: 1, line_end: 1 },
      },
    ]);
    expect(reading.statements).toEqual([]);
    expect(reading.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "architecture_evidence.secret_value_suppressed",
    ]);
  });
});
