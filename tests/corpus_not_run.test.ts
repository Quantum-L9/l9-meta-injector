// corpus_not_run.test.ts — WU-049 (ADR-068): a pass that did not run is reported
// as not run, never as a pass that ran and found nothing; and the qualification
// report names the decoders and extensions the run actually had.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  CORPUS_INTELLIGENCE_PACKET_VERSION,
  CorpusIntelligenceError,
  buildCorpusIntelligencePacket,
  type BuildCorpusIntelligenceInput,
  type CorpusIntelligencePayload,
} from "../src/corpus_intelligence";
import { corpusIntelligenceInput } from "../src/corpus_intelligence_input";
import { CORPUS_COVERAGE_SCHEMA } from "../src/corpus_coverage";
import {
  CORPUS_QUALIFICATION_SCHEMA,
  buildCorpusQualificationReport,
  type SourceMutationProof,
} from "../src/corpus_qualification";
import { runCorpusScan, type CorpusScanResult } from "../src/corpus_scan";
import { DecoderRegistry, defaultDecoderRegistry } from "../src/documents";
import { writeMultiRootCorpus } from "./helpers/multi_root_fixtures";
import { writeRawZip } from "./helpers/zip_fixtures";

const scratch: string[] = [];
function tmp(prefix = "l9-not-run-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
});

function write(root: string, relative: string, content: string): void {
  const target = path.join(root, ...relative.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
}

const MUTATION: SourceMutationProof = {
  tree_digest_before: "sha256:0",
  tree_digest_after: "sha256:0",
  mutated_path_count: 0,
  read_only_mode_applied: false,
  read_only_enforced_for_process: false,
};

function report(cold: CorpusScanResult) {
  return buildCorpusQualificationReport({
    cold,
    warm: cold,
    producerVersion: "test",
    semanticOutputIdentical: true,
    sourceMutation: MUTATION,
  });
}

// ───────────────────────────── RC-076: packet ─────────────────────────────

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

function packetInput(
  payload: CorpusIntelligencePayload,
  domainsNotRun: BuildCorpusIntelligenceInput["domainsNotRun"],
): BuildCorpusIntelligenceInput {
  return {
    corpusId: "corpus-under-test",
    corpusSourceSnapshotId: "snapshot:1",
    corpusAnalysisId: "analysis:1",
    roots: [{
      rootId: "root:alpha",
      identityClass: "declared",
      sourceRevision: "rev-1",
      repositoryId: "repo:alpha",
      packet: {
        packet_id: "packet:alpha",
        packet_type: "l9.repository-model",
        packet_version: "1.1.0",
        semantic_hash: `sha256:${"a".repeat(64)}`,
        validation: { status: "passed" },
        subject: { repository_id: "repo:alpha" },
        source_snapshot: { revision: "rev-1" },
        payload: { artifacts: [{ artifact_id: "artifact:a", source_path: "a.md", content_hash: "sha256:1" }] },
      },
    }],
    coverage: {
      root_count_requested: 1,
      root_count_observed: 1,
      root_count_failed: 0,
      artifact_count: 1,
      archive_count: 0,
      archive_member_count: 0,
      decoder_eligible_count: 1,
      normalized_document_count: 1,
      interpreted_artifact_count: 0,
      unsupported_format_count: 0,
      coverage_gap_count: 0,
    },
    payload,
    domainsNotRun,
    producerVersion: "3.0.0",
    profile: { id: "p", version: "1.0.0", hash: "sha256:def" },
    createdAt: "2026-03-01T00:00:00.000Z",
  };
}

describe("WU-049 RC-076: the packet states which domains were not run", () => {
  it("REG-WU-049-RC-076-c: refuses a domain declared not run that carries entries", () => {
    const payload = emptyPayload();
    payload.topic_candidates = [{
      candidate_id: "topic:1",
      candidate_type: "TOPIC_CANDIDATE",
      member_artifact_ids: ["artifact:a"],
      supporting_relation_ids: [],
      evidence_refs: [],
      confidence_class: "weak",
      ambiguity_flags: [],
      cross_root: false,
      cross_archive: false,
      analysis_profile: { profile_id: "x", profile_version: "1", profile_hash: "h" },
      upstream_candidate_id: null,
    }];
    expect(() => buildCorpusIntelligencePacket(
      packetInput(payload, [{ domain: "topic_candidates", reason: "topic candidates disabled" }]),
    )).toThrow(/topic_candidates is declared not run but carries 1 entr/);
    expect(() => buildCorpusIntelligencePacket(
      packetInput(emptyPayload(), [{ domain: "no_such_domain" as never, reason: "x" }]),
    )).toThrow(CorpusIntelligenceError);
    expect(() => buildCorpusIntelligencePacket(
      packetInput(emptyPayload(), [{ domain: "no_such_domain" as never, reason: "x" }]),
    )).toThrow(/not a payload domain/);
  });

  it("REG-WU-049-RC-076-c: binds the statement into identity and bumps the packet version", () => {
    expect(CORPUS_INTELLIGENCE_PACKET_VERSION).toBe("1.1.0");
    const ran = buildCorpusIntelligencePacket(packetInput(emptyPayload(), [])).packet;
    const skipped = buildCorpusIntelligencePacket(packetInput(emptyPayload(), [
      { domain: "semantic_pair_relations", reason: "semantic analysis was not run" },
    ])).packet;
    expect(ran.domains_not_run).toEqual([]);
    expect(skipped.domains_not_run).toEqual([
      { domain: "semantic_pair_relations", reason: "semantic analysis was not run" },
    ]);
    // Same (empty) payload, different statement: different packets.
    expect(skipped.semantic_hash).not.toBe(ran.semantic_hash);
  });

  it("REG-WU-049-RC-076-d: a run without semantic analysis carries its lexical topic candidates", async () => {
    const corpus = writeMultiRootCorpus(tmp());
    const result = await runCorpusScan({
      roots: [
        { path: corpus.oldSsd, name: "OldSSD" },
        { path: corpus.backup, name: "Backup" },
        { path: corpus.archives, name: "ArchiveZips" },
      ],
      producerVersion: "test",
      semanticAnalysis: false,
    });
    expect(result.semantic).toBeNull();
    const lexical = result.candidates.topic_candidates;
    expect(lexical.length).toBeGreaterThan(0);

    const built = corpusIntelligenceInput(result, { producerVersion: "test", createdAt: "2026-01-01T00:00:00.000Z" });
    const topics = built.payload.topic_candidates;
    expect(topics.map((cluster) => cluster.candidate_id).sort())
      .toEqual(lexical.map((candidate) => candidate.candidate_id).sort());
    for (const cluster of topics) {
      expect(cluster.candidate_type).toBe("TOPIC_CANDIDATE");
      expect(cluster.analysis_profile).toEqual({
        profile_id: result.candidates.analysis_profile.topic_candidate_method,
        profile_version: result.candidates.analysis_profile.topic_candidate_version,
        profile_hash: result.candidates.analysis_profile.candidate_profile_hash,
      });
      const source = lexical.find((candidate) => candidate.candidate_id === cluster.candidate_id);
      expect(cluster.cross_root).toBe(source?.spans_roots);
    }
    // The lexical topic pass ran, so the domain is not declared not run; every
    // domain only the semantic pass fills is.
    expect(built.domainsNotRun.map((entry) => entry.domain)).toEqual([
      "semantic_pair_relations",
      "consolidation_candidates",
      "reasoning_candidates",
      "reasoning_evidence_pack_refs",
    ]);
    const { packet } = buildCorpusIntelligencePacket(built);
    expect(packet.validation.status).toBe("passed");
  }, 120_000);

  it("REG-WU-049-RC-076-a: with topics also off, the topic domain is declared not run", async () => {
    const corpus = writeMultiRootCorpus(tmp());
    const result = await runCorpusScan({
      roots: [{ path: corpus.oldSsd, name: "OldSSD" }, { path: corpus.backup, name: "Backup" }],
      producerVersion: "test",
      semanticAnalysis: false,
      topics: { enabled: false },
    });
    const built = corpusIntelligenceInput(result, { producerVersion: "test", createdAt: "2026-01-01T00:00:00.000Z" });
    expect(built.domainsNotRun.map((entry) => entry.domain)).toEqual([
      "semantic_pair_relations",
      "topic_candidates",
      "consolidation_candidates",
      "reasoning_candidates",
      "reasoning_evidence_pack_refs",
    ]);
    for (const entry of built.domainsNotRun) expect(entry.reason.length).toBeGreaterThan(0);
    expect(built.payload.topic_candidates).toEqual([]);
    buildCorpusIntelligencePacket(built);
  }, 120_000);

  it("REG-WU-049-RC-076-b: a default run declares nothing not run", async () => {
    const corpus = writeMultiRootCorpus(tmp());
    const result = await runCorpusScan({
      roots: [{ path: corpus.oldSsd, name: "OldSSD" }, { path: corpus.backup, name: "Backup" }],
      producerVersion: "test",
    });
    const built = corpusIntelligenceInput(result, { producerVersion: "test", createdAt: "2026-01-01T00:00:00.000Z" });
    expect(built.domainsNotRun).toEqual([]);
    expect(buildCorpusIntelligencePacket(built).packet.domains_not_run).toEqual([]);
  }, 120_000);
});

// ───────────────────────────── RC-086: interpretation not run ─────────────────────────────

describe("WU-049 RC-086: a disabled interpretation pass is not reported as complete", () => {
  function statusRoot(): string {
    const root = path.join(tmp(), "root");
    write(root, "README.md", "---\nstatus: wip\n---\n\n# Readme\n");
    return root;
  }

  it("REG-WU-049-RC-086-a: interpret:false reports interpretation disabled with no ratio", async () => {
    const result = await runCorpusScan({ roots: [{ path: statusRoot(), name: "R" }], producerVersion: "t", interpret: false });
    expect(result.coverage.schema).toBe("l9.corpus-coverage/v2");
    expect(CORPUS_COVERAGE_SCHEMA).toBe("l9.corpus-coverage/v2");
    expect(result.coverage.interpretation_enabled).toBe(false);
    expect(result.coverage.interpretation_coverage).toBeNull();
  });

  it("REG-WU-049-RC-086-c: interpret:true keeps the measured ratio", async () => {
    const result = await runCorpusScan({ roots: [{ path: statusRoot(), name: "R" }], producerVersion: "t" });
    expect(result.coverage.interpretation_enabled).toBe(true);
    expect(result.coverage.interpretation_coverage).toEqual({ eligible: 1, covered: 1, ratio: 1 });
  });

  it("REG-WU-049-RC-086-b: the qualification report carries the disabled state", async () => {
    const cold = await runCorpusScan({ roots: [{ path: statusRoot(), name: "R" }], producerVersion: "t", interpret: false });
    const built = report(cold);
    expect(built.schema).toBe("l9.corpus-qualification-report/v2");
    expect(CORPUS_QUALIFICATION_SCHEMA).toBe("l9.corpus-qualification-report/v2");
    expect(built.decoder_coverage.interpretation_enabled).toBe(false);
    expect(built.decoder_coverage.interpretation).toBeNull();

    const enabled = report(await runCorpusScan({ roots: [{ path: statusRoot(), name: "R" }], producerVersion: "t" }));
    expect(enabled.decoder_coverage.interpretation_enabled).toBe(true);
    expect(enabled.decoder_coverage.interpretation).toEqual({ eligible: 1, covered: 1, ratio: 1 });
  });
});

// ───────────────────────────── RC-088: decoder identity ─────────────────────────────

describe("WU-049 RC-088: the report names the decoders the run used", () => {
  it("REG-WU-049-RC-088-a: decoder_profiles is the run's document decoder profile", async () => {
    const root = path.join(tmp(), "root");
    write(root, "a.md", "# A\n");
    const cold = await runCorpusScan({ roots: [{ path: root, name: "R" }], producerVersion: "t" });
    const built = report(cold);
    const profiles = built.decoder_coverage.decoder_profiles;
    expect(profiles).toEqual([...cold.snapshot.analysis.document_decoder_profiles].sort());
    for (const entry of defaultDecoderRegistry().profile()) expect(profiles).toContain(entry);
    expect(profiles.some((entry) => entry.startsWith("l9.text-decoder@"))).toBe(true);
    expect(JSON.stringify(built)).not.toContain("utf8-text-decoder");
    expect(built.decoder_coverage).not.toHaveProperty("text_decoder_id");
    expect(built.decoder_coverage).not.toHaveProperty("text_decoder_version");
  });

  it("REG-WU-049-RC-088-b: a changed decoder version changes decoder_profiles", async () => {
    const root = path.join(tmp(), "root");
    write(root, "a.md", "# A\n");
    const changed = new DecoderRegistry();
    for (const decoder of defaultDecoderRegistry().all()) {
      changed.register(decoder.id === "l9.text-decoder" ? { ...decoder, version: "99.0.0" } : decoder);
    }
    const base = report(await runCorpusScan({ roots: [{ path: root, name: "R" }], producerVersion: "t" }));
    const moved = report(await runCorpusScan({ roots: [{ path: root, name: "R" }], producerVersion: "t", decoderRegistry: changed }));
    expect(moved.decoder_coverage.decoder_profiles).toContain("l9.text-decoder@99.0.0");
    expect(moved.decoder_coverage.decoder_profiles).not.toEqual(base.decoder_coverage.decoder_profiles);
  });
});

// ───────────────────────────── RC-089: extension count ─────────────────────────────

describe("WU-049 RC-089: extensions come from the root-relative basename", () => {
  function extensionlessRoot(): string {
    const root = path.join(tmp(), "root");
    write(root, "README", "readme\n");
    write(root, "LICENSE", "license\n");
    write(root, "Makefile", "all:\n");
    write(root, "sub/Dockerfile", "FROM scratch\n");
    return root;
  }

  it("REG-WU-049-RC-089-a: a dotted root label does not invent extensions", async () => {
    const plain = report(await runCorpusScan({ roots: [{ path: extensionlessRoot(), name: "A" }], producerVersion: "t" }));
    const dotted = report(await runCorpusScan({ roots: [{ path: extensionlessRoot(), name: "A.b" }], producerVersion: "t" }));
    expect(plain.corpus.distinct_extension_count).toBe(1);
    expect(dotted.corpus.distinct_extension_count).toBe(1);
  });

  it("REG-WU-049-RC-089-b: an extensionless archive member counts the empty extension", async () => {
    const root = path.join(tmp(), "root");
    writeRawZip(path.join(root, "x.zip"), [{ name: "README", content: "readme\n" }]);
    const built = report(await runCorpusScan({ roots: [{ path: root, name: "A.b" }], producerVersion: "t" }));
    // `x.zip` and the member `x.zip!/README`: `.zip` and the empty extension.
    expect(built.corpus.distinct_extension_count).toBe(2);
  });
});
