// corpus_intelligence.test.ts — the packet is a contract, so it is proven as one.
//
// The consumer refuses a packet that is not referentially sound rather than
// compiling the resolvable part, so a producer that emits an unsound packet
// fails a whole corpus run downstream. These tests hold that line here, where
// the run that caused it is still in hand.

import { describe, expect, it } from "vitest";

import {
  CORPUS_INTELLIGENCE_PACKET_TYPE,
  CORPUS_INTELLIGENCE_PACKET_VERSION,
  CORPUS_PAYLOAD_FIELDS,
  type BuildCorpusIntelligenceInput,
  type CorpusIntelligencePayload,
  CorpusIntelligenceError,
  buildCorpusIntelligenceBundle,
  buildCorpusIntelligencePacket,
  corpusPayloadPath,
} from "../src/corpus_intelligence";

const ARTIFACT_A = "artifact:aaa";
const ARTIFACT_B = "artifact:bbb";

function root(overrides: Record<string, unknown> = {}) {
  return {
    rootId: "root:alpha",
    identityClass: "declared" as const,
    sourceRevision: "rev-1",
    repositoryId: "repo:alpha",
    packet: {
      packet_id: "packet:alpha",
      packet_type: "l9.repository-model",
      packet_version: "1.1.0",
      semantic_hash: `sha256:${"a".repeat(64)}`,
      validation: { status: "passed" as const },
      subject: { repository_id: "repo:alpha" },
      source_snapshot: { revision: "rev-1" },
      payload: {
        artifacts: [
          { artifact_id: ARTIFACT_A, source_path: "docs/a.md", content_hash: `sha256:${"1".repeat(64)}` },
          { artifact_id: ARTIFACT_B, source_path: "docs/b.md", content_hash: `sha256:${"2".repeat(64)}` },
        ],
      },
    },
    ...overrides,
  };
}

function emptyPayload(): CorpusIntelligencePayload {
  return {
    document_work_signals: [],
    exact_duplicate_relations: [],
    semantic_pair_relations: [],
    topic_candidates: [],
    project_candidates: [],
    consolidation_candidates: [],
    readiness_evidence: [],
    reasoning_candidates: [],
    reasoning_evidence_pack_refs: [],
  };
}

const PROFILE = { profile_id: "fusion", profile_version: "1.0.0", profile_hash: "sha256:abc" };

function input(payload = emptyPayload()): BuildCorpusIntelligenceInput {
  return {
    corpusId: "corpus-under-test",
    corpusSourceSnapshotId: "snapshot:1",
    corpusAnalysisId: "analysis:1",
    roots: [root()],
    coverage: {
      root_count_requested: 1,
      root_count_observed: 1,
      root_count_failed: 0,
      artifact_count: 2,
      archive_count: 0,
      archive_member_count: 0,
      decoder_eligible_count: 2,
      normalized_document_count: 2,
      interpreted_artifact_count: 1,
      unsupported_format_count: 0,
      coverage_gap_count: 0,
    },
    payload,
    producerVersion: "3.0.0",
    profile: { id: "l9-meta-injector-corpus-intelligence", version: "1.0.0", hash: "sha256:def" },
    createdAt: "2026-03-01T00:00:00.000Z",
  };
}

describe("corpus intelligence packet", () => {
  it("declares the contract the consumer accepts", () => {
    const { packet } = buildCorpusIntelligencePacket(input());
    expect(packet.packet_type).toBe(CORPUS_INTELLIGENCE_PACKET_TYPE);
    expect(packet.packet_version).toBe(CORPUS_INTELLIGENCE_PACKET_VERSION);
    expect(packet.inputs.repository_model_packets).toHaveLength(1);
    expect(packet.corpus.root_refs[0].repository_model_packet.packet_type).toBe(
      "l9.repository-model",
    );
  });

  it("writes every domain, so 'found none' stays distinct from 'never ran'", () => {
    const { packet } = buildCorpusIntelligencePacket(input());
    for (const field of CORPUS_PAYLOAD_FIELDS) {
      expect(packet.payload_refs[field]).toBe(corpusPayloadPath(field));
      expect(packet.payload_hashes[field]).toMatch(/^sha256:[0-9a-f]{64}$/);
    }
  });

  it("is identified by its own semantic hash", () => {
    const { packet } = buildCorpusIntelligencePacket(input());
    expect(packet.packet_id).toBe(`packet:${packet.semantic_hash.slice("sha256:".length)}`);
  });

  it("gives the same identity to the same analysis, whatever the wall clock says", () => {
    const first = buildCorpusIntelligencePacket(input()).packet;
    const second = buildCorpusIntelligencePacket({
      ...input(),
      createdAt: "2027-11-05T09:30:00.000Z",
    }).packet;
    expect(second.semantic_hash).toBe(first.semantic_hash);
    expect(second.packet_id).toBe(first.packet_id);
  });

  it("moves identity when the analysis moves", () => {
    const payload = emptyPayload();
    payload.exact_duplicate_relations.push({
      relation_id: "relation:1",
      duplicate_cluster_id: "cluster:1",
      artifact_a_id: ARTIFACT_A,
      artifact_b_id: ARTIFACT_B,
      content_hash: `sha256:${"3".repeat(64)}`,
    });
    const changed = buildCorpusIntelligencePacket(input(payload)).packet;
    expect(changed.semantic_hash).not.toBe(buildCorpusIntelligencePacket(input()).packet.semantic_hash);
  });

  it("refuses an analysis over no roots", () => {
    expect(() => buildCorpusIntelligencePacket({ ...input(), roots: [] })).toThrow(
      CorpusIntelligenceError,
    );
  });

  it("refuses an artifact identity no input packet carries", () => {
    const payload = emptyPayload();
    payload.exact_duplicate_relations.push({
      relation_id: "relation:1",
      duplicate_cluster_id: "cluster:1",
      artifact_a_id: ARTIFACT_A,
      artifact_b_id: "artifact:never-observed",
      content_hash: `sha256:${"3".repeat(64)}`,
    });
    expect(() => buildCorpusIntelligencePacket(input(payload))).toThrow(
      /which no input packet carries/,
    );
  });

  it("refuses a candidate filed under the wrong domain", () => {
    const payload = emptyPayload();
    payload.topic_candidates.push({
      candidate_id: "candidate:1",
      candidate_type: "PROJECT_CANDIDATE",
      member_artifact_ids: [ARTIFACT_A],
      supporting_relation_ids: [],
      evidence_refs: [],
      confidence_class: "weak",
      ambiguity_flags: [],
      cross_root: false,
      cross_archive: false,
      analysis_profile: PROFILE,
      upstream_candidate_id: "candidate:1",
    });
    expect(() => buildCorpusIntelligencePacket(input(payload))).toThrow(/expected 'TOPIC_CANDIDATE'/);
  });

  it("refuses a line locator for a format that has no lines", () => {
    const payload = emptyPayload();
    payload.document_work_signals.push({
      signal_id: "signal:1",
      artifact_id: ARTIFACT_A,
      subject_id: ARTIFACT_A,
      predicate: "work.blocked_by",
      object: "something",
      source_path: "docs/a.docx",
      locator: { kind: "line", start_line: 7, end_line: 7 },
      source_content_hash: `sha256:${"4".repeat(64)}`,
      document_format: "docx",
      evidence_excerpt: "…",
      extractor_id: "x",
      decoder_id: "d",
      decoder_version: "1",
      evidence_class: "declared",
      authority: "source",
      confidence: "high",
      corpus_artifact_id: "corpus:a",
      normalized_document_id: null,
      block_id: "",
      block_kind: "",
      extractor_profile_version: "",
    });
    expect(() => buildCorpusIntelligencePacket(input(payload))).toThrow(/which has no lines/);
  });

  it("refuses a reasoning request for a candidate it does not carry", () => {
    const payload = emptyPayload();
    payload.reasoning_candidates.push({
      reasoning_candidate_id: "reasoning:1",
      candidate_id: "candidate:absent",
      recommended_reasoning_type: "CONSOLIDATION_ANALYSIS",
      reason: "",
      member_artifact_ids: [],
      evidence_pack_ref: null,
    });
    expect(() => buildCorpusIntelligencePacket(input(payload))).toThrow(
      /which this packet does not carry/,
    );
  });

  it("binds every bundle file to its own hash", () => {
    const { packet, payload } = buildCorpusIntelligencePacket(input());
    const bundle = buildCorpusIntelligenceBundle(packet, payload, {
      createdAt: "2026-03-01T00:00:00.000Z",
    });
    const paths = bundle.files.map((file) => file.path);
    expect(paths).toContain("packet.json");
    expect(paths).toContain("manifest.json");
    for (const field of CORPUS_PAYLOAD_FIELDS) expect(paths).toContain(corpusPayloadPath(field));
    expect(bundle.manifest.semantic_hash).toBe(packet.semantic_hash);
    for (const entry of bundle.manifest.files) {
      const file = bundle.files.find((item) => item.path === entry.path);
      expect(file, entry.path).toBeDefined();
      expect(entry.size_bytes).toBe(Buffer.byteLength(file!.contents, "utf8"));
    }
  });
});
