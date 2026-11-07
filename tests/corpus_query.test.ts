// corpus_query.test.ts — a precise question, answered from a completed generation.
//
// Every test here runs the real local-source CLI to produce a generation, then
// asks the query the questions the acceptance contract names, and checks the
// answer against the records the generation wrote and the files they cite. The
// query is read-only: the tests hash the whole generation before and after and
// require it unchanged, and require two identical questions to produce
// identical bytes.
//
// The refusals matter as much as the answers. A flipped byte in a payload, a
// manifest that disagrees with its payload, a pointer naming a path outside the
// generation, a symlink where a file should be, a root the run never observed:
// each has to come back as its own outcome, never as an ordinary empty result.
import * as cp from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CORPUS_EVIDENCE_QUERY_SCHEMA,
  queryCorpusEvidence,
  renderEvidenceQueryResponse,
} from "../src/corpus_query";
import type { EvidenceQueryResponse } from "../src/corpus_query";
import { canonicalCorpusJson } from "../src/corpus_analysis";
import { sha256TextPrefixed } from "../src/repository_model";
import { writeDocx } from "./helpers/document_fixtures";

const REPO = path.resolve(__dirname, "..");
const SCAN_CLI = path.join(REPO, "scripts", "local-source-cli.js");
const QUERY_CLI = path.join(REPO, "scripts", "corpus-query-cli.js");

const scratch: string[] = [];
function tmp(prefix = "l9-corpus-query-"): string {
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

/** The mixed-format corpus: a WIP proposal, a Word specification, a handoff, an untyped note. */
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
    "## Open Questions",
    "",
    "- Does Gate need a retry budget per tenant?",
    "- Who owns the audit log schema?",
    "",
    "Decision: Routing tables are derived from the packet header, not from node config.",
    "Decision: Audit log writes are append-only.",
    "",
    "Status: blocked",
    "",
  ].join("\n"));
  writeDocx(path.join(root, "specs", "transport-packet-spec.docx"), {
    title: "TransportPacket Specification",
    headings: ["Invariants"],
    paragraphs: [
      "Status: active",
      "Every packet change uses derive() or withHop(); nothing mutates a packet in place.",
      "Decision: Gate is the only routing authority.",
      "Open question: Should hop limits be enforced by Gate or by the chassis?",
    ],
  });
  write(root, "handoffs/chassis-auth-handoff.md", [
    "# Chassis Auth Handoff",
    "",
    "Status: blocked",
    "",
    "Constraints:",
    "- Engines contain no auth, routing or FastAPI routes.",
    "",
    "- [ ] Move the auth middleware into the chassis",
    "",
    "Blocked by: security review",
    "",
    "Unresolved: Which tenant header the gateway forwards on a cross-tenant hop.",
    "",
  ].join("\n"));
  write(root, "notes/untyped.md", "Objective: Keep the gateway stateless.\n");
}

/**
 * The base corpus plus the role scenarios: a specification that is also a
 * handoff (the critical overlap), a research note, and an archived document
 * that declares no kind.
 */
function writeRoleCorpus(root: string): void {
  writeCorpus(root);
  write(root, "specs/overlap.md", [
    "---",
    "type: specification",
    "---",
    "# Integration Spec",
    "",
    "- [ ] Review integration",
    "",
    "Constraint: The chassis owns ingress.",
    "Open question: Who reviews the integration?",
    "Decision: Ingress is terminated at the chassis.",
    "",
  ].join("\n"));
  write(root, "research/latency-study.md", [
    "---",
    "type: research",
    "status: archived",
    "---",
    "# Latency Study",
    "",
    "Assumption: The benchmark corpus is representative.",
    "Decision: Benchmarks ran nightly.",
    "",
  ].join("\n"));
  write(root, "history/old-routing.md", [
    "# Routing Table History",
    "",
    "Status: archived",
    "Superseded by: plans/gate-routing-proposal.md",
    "",
    "Decision: Each node kept its own routing table.",
    "Open question: Was the hourly refresh ever fast enough?",
    "",
  ].join("\n"));
}

interface Generated {
  root: string;
  out: string;
  stdout: string;
  status: number | null;
}

function scan(root: string, extra: string[] = [], out = path.join(tmp("l9-corpus-query-out-"), "observation")): Generated {
  const cache = path.join(tmp("l9-corpus-query-cache-"), "cache");
  const result = cp.spawnSync(process.execPath, [
    SCAN_CLI, "--root", `${root}=Designs`, "--out", out, "--cache-dir", cache, "--no-diff", ...extra,
  ], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`scan failed: ${result.stderr}`);
  return { root, out, stdout: result.stdout, status: result.status };
}

function generationDir(out: string): string {
  const current = JSON.parse(fs.readFileSync(path.join(out, "CURRENT.json"), "utf8"));
  return path.join(out, ...String(current.generation_ref).split("/"));
}

/** SHA-256 of every file under a directory, by relative path. */
function treeHashes(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else out.set(path.relative(dir, absolute), crypto.createHash("sha256").update(fs.readFileSync(absolute)).digest("hex"));
    }
  };
  walk(dir);
  return out;
}

function runQuery(args: string[]): { status: number | null; response: EvidenceQueryResponse; stdout: string } {
  const result = cp.spawnSync(process.execPath, [QUERY_CLI, ...args], { encoding: "utf8" });
  return { status: result.status, response: JSON.parse(result.stdout) as EvidenceQueryResponse, stdout: result.stdout };
}

/** A tamperable copy of a generation's output directory. */
function copyOut(out: string): string {
  const copy = path.join(tmp("l9-corpus-query-copy-"), "observation");
  fs.cpSync(out, copy, { recursive: true });
  return copy;
}

let evidence: Generated;
let roles: Generated;

beforeAll(() => {
  const root = path.join(tmp("l9-corpus-query-src-"), "Designs");
  fs.mkdirSync(root);
  writeCorpus(root);
  evidence = scan(root, ["--architecture-evidence"]);
  const roleRoot = path.join(tmp("l9-corpus-query-roles-src-"), "Designs");
  fs.mkdirSync(roleRoot);
  writeRoleCorpus(roleRoot);
  roles = scan(roleRoot, ["--architecture-evidence"]);
});

// ───────────────────────── A. architectural discovery ─────────────────────────

describe("A. architectural discovery", () => {
  it("finds the explicitly recorded open questions about a subject, each at its coordinate", () => {
    const response = queryCorpusEvidence({ outDir: evidence.out, statementClass: "open_question", text: "Gate" });
    expect(response.outcome).toBe("ok");
    expect(response.generation?.corpus_status).toBe("complete");
    expect(response.results.map((record) => [record.source_path, record.value])).toEqual([
      ["plans/gate-routing-proposal.md", "Does Gate need a retry budget per tenant?"],
      ["specs/transport-packet-spec.docx", "Should hop limits be enforced by Gate or by the chassis?"],
    ].sort((a, b) => (a[0] as string).localeCompare(b[0] as string)) as never);
    // Every answer carries the identities a reader needs to resolve it, as the
    // generation wrote them, and nothing a reader would have to take on trust.
    for (const record of response.results) {
      expect(record.source).toBe("architecture_evidence");
      expect(record.artifact_id.startsWith("vsrc:")).toBe(true);
      expect(record.rmp_artifact_id.startsWith("artifact:")).toBe(true);
      expect(record.normalized_document_id?.startsWith("normdoc:")).toBe(true);
      expect(record.raw_content_hash?.startsWith("sha256:")).toBe(true);
      expect(record.block_id?.startsWith("block:")).toBe(true);
      expect(record.epistemic_class).toBe("source-declared");
      expect(record.authority_verified).toBe(false);
    }
  });

  it("states the constraints one design document declared, addressed by its corpus path", () => {
    const response = queryCorpusEvidence({
      outDir: evidence.out,
      statementClass: "constraint",
      artifact: "Designs::plans/gate-routing-proposal.md",
    });
    expect(response.outcome).toBe("ok");
    expect(response.results.map((record) => record.value).sort()).toEqual([
      "No node holds a peer URL.",
      "TransportPacket is the only wire format.",
    ]);
    // The same document addressed by either identity gives the same answer.
    const byId = queryCorpusEvidence({ outDir: evidence.out, statementClass: "constraint", artifact: response.results[0]?.artifact_id });
    const byRmp = queryCorpusEvidence({ outDir: evidence.out, statementClass: "constraint", artifact: response.results[0]?.rmp_artifact_id });
    expect(byId.results).toEqual(response.results);
    expect(byRmp.results).toEqual(response.results);
  });
});

// ───────────────────────── B. WIP discrimination ─────────────────────────

describe("B. WIP discrimination", () => {
  it("returns a WIP document's recorded decisions beside its WIP status, never as accepted", () => {
    const response = queryCorpusEvidence({ outDir: evidence.out, statementClass: "decision_statement", status: "wip" });
    expect(response.outcome).toBe("ok");
    expect(response.results.map((record) => record.value).sort()).toEqual([
      "Audit log writes are append-only.",
      "Routing tables are derived from the packet header, not from node config.",
    ]);
    for (const record of response.results) {
      expect(record.source_path).toBe("plans/gate-routing-proposal.md");
      expect(record.authority_verified).toBe(false);
      expect(record.epistemic_class).toBe("source-declared");
      // The document declared `status: wip` in frontmatter and `Status: blocked`
      // at the bottom. Both are returned; matching one did not erase the other.
      expect(record.document_declarations.statuses.map((ref) => ref.object)).toEqual(["blocked", "wip"]);
      expect(record.document_declarations.kinds.map((ref) => ref.object)).toEqual(["proposal"]);
      for (const ref of [...record.document_declarations.statuses, ...record.document_declarations.kinds]) {
        expect(ref.assertion_id.startsWith("assertion:")).toBe(true);
      }
      expect(record.selection?.roles).toEqual(["wip_proposal"]);
    }
    // The specification's decisions are not WIP and are not in this answer; they
    // are in the unfiltered one.
    const all = queryCorpusEvidence({ outDir: evidence.out, statementClass: "decision_statement" });
    expect(all.match_count).toBe(3);
    expect(all.results.some((record) => record.format === "docx")).toBe(true);
  });

  it("answers the same question through the CLI with the same bytes", () => {
    const first = runQuery(["--out", evidence.out, "--class", "decision_statement", "--status", "wip"]);
    const second = runQuery(["--out", evidence.out, "--class", "decision_statement", "--status", "wip"]);
    expect(first.status).toBe(0);
    expect(first.stdout).toBe(second.stdout);
    expect(first.response.schema).toBe(CORPUS_EVIDENCE_QUERY_SCHEMA);
    expect(first.stdout).toBe(renderEvidenceQueryResponse(
      queryCorpusEvidence({ outDir: evidence.out, statementClass: "decision_statement", status: "wip" }),
    ));
  });
});

// ───────────────────────── C. exact evidence retrieval ─────────────────────────

describe("C. exact evidence retrieval", () => {
  it("returns a Markdown status at its line and a Word status at its block, each verifiable", () => {
    const response = queryCorpusEvidence({ outDir: evidence.out, predicate: "work.status" });
    expect(response.outcome).toBe("ok");
    const markdown = response.results.filter((record) => record.source === "repository_model_packet");
    const word = response.results.filter((record) => record.source === "document_work_signals");
    expect(markdown.length).toBeGreaterThanOrEqual(3);
    expect(word).toHaveLength(1);

    for (const record of markdown) {
      expect(record.source_range).not.toBeNull();
      expect(record.structured_locator).toBeNull();
      const lines = fs.readFileSync(path.join(evidence.root, record.source_path), "utf8").split("\n");
      const cited = lines.slice((record.source_range?.start_line ?? 1) - 1, record.source_range?.end_line ?? 0).join("\n");
      expect(cited.replace(/\s+/g, " ").trim()).toBe(record.bounded_excerpt);
      expect(record.record_id.startsWith("assertion:")).toBe(true);
    }
    const docx = word[0];
    expect(docx?.source_path).toBe("specs/transport-packet-spec.docx");
    expect(docx?.value).toBe("active");
    expect(docx?.structured_locator?.kind).toBe("docx_block");
    expect(docx?.structured_locator?.part).toBe("word/document.xml");
    expect(docx?.source_range).toBeNull();
    expect(docx?.record_id.startsWith("document_assertion:")).toBe(true);
    // A result says when the generation itself cut an excerpt; none of these did.
    expect(response.results.every((record) => record.excerpt_truncated_at_source === false)).toBe(true);
  });

  it("cuts an excerpt only on request, says so, and never invents a complete passage", () => {
    const response = queryCorpusEvidence({ outDir: evidence.out, predicate: "document.title", maxExcerptBytes: 16 });
    expect(response.results.length).toBeGreaterThan(0);
    for (const record of response.results) {
      expect(Buffer.byteLength(record.bounded_excerpt, "utf8")).toBeLessThanOrEqual(16);
      expect(record.excerpt_cut_by_query).toBe(true);
      expect(record.bounded_excerpt.endsWith("…")).toBe(true);
    }
  });
});

// ───────────────────────── D. integrity refusal ─────────────────────────

describe("D. integrity refusal", () => {
  it("refuses a generation whose payload has one byte changed", () => {
    const copy = copyOut(evidence.out);
    const payload = path.join(generationDir(copy), "architecture-evidence.jsonl");
    fs.writeFileSync(payload, fs.readFileSync(payload, "utf8").replace("append-only", "append_only"), "utf8");
    const response = queryCorpusEvidence({ outDir: copy, statementClass: "decision_statement" });
    expect(response.outcome).toBe("invalid");
    expect(response.results).toEqual([]);
    expect(response.match_count).toBeNull();
    expect(response.diagnostics.map((diagnostic) => diagnostic.code)).toContain("query.file_hash_mismatch");
    expect(runQuery(["--out", copy, "--class", "decision_statement"]).status).toBe(1);
  });

  it("refuses a payload whose manifest no longer describes it, even when the pointer was rewritten to match", () => {
    const copy = copyOut(evidence.out);
    const dir = generationDir(copy);
    const payload = path.join(dir, "document-work-signals.jsonl");
    const tampered = fs.readFileSync(payload, "utf8").replace('"object":"active"', '"object":"done"');
    expect(tampered).not.toBe(fs.readFileSync(payload, "utf8"));
    fs.writeFileSync(payload, tampered, "utf8");
    // An attacker who also fixes CURRENT.json's hash still meets the manifest.
    const currentPath = path.join(copy, "CURRENT.json");
    const current = JSON.parse(fs.readFileSync(currentPath, "utf8"));
    for (const file of current.files) {
      if (file.path === "document-work-signals.jsonl") {
        file.content_hash = `sha256:${crypto.createHash("sha256").update(tampered, "utf8").digest("hex")}`;
      }
    }
    fs.writeFileSync(currentPath, JSON.stringify(current, null, 2), "utf8");
    const response = queryCorpusEvidence({ outDir: copy, predicate: "work.status" });
    expect(response.outcome).toBe("invalid");
    expect(response.results).toEqual([]);
    expect(response.diagnostics.map((diagnostic) => diagnostic.code)).toContain("query.work_signals_refused");
  });

  it("refuses a packet that is not the one the snapshot recorded for its root", () => {
    const copy = copyOut(evidence.out);
    const packet = path.join(generationDir(copy), "roots", "Designs", "bundle", "packet.json");
    fs.writeFileSync(packet, fs.readFileSync(packet, "utf8").replace('"object":"blocked"', '"object":"done"'), "utf8");
    const response = queryCorpusEvidence({ outDir: copy, predicate: "work.status" });
    expect(response.outcome).toBe("invalid");
    expect(response.diagnostics.map((diagnostic) => diagnostic.code)).toContain("query.file_hash_mismatch");
  });

  it("refuses a rewritten packet even when the pointer's hash was rewritten to match it", () => {
    const copy = copyOut(evidence.out);
    const dir = generationDir(copy);
    const packetPath = path.join(dir, "roots", "Designs", "bundle", "packet.json");
    const tampered = fs.readFileSync(packetPath, "utf8").replace('"object":"blocked"', '"object":"done"');
    expect(tampered).not.toBe(fs.readFileSync(packetPath, "utf8"));
    fs.writeFileSync(packetPath, tampered, "utf8");
    const currentPath = path.join(copy, "CURRENT.json");
    const current = JSON.parse(fs.readFileSync(currentPath, "utf8"));
    for (const file of current.files) {
      if (file.path === "roots/Designs/bundle/packet.json") {
        file.content_hash = `sha256:${crypto.createHash("sha256").update(tampered, "utf8").digest("hex")}`;
      }
    }
    fs.writeFileSync(currentPath, JSON.stringify(current, null, 2), "utf8");
    // The declared packet id is unchanged and matches the snapshot; the
    // packet's own validation recomputes the semantic hash and refuses.
    const response = queryCorpusEvidence({ outDir: copy, predicate: "work.status" });
    expect(response.outcome).toBe("invalid");
    expect(response.results).toEqual([]);
    expect(response.diagnostics.map((diagnostic) => diagnostic.code)).toContain("query.packet_invalid");
    expect(response.diagnostics[response.diagnostics.length - 1]?.message).toContain("semantic_hash");
  });

  it("refuses a malformed pointer file list as invalid rather than crashing", () => {
    const copy = copyOut(evidence.out);
    const currentPath = path.join(copy, "CURRENT.json");
    const current = JSON.parse(fs.readFileSync(currentPath, "utf8"));
    delete current.files;
    fs.writeFileSync(currentPath, JSON.stringify(current, null, 2), "utf8");
    const missing = queryCorpusEvidence({ outDir: copy, predicate: "work.status" });
    expect(missing.outcome).toBe("invalid");
    expect(missing.diagnostics[0]?.code).toBe("query.pointer_malformed");
    current.files = [{ path: "corpus-snapshot.json" }];
    fs.writeFileSync(currentPath, JSON.stringify(current, null, 2), "utf8");
    const partial = queryCorpusEvidence({ outDir: copy, predicate: "work.status" });
    expect(partial.outcome).toBe("invalid");
    expect(partial.diagnostics[0]?.code).toBe("query.pointer_malformed");
    const cli = runQuery(["--out", copy, "--predicate", "work.status"]);
    expect(cli.status).toBe(1);
    expect(cli.response.outcome).toBe("invalid");
  });

  it("refuses a pointer that names a path outside the generation, and a symlink in place of a file", () => {
    const traversal = copyOut(evidence.out);
    const currentPath = path.join(traversal, "CURRENT.json");
    const current = JSON.parse(fs.readFileSync(currentPath, "utf8"));
    current.generation_ref = "../observation/generations/x";
    fs.writeFileSync(currentPath, JSON.stringify(current, null, 2), "utf8");
    const escaped = queryCorpusEvidence({ outDir: traversal, predicate: "work.status" });
    expect(escaped.outcome).toBe("invalid");
    expect(escaped.diagnostics[0]?.code).toBe("query.path_traversal");

    const linked = copyOut(evidence.out);
    const payload = path.join(generationDir(linked), "architecture-evidence.jsonl");
    const outside = path.join(tmp("l9-corpus-query-outside-"), "payload.jsonl");
    fs.copyFileSync(payload, outside);
    fs.rmSync(payload);
    fs.symlinkSync(outside, payload);
    const symlinked = queryCorpusEvidence({ outDir: linked, statementClass: "constraint" });
    expect(symlinked.outcome).toBe("invalid");
    expect(symlinked.diagnostics.map((diagnostic) => diagnostic.code)).toContain("query.symlink_refused");
  });

  it("reports an output directory with nothing published as invalid, not empty", () => {
    const response = queryCorpusEvidence({ outDir: tmp("l9-corpus-query-nothing-"), predicate: "work.status" });
    expect(response.outcome).toBe("invalid");
    expect(response.generation).toBeNull();
    expect(response.diagnostics[0]?.code).toBe("query.no_generation");
  });
});

// ───────────────────────── E. incomplete corpus ─────────────────────────

describe("E. incomplete corpus", () => {
  it("answers over a partial snapshot as incomplete, and a missing root as unavailable", () => {
    const root = path.join(tmp("l9-corpus-query-partial-"), "Designs");
    fs.mkdirSync(root);
    writeCorpus(root);
    const missing = path.join(path.dirname(root), "Unplugged");
    const out = path.join(tmp("l9-corpus-query-partial-out-"), "observation");
    const cache = path.join(tmp("l9-corpus-query-partial-cache-"), "cache");
    const result = cp.spawnSync(process.execPath, [
      SCAN_CLI, "--root", `${root}=Designs`, "--root", `${missing}=Unplugged`,
      "--out", out, "--cache-dir", cache, "--no-diff", "--allow-partial-roots", "--architecture-evidence",
    ], { encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);

    const partial = queryCorpusEvidence({ outDir: out, statementClass: "open_question" });
    expect(partial.outcome).toBe("incomplete");
    expect(partial.generation?.corpus_status).toBe("partial");
    expect(partial.generation?.missing_root_ids).toHaveLength(1);
    expect(partial.results.length).toBeGreaterThan(0);
    expect(partial.diagnostics.map((diagnostic) => diagnostic.code)).toContain("query.corpus_incomplete");

    const unavailable = queryCorpusEvidence({ outDir: out, statementClass: "open_question", root: "Unplugged" });
    expect(unavailable.outcome).toBe("unavailable");
    expect(unavailable.results).toEqual([]);
    expect(unavailable.match_count).toBeNull();
    expect(unavailable.diagnostics[0]?.code).toBe("query.root_not_observed");
    expect(runQuery(["--out", out, "--root", "Unplugged"]).status).toBe(3);

    const observed = queryCorpusEvidence({ outDir: out, statementClass: "open_question", root: "Designs" });
    expect(observed.outcome).toBe("incomplete");
    expect(observed.results.length).toBe(partial.results.length);
  });

  it("carries a cached_unchanged_assumption snapshot as exactly that, never as fully verified", () => {
    const root = path.join(tmp("l9-corpus-query-incremental-"), "Designs");
    fs.mkdirSync(root);
    writeCorpus(root);
    const out = path.join(tmp("l9-corpus-query-incremental-out-"), "observation");
    const cache = path.join(tmp("l9-corpus-query-incremental-cache-"), "cache");
    for (const pass of [1, 2]) {
      const result = cp.spawnSync(process.execPath, [
        SCAN_CLI, "--root", `${root}=Designs`, "--out", out, "--cache-dir", cache,
        "--incremental", "--architecture-evidence",
      ], { encoding: "utf8" });
      expect(result.status, `pass ${pass}: ${result.stderr}`).toBe(0);
    }
    const response = queryCorpusEvidence({ outDir: out, predicate: "work.status" });
    expect(response.outcome).toBe("ok");
    expect(response.generation?.verification.verification_class).toBe("cached_unchanged_assumption");
    expect(response.generation?.verification.statement).not.toContain("read in full");
    expect(response.generation?.evidence_age_statement).toContain("never byte-verified");
    expect(response.diagnostics.map((diagnostic) => diagnostic.code)).toContain("query.verification_assumed");
  });

  it("reports a class query against a generation that never read statements as unsupported", () => {
    const root = path.join(tmp("l9-corpus-query-plain-"), "Designs");
    fs.mkdirSync(root);
    writeCorpus(root);
    const plain = scan(root);
    const response = queryCorpusEvidence({ outDir: plain.out, statementClass: "constraint" });
    expect(response.outcome).toBe("unsupported");
    expect(response.results).toEqual([]);
    expect(response.sources.find((source) => source.source === "architecture_evidence")?.status).toBe("not_run");
    expect(runQuery(["--out", plain.out, "--class", "constraint"]).status).toBe(3);
    // Predicates are still answerable: the work signals and packets are there.
    const statuses = queryCorpusEvidence({ outDir: plain.out, predicate: "work.status" });
    expect(statuses.outcome).toBe("ok");
    expect(statuses.results.length).toBeGreaterThan(0);
  });
});

// ───────────────────────── roles and the selected view ─────────────────────────

describe("role and selected-only filters", () => {
  const overlapBy = (response: EvidenceQueryResponse): Record<string, string[] | undefined> => Object.fromEntries(
    response.results
      .filter((record) => record.source_path === "specs/overlap.md")
      .map((record) => [record.statement_class, record.selection?.selected_for_roles]),
  );

  it("filters by the role the generation recorded on each architecture-evidence record", () => {
    const response = queryCorpusEvidence({ outDir: roles.out, role: "specification" });
    expect(response.outcome).toBe("ok");
    expect(response.query.role).toBe("specification");
    expect(new Set(response.results.map((record) => record.source_path)))
      .toEqual(new Set(["specs/transport-packet-spec.docx", "specs/overlap.md"]));
    expect(response.results.every((record) => record.source === "architecture_evidence")).toBe(true);
    expect(response.results.every((record) => record.selection?.roles.includes("specification"))).toBe(true);
    // The overlapping document's records are all returned: role membership is
    // not selection, and the selection each carries is the generation's own.
    expect(overlapBy(response)).toEqual({
      constraint: ["development_handoff", "specification"],
      open_question: ["development_handoff"],
      decision_statement: ["specification"],
    });
    expect(response.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["query.role_filter_architecture_only"]);
    // The other roles, from their own declarations; unknown is what nothing matched.
    expect(new Set(queryCorpusEvidence({ outDir: roles.out, role: "research_notes" }).results.map((record) => record.source_path)))
      .toEqual(new Set(["research/latency-study.md"]));
    expect(new Set(queryCorpusEvidence({ outDir: roles.out, role: "unknown" }).results.map((record) => record.source_path)))
      .toEqual(new Set(["history/old-routing.md", "notes/untyped.md"]));
    expect(new Set(queryCorpusEvidence({ outDir: roles.out, role: "development_handoff" }).results.map((record) => record.source_path)))
      .toEqual(new Set(["handoffs/chassis-auth-handoff.md", "specs/overlap.md"]));
  });

  it("with selected-only returns only what the requested role's own rule selected — the overlap gate", () => {
    const spec = queryCorpusEvidence({ outDir: roles.out, role: "specification", selectedOnly: true });
    expect(spec.query.selected_only).toBe(true);
    expect(Object.keys(overlapBy(spec)).sort()).toEqual(["constraint", "decision_statement"]);
    const handoff = queryCorpusEvidence({ outDir: roles.out, role: "development_handoff", selectedOnly: true });
    expect(Object.keys(overlapBy(handoff)).sort()).toEqual(["constraint", "open_question"]);
    // Alone, selected-only is the global flag: each of the three is selected by some role.
    const any = queryCorpusEvidence({ outDir: roles.out, selectedOnly: true });
    expect(Object.keys(overlapBy(any)).sort()).toEqual(["constraint", "decision_statement", "open_question"]);
    expect(any.results.every((record) => record.selection?.selected === true && record.source === "architecture_evidence")).toBe(true);
    // The specification's own open question (a Word document) is unselected and stays out.
    expect(any.results.some((record) => record.source_path === "specs/transport-packet-spec.docx" && record.statement_class === "open_question")).toBe(false);
    expect(queryCorpusEvidence({ outDir: roles.out, source: "architecture_evidence", selectedOnly: true }).results).toEqual(any.results);
    // The same answers through the command line, byte for byte with the API.
    const cli = runQuery(["--out", roles.out, "--role", "specification", "--selected-only"]);
    expect(cli.status).toBe(0);
    expect(cli.stdout).toBe(renderEvidenceQueryResponse(spec));
    expect(runQuery(["--out", roles.out, "--role", "development_handoff", "--selected-only", "--class", "open_question"]).response.results
      .map((record) => record.source_path).sort()).toEqual(["handoffs/chassis-auth-handoff.md", "specs/overlap.md"]);
    expect(runQuery(["--out", roles.out, "--role", "specification", "--selected-only", "--class", "open_question"]).response.outcome).toBe("empty");
  });

  it("composes with the existing filters, and keeps a declared status independent of the role", () => {
    const archived = queryCorpusEvidence({ outDir: roles.out, role: "research_notes", status: "archived" });
    expect(archived.results.map((record) => record.source_path)).toEqual(["research/latency-study.md", "research/latency-study.md"]);
    expect(archived.results[0]?.document_declarations.statuses.map((ref) => ref.object)).toEqual(["archived"]);
    expect(queryCorpusEvidence({ outDir: roles.out, role: "specification", status: "archived" }).outcome).toBe("empty");
    expect(queryCorpusEvidence({ outDir: roles.out, role: "specification", kind: "specification", statementClass: "constraint", root: "Designs", selectedOnly: true })
      .results.map((record) => record.statement_class)).toEqual(["constraint", "constraint"]);
    expect(queryCorpusEvidence({ outDir: roles.out, role: "specification", text: "ingress", selectedOnly: true }).results.map((record) => record.value))
      .toEqual(["The chassis owns ingress."]);
  });

  it("refuses an unknown role, another source, a predicate, and a generation without the projection", () => {
    const unknown = queryCorpusEvidence({ outDir: roles.out, role: "canonical" });
    expect(unknown.outcome).toBe("unsupported");
    expect(unknown.diagnostics[0]?.code).toBe("query.unknown_role");
    for (const source of ["document_work_signals", "repository_model_packet"] as const) {
      const response = queryCorpusEvidence({ outDir: roles.out, source, role: "specification" });
      expect(response.outcome).toBe("unsupported");
      expect(response.diagnostics[0]?.code).toBe("query.role_filter_source_unsupported");
      expect(queryCorpusEvidence({ outDir: roles.out, source, selectedOnly: true }).outcome).toBe("unsupported");
    }
    const predicate = queryCorpusEvidence({ outDir: roles.out, predicate: "work.status", selectedOnly: true });
    expect(predicate.outcome).toBe("unsupported");
    expect(predicate.diagnostics[0]?.code).toBe("query.role_filter_predicate_unsupported");
    const root = path.join(tmp("l9-corpus-query-plain-roles-"), "Designs");
    fs.mkdirSync(root);
    writeRoleCorpus(root);
    const plain = scan(root);
    for (const input of [{ role: "specification" }, { selectedOnly: true }, { role: "unknown", selectedOnly: true }]) {
      const response = queryCorpusEvidence({ outDir: plain.out, ...input });
      expect(response.outcome).toBe("unsupported");
      expect(response.match_count).toBeNull();
      expect(response.diagnostics[0]?.code).toBe("query.architecture_evidence_not_run");
    }
  });

  it("reads a generation that recorded only the global flag at the fidelity it recorded", () => {
    // A pre-1.3.0 generation: the same records without selected_for_roles, with
    // every integrity proof rewritten consistently so the generation is valid.
    const copy = copyOut(roles.out);
    const dir = generationDir(copy);
    const payloadPath = path.join(dir, "architecture-evidence.jsonl");
    const manifestPath = path.join(dir, "architecture-evidence.manifest.json");
    const snapshotPath = path.join(dir, "corpus-snapshot.json");
    const records = fs.readFileSync(payloadPath, "utf8").split("\n").filter((line) => line.length > 0).map((line) => JSON.parse(line) as { selection: Record<string, unknown> });
    for (const record of records) delete record.selection.selected_for_roles;
    const payload = records.map((record) => `${canonicalCorpusJson(record, 0)}\n`).join("");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest.profile_version = "1.2.0";
    manifest.payload_byte_length = Buffer.byteLength(payload, "utf8");
    manifest.payload_artifact_hash = sha256TextPrefixed(payload);
    manifest.payload_semantic_hash = sha256TextPrefixed(canonicalCorpusJson({ schema: "l9.architecture-evidence/v1", records }, 0));
    const manifestJson = `${canonicalCorpusJson(manifest)}\n`;
    const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
    snapshot.architecture_evidence.payload_artifact_hash = manifest.payload_artifact_hash;
    snapshot.architecture_evidence.payload_semantic_hash = manifest.payload_semantic_hash;
    const snapshotJson = `${canonicalCorpusJson(snapshot)}\n`;
    fs.writeFileSync(payloadPath, payload, "utf8");
    fs.writeFileSync(manifestPath, manifestJson, "utf8");
    fs.writeFileSync(snapshotPath, snapshotJson, "utf8");
    const currentPath = path.join(copy, "CURRENT.json");
    const current = JSON.parse(fs.readFileSync(currentPath, "utf8"));
    const rewritten: Record<string, string> = {
      "architecture-evidence.jsonl": payload, "architecture-evidence.manifest.json": manifestJson, "corpus-snapshot.json": snapshotJson,
    };
    for (const file of current.files) {
      const contents = rewritten[file.path];
      if (contents !== undefined) file.content_hash = `sha256:${crypto.createHash("sha256").update(contents, "utf8").digest("hex")}`;
    }
    fs.writeFileSync(currentPath, JSON.stringify(current, null, 2), "utf8");

    // Legacy questions are answered from what was recorded.
    expect(queryCorpusEvidence({ outDir: copy, predicate: "work.status" }).outcome).toBe("ok");
    const byRole = queryCorpusEvidence({ outDir: copy, role: "specification" });
    expect(byRole.outcome).toBe("ok");
    expect(byRole.results.every((record) => record.selection?.selected_for_roles === undefined)).toBe(true);
    const selected = queryCorpusEvidence({ outDir: copy, selectedOnly: true });
    expect(selected.outcome).toBe("ok");
    expect(selected.results.length).toBe(queryCorpusEvidence({ outDir: roles.out, selectedOnly: true }).results.length);
    // The combination needs attribution the generation never recorded, and the
    // query will not reconstruct it from today's rules.
    const combined = queryCorpusEvidence({ outDir: copy, role: "specification", selectedOnly: true });
    expect(combined.outcome).toBe("unsupported");
    expect(combined.match_count).toBeNull();
    expect(combined.diagnostics[0]?.code).toBe("query.role_selection_not_recorded");
    expect(combined.diagnostics[0]?.message).toContain("profile 1.2.0");
  });

  it("refuses malformed role options under the strict grammar", () => {
    const refused = (args: string[]): string => {
      const result = cp.spawnSync(process.execPath, [QUERY_CLI, "--out", roles.out, ...args], { encoding: "utf8" });
      expect(result.status).toBe(2);
      expect(result.stdout).toBe("");
      return result.stderr;
    };
    expect(refused(["--role", "specification", "--role", "unknown"])).toContain("--role was given more than once");
    expect(refused(["--selected-only", "--selected-only"])).toContain("--selected-only was given more than once");
    expect(refused(["--selected-only=true"])).toContain("unknown option '--selected-only=true'");
    expect(refused(["--role"])).toContain("--role needs a value");
    expect(refused(["--role", ""])).toContain("--role needs a value");
    expect(refused(["specification"])).toContain("unknown option 'specification'");
    expect(refused(["--role", "specification", "extra"])).toContain("unknown option 'extra'");
    // An unknown role is a usage of the query, refused by the query: exit 3, not a search for unknown.
    const invalid = runQuery(["--out", roles.out, "--role", "canonical"]);
    expect(invalid.status).toBe(3);
    expect(invalid.response.outcome).toBe("unsupported");
    expect(invalid.response.results).toEqual([]);
  });

  it("changes nothing in an unfiltered response", () => {
    const response = queryCorpusEvidence({ outDir: roles.out, predicate: "work.status" });
    expect(Object.keys(response.query).sort()).toEqual([
      "artifact", "kind", "limit", "max_excerpt_bytes", "predicate", "root", "source", "statement_class", "status", "text",
    ]);
    expect(Object.keys(response).sort()).toEqual([
      "diagnostics", "generation", "match_count", "outcome", "query", "results", "returned_count", "schema", "sources", "truncated", "truncation_statement",
    ]);
    expect(response.diagnostics).toEqual([]);
  });
});

// ───────────────────────── F. compatibility ─────────────────────────

describe("F. compatibility", () => {
  it("changes nothing in the generation and returns identical bytes for identical questions", () => {
    const dir = generationDir(evidence.out);
    const before = treeHashes(dir);
    const currentBefore = fs.readFileSync(path.join(evidence.out, "CURRENT.json"), "utf8");
    const one = renderEvidenceQueryResponse(queryCorpusEvidence({ outDir: evidence.out, text: "Gate" }));
    const two = renderEvidenceQueryResponse(queryCorpusEvidence({ outDir: evidence.out, text: "Gate" }));
    expect(two).toBe(one);
    expect(treeHashes(dir)).toEqual(before);
    expect(fs.readFileSync(path.join(evidence.out, "CURRENT.json"), "utf8")).toBe(currentBefore);
    // No absolute path, no mount point, no wall clock in the answer.
    expect(one).not.toContain(os.tmpdir());
    expect(one).not.toContain(evidence.root);
    expect(one).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
  });

  it("truncates at the limit, says so, and counts the whole match set", () => {
    const response = queryCorpusEvidence({ outDir: evidence.out, source: "repository_model_packet", limit: 2 });
    expect(response.truncated).toBe(true);
    expect(response.returned_count).toBe(2);
    expect(response.match_count).toBeGreaterThan(2);
    expect(response.truncation_statement).toContain("narrow the query");
    // The returned records are the first of a total order over existing ids.
    const full = queryCorpusEvidence({ outDir: evidence.out, source: "repository_model_packet", limit: 500 });
    expect(full.results.slice(0, 2)).toEqual(response.results);
    const ids = full.results.map((record) => `${record.artifact_id}\u001f${record.record_id}`);
    expect([...ids].sort()).toEqual(ids);
  });

  it("refuses an unknown class, source, limit or flag rather than guessing", () => {
    expect(queryCorpusEvidence({ outDir: evidence.out, statementClass: "wish" }).outcome).toBe("unsupported");
    expect(queryCorpusEvidence({ outDir: evidence.out, limit: 0 }).outcome).toBe("invalid");
    expect(queryCorpusEvidence({ outDir: evidence.out, limit: 501 }).outcome).toBe("invalid");
    const unknown = cp.spawnSync(process.execPath, [QUERY_CLI, "--out", evidence.out, "--fuzzy", "x"], { encoding: "utf8" });
    expect(unknown.status).toBe(2);
    expect(unknown.stderr).toContain("unknown option");
    const bare = cp.spawnSync(process.execPath, [QUERY_CLI], { encoding: "utf8" });
    expect(bare.status).toBe(2);
  });

  it("answers a predicate query over every source, with the declaration map on each record", () => {
    const response = queryCorpusEvidence({ outDir: evidence.out, predicate: "work.task.open" });
    expect(response.outcome).toBe("ok");
    expect(response.results.map((record) => [record.source, record.value])).toEqual([
      ["repository_model_packet", "Move the auth middleware into the chassis"],
    ]);
    expect(response.results[0]?.document_declarations.statuses.map((ref) => ref.object)).toEqual(["blocked"]);
    const kinds = queryCorpusEvidence({ outDir: evidence.out, kind: "proposal", predicate: "document.title" });
    expect(kinds.results.map((record) => record.source_path)).toEqual(["plans/gate-routing-proposal.md"]);
  });
});
