// corpus_topology_handoff.test.ts — the producer side of a boundary, proved from outside.
//
// Everything else in this suite checks the payload against the run that produced
// it. That is necessary and it is not the question a downstream consumer asks. A
// consumer has a generation directory and nothing else, and has to be able to
// say: how many signals were there, do I have all of them, and does each one
// attach to an artifact I already know about.
//
// So this file reads the payload the way that consumer would — parsing the JSONL,
// trusting the manifest only after checking it, resolving ids against the per-root
// packets rather than against the corpus internals — over a fixture deliberately
// built to be awkward. Several roots, every format, documents buried two archives
// deep, relations pointing at other documents, one body duplicated across roots,
// two documents disagreeing about their own status, and one format stating far
// more than the report will list.
//
// That last property is the point of the fixture. If a consumer can be made to
// pass by reading `document-signals.json`, the boundary has not been proved; the
// fixture forces the report and the payload apart so that reading the wrong one
// is a test failure rather than a latent bug.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { MAX_LISTED_SIGNALS_PER_FORMAT } from "../src/corpus_document_signals";
import { verifyDocumentWorkSignalExport } from "../src/corpus_work_signal_export";
import type { DocumentWorkSignalRecord } from "../src/corpus_work_signal_export";
import { runCorpusScan } from "../src/corpus_scan";
import type { CorpusScanResult } from "../src/corpus_scan";
import {
  writeDocx,
  writeHtml,
  writeNotebook,
  writePdf,
  writePptx,
  writeXlsx,
} from "./helpers/document_fixtures";
import { writeRawZip } from "./helpers/zip_fixtures";

const scratch: string[] = [];
function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "l9-handoff-"));
  scratch.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
});

/** Signals stated by one format, past the point the report stops listing them. */
const HIGH_VOLUME_ROWS = 90;

/** The body written into both roots, so a duplicate crosses a root boundary. */
const SHARED_PLAN = "# Shared Migration Plan\n\nStatus: wip\n\n- [ ] Cut the index over\n";

interface HandoffCorpus {
  roots: { path: string; name: string }[];
}

/**
 * A corpus with every shape the boundary has to carry.
 *
 * Written out by hand rather than generated, because each file here is present
 * for a reason a reader should be able to see: this one is the duplicate, this
 * one contradicts itself, this one is two archives down.
 */
function handoffCorpus(): HandoffCorpus {
  const base = tmp();
  const primary = path.join(base, "Working");
  const backup = path.join(base, "Backup");
  const staging = tmp();
  for (const root of [primary, backup]) fs.mkdirSync(root, { recursive: true });

  // Markdown, read by the line-based reader and therefore absent from this
  // payload by design. Present so the fixture proves the boundary excludes it
  // deliberately rather than by omission.
  fs.writeFileSync(path.join(primary, "plan.md"), SHARED_PLAN, "utf8");
  // The same bytes in the other root: one exact duplicate, crossing roots.
  fs.writeFileSync(path.join(backup, "plan.md"), SHARED_PLAN, "utf8");

  writeDocx(path.join(primary, "world-model.docx"), {
    title: "World Model WIP",
    headings: ["Scope", "Milestones"],
    paragraphs: [
      "Status: wip",
      "Depends on: storage-migration.md",
      "Blocked by: vendor contract",
    ],
    listItems: ["[ ] Ship the ingest path", "[x] Draft the schema"],
  });
  writePdf(
    path.join(primary, "research.pdf"),
    [
      "Storage Research",
      "Status: complete",
      "Supersedes: earlier-draft.md",
      "References: world-model.docx",
    ],
    { title: "Storage Research" },
  );
  writePptx(path.join(primary, "roadmap.pptx"), [
    { title: "Q3 Product Roadmap", bullets: ["Status: active"], notes: "Blocked by: legal review" },
    { title: "Delivery", bullets: ["[ ] Sign the hosting contract"] },
  ]);
  writeNotebook(path.join(primary, "latency.ipynb"), {
    title: "Latency Notes",
    markdown: ["Status: draft", "[ ] Re-run the benchmark"],
    code: ["print('never executed')"],
  });
  writeHtml(path.join(primary, "design.html"), {
    title: "Design Notes",
    headings: ["Findings"],
    paragraphs: ["Status: archived", "References: roadmap.pptx"],
  });
  fs.writeFileSync(
    path.join(primary, "register.csv"),
    "owner,status,depends on\nmel,blocked,vendor-contract.md\nkim,active,\n",
    "utf8",
  );

  // A tracker stating far more than the report will list. One populated cell is
  // one block, and a cell that declares a status is a signal, so a tracker of
  // this size is an ordinary thing to find in a corpus rather than a shape built
  // to defeat the sampler.
  writeXlsx(path.join(primary, "tracker.xlsx"), [
    {
      name: "Tracker",
      rows: [
        ["Milestone", "State"],
        ...Array.from({ length: HIGH_VOLUME_ROWS }, (_, index) => [
          `Deliverable ${String(index).padStart(3, "0")}`,
          index % 2 === 0 ? "Status: blocked" : "Status: planned",
        ]),
      ],
    },
  ]);

  // The same document said to be two different things. Both claims survive:
  // choosing one would be reconciliation, which is not this producer's job.
  writeDocx(path.join(primary, "contradiction.docx"), {
    title: "Rollout Plan",
    headings: ["State"],
    paragraphs: ["Status: complete", "Status: blocked"],
  });

  // A Word document inside a ZIP, and another two archives down.
  const buried = writeDocx(path.join(staging, "buried.docx"), {
    title: "Archived Proposal",
    headings: ["Scope"],
    paragraphs: ["Status: superseded", "Superseded by: world-model.docx"],
  });
  writeRawZip(path.join(backup, "old.zip"), [
    { name: "plans/buried.docx", content: fs.readFileSync(buried) },
  ]);
  const inner = path.join(staging, "inner.zip");
  writeRawZip(inner, [{ name: "deep/buried.docx", content: fs.readFileSync(buried) }]);
  writeRawZip(path.join(backup, "nested.zip"), [
    { name: "carried/inner.zip", content: fs.readFileSync(inner) },
  ]);

  return {
    roots: [
      { path: primary, name: "Working" },
      { path: backup, name: "Backup" },
    ],
  };
}

/** Parse the payload the way a consumer holding only the generation would. */
function readPayload(jsonl: string): DocumentWorkSignalRecord[] {
  return jsonl
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as DocumentWorkSignalRecord);
}

let cached: CorpusScanResult | null = null;
async function handoff(): Promise<CorpusScanResult> {
  // One scan, reused: the fixture is deliberately large and every test below
  // asks a different question about the same generation.
  cached ??= await runCorpusScan({ roots: handoffCorpus().roots, producerVersion: "handoff" });
  return cached;
}

describe("the fixture a Topology consumer is handed", () => {
  it("holds every shape the boundary has to carry", async () => {
    const result = await handoff();

    expect(result.snapshot.counts.root_count).toBe(2);
    expect(result.snapshot.counts.archive_count).toBeGreaterThanOrEqual(3);

    const formats = new Set(
      result.documentSignals.block_signals.by_format.map((entry) => entry.format),
    );
    for (const format of ["docx", "pdf", "pptx", "xlsx", "ipynb", "csv", "html"]) {
      expect(formats.has(format), `${format} states something`).toBe(true);
    }
    // Markdown is read by the line-based reader, so it is absent from this
    // payload on purpose rather than by omission.
    expect(formats.has("markdown")).toBe(false);

    const records = readPayload(result.documentWorkSignals.payloadJsonl);
    const predicates = new Set(records.map((record) => record.predicate));
    for (const predicate of [
      "work.depends_on",
      "work.blocked_by",
      "work.references",
      "work.supersedes",
      "work.superseded_by",
      "work.status",
      "work.task.open",
      "work.task.completed",
    ]) {
      expect(predicates.has(predicate), predicate).toBe(true);
    }

    // A duplicate that crosses a root boundary.
    expect(result.candidates.summary.cross_root_duplicate_cluster_count).toBeGreaterThan(0);

    // One document saying two contradictory things about itself, both kept.
    const contradiction = records.filter(
      (record) => record.source_path.endsWith("contradiction.docx")
        && record.predicate === "work.status",
    );
    expect(new Set(contradiction.map((record) => record.object)))
      .toEqual(new Set(["complete", "blocked"]));

    // Documents one and two archives deep, at their virtual locators.
    const paths = records.map((record) => record.source_path);
    expect(paths).toContain("old.zip!/plans/buried.docx");
    expect(paths).toContain("nested.zip!/carried/inner.zip!/deep/buried.docx");
  });

  it("states more in one format than the report will list", async () => {
    const result = await handoff();
    const xlsx = result.documentSignals.block_signals.by_format
      .find((entry) => entry.format === "xlsx");

    // The property that makes this fixture a proof rather than a demonstration:
    // a consumer that read the report instead of the payload gets a different,
    // smaller answer, and its own assertions fail.
    expect(xlsx?.signal_count).toBeGreaterThanOrEqual(75);
    expect(xlsx?.listed_signal_count).toBe(MAX_LISTED_SIGNALS_PER_FORMAT);
    expect(xlsx?.omitted_signal_count).toBeGreaterThan(0);
    expect(xlsx?.listed_signal_count).toBeLessThan(xlsx?.signal_count as number);
  });
});

describe("a consumer holding only the generation", () => {
  it("can prove it received every signal the corpus produced", async () => {
    const result = await handoff();
    const records = readPayload(result.documentWorkSignals.payloadJsonl);

    // The check a consumer runs before trusting anything: the manifest against
    // the bytes it arrived with.
    const problems = verifyDocumentWorkSignalExport({
      manifest: result.documentWorkSignals.manifest,
      payloadJsonl: result.documentWorkSignals.payloadJsonl,
      knownArtifactIds: new Set(result.snapshot.artifacts.map((a) => a.virtual_source_id)),
      knownNormalizedDocumentIds: new Set(
        result.documentIndex.documents
          .map((document) => document.normalized_document_id)
          .filter((id): id is string => id !== null),
      ),
      reportSignalCount: result.documentSignals.block_signals.signal_count,
    });
    expect(problems).toEqual([]);
    expect(records).toHaveLength(result.documentWorkSignals.manifest.record_count);
    expect(records.length).toBeGreaterThan(75);
  });

  it("can attach every signal to an artifact its root's packet already names", async () => {
    const result = await handoff();
    const records = readPayload(result.documentWorkSignals.payloadJsonl);

    // The ids a Topology adapter works in: it reads packets, not corpus
    // internals, so every record has to name an artifact one of the per-root
    // bundles contains.
    const packetArtifactIds = new Set(
      result.rootPackets.flatMap((root) =>
        (root.packet.payload.artifacts as { artifact_id: string }[])
          .map((artifact) => artifact.artifact_id)),
    );
    expect(packetArtifactIds.size).toBeGreaterThan(0);
    for (const record of records) {
      expect(
        packetArtifactIds.has(record.rmp_artifact_id),
        `${record.source_path} resolves into a per-root packet`,
      ).toBe(true);
    }
  });

  it("receives a usable coordinate for every claim", async () => {
    const result = await handoff();
    const records = readPayload(result.documentWorkSignals.payloadJsonl);

    const kindsByFormat = new Map<string, Set<string>>();
    for (const record of records) {
      const kinds = kindsByFormat.get(record.format) ?? new Set<string>();
      kinds.add(String(record.structured_locator.kind));
      kindsByFormat.set(record.format, kinds);
      // Survived the generation: still structured, still not a line number for a
      // file that has no lines.
      expect(Object.keys(record.structured_locator).length).toBeGreaterThan(1);
      expect(record.structured_locator.kind).not.toBe("line_span");
      expect(record.block_id.length).toBeGreaterThan(0);
    }
    expect([...kindsByFormat.get("docx") ?? []]).toEqual(["docx_block"]);
    expect([...kindsByFormat.get("pptx") ?? []]).toEqual(["pptx_shape"]);
    expect([...kindsByFormat.get("xlsx") ?? []]).toEqual(["spreadsheet_cell"]);
    expect([...kindsByFormat.get("pdf") ?? []]).toEqual(["pdf_page_block"]);
    expect([...kindsByFormat.get("csv") ?? []]).toEqual(["csv_row"]);
    expect([...kindsByFormat.get("html") ?? []]).toEqual(["html_node"]);
    expect([...kindsByFormat.get("ipynb") ?? []]).toEqual(["notebook_cell"]);
  });

  it("is handed nothing that names this machine", async () => {
    const result = await handoff();
    const payload = result.documentWorkSignals.payloadJsonl;
    expect(payload).not.toContain(os.tmpdir());
    expect(payload).not.toContain(os.homedir());
    for (const record of readPayload(payload)) {
      expect(path.isAbsolute(record.source_path)).toBe(false);
    }
  });
});
