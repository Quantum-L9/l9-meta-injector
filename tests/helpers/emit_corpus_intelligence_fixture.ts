// emit_corpus_intelligence_fixture.ts — produce a real bundle for the consumer.
//
// l9-constellation-topology verifies an `l9.corpus-intelligence` bundle it did
// not build: it recomputes the semantic hash, checks every payload file against
// the hash the packet declares, and checks every manifest entry against the
// bytes on disk. Until now the only bundles it had to verify were ones it had
// built itself in Python, which proves the Python side is self-consistent and
// nothing about whether the two languages agree.
//
// This emits a bundle from the real producer, over the same multi-root corpus
// the CLI tests use, so the consumer can hold a fixture that actually crossed
// the boundary. Committed rather than kept in a scratch directory because a
// fixture nobody can regenerate is a fixture nobody can update: the consumer's
// PROVENANCE.md names this script and the revision it was run at.
//
//   npx tsx tests/helpers/emit_corpus_intelligence_fixture.ts <destination>
//
// The destination receives the bundle's own files — `packet.json`,
// `manifest.json` and `payload/` — not the whole generation.
import * as cp from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  writeDocx,
  writeHtml,
  writeNotebook,
  writePdf,
  writePptx,
  writeXlsx,
} from "./document_fixtures";
import { writeMultiRootCorpus } from "./multi_root_fixtures";

const REPO = path.resolve(__dirname, "..", "..");
const CLI = path.join(REPO, "scripts", "local-source-cli.js");

/** Copy a tree, so the caller gets files rather than a path into a temp dir. */
function copyTree(from: string, to: string): void {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) copyTree(source, target);
    else fs.copyFileSync(source, target);
  }
}

/**
 * One root of documents whose formats have no line numbers.
 *
 * The multi-root corpus is Markdown, JSON and TypeScript. Every claim in it is
 * line-bearing, so it reaches a consumer as a repository-model assertion and
 * `document_work_signals` comes out empty — which is correct, and useless as a
 * fixture: work signals are the channel for formats a *block decoder* reads,
 * and their locators are the part of the boundary most likely to be got wrong.
 * A DOCX block index, a PPTX slide and shape, a PDF page, a spreadsheet cell, a
 * notebook cell and an HTML node path are six different coordinate systems, each
 * renamed on the way across, and none of them was exercised end to end.
 *
 * Added here rather than to `writeMultiRootCorpus`, which several suites assert
 * the exact contents of.
 */
function blockBearingRoot(root: string): string {
  fs.mkdirSync(root, { recursive: true });
  const at = (name: string): string => path.join(root, name);
  const body = [
    "The ingest path is the piece the rest of the milestone waits on.",
    "Promotion through staging is verified against a recorded fixture.",
  ];
  writeDocx(at("brief.docx"), {
    title: "Migration Brief",
    headings: ["Scope"],
    paragraphs: ["Status: wip", "Depends on: storage-migration.md", ...body],
    listItems: ["[ ] Ship the ingest path", "[x] Draft the schema"],
  });
  writePptx(at("review.pptx"), [
    { title: "Quarterly Roadmap", bullets: ["Status: active", ...body] },
  ]);
  writeXlsx(at("tracker.xlsx"), [
    { name: "Tracker", rows: [["Status: planned"], [body[0] as string], [body[1] as string]] },
  ]);
  writeNotebook(at("study.ipynb"), {
    title: "Latency Study",
    markdown: ["Status: draft", ...body],
    code: ["print('never executed')"],
  });
  writePdf(at("research.pdf"), ["Research Summary", "Status: complete", ...body], {
    title: "Research Summary",
  });
  writeHtml(at("retro.html"), {
    title: "Retro Notes",
    headings: ["Findings"],
    paragraphs: ["Status: archived", ...body],
  });
  return root;
}

export function emitCorpusIntelligenceFixture(destination: string): string {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "cip-fixture-"));
  try {
    const corpus = writeMultiRootCorpus(path.join(scratch, "corpus"));
    // Beside the corpus, never inside it: the scanner refuses to write its
    // output into a root it is observing, and rightly — a run would otherwise
    // observe its own previous generation.
    const out = path.join(scratch, "out");
    // All four roots, so the fixture carries what only a multi-root corpus
    // produces: a project candidate spanning roots, a duplicate cluster
    // spanning roots, and a ZIP whose members duplicate documents on disk.
    const roots = [
      corpus.base,
      corpus.oldSsd,
      corpus.backup,
      corpus.archives,
      blockBearingRoot(path.join(scratch, "corpus", "Documents")),
    ];
    const result = cp.spawnSync(
      process.execPath,
      [
        CLI,
        "--corpus",
        ...roots.flatMap((root) => ["--root", `${root}=${path.basename(root)}`]),
        "--out",
        out,
        "--no-cache",
      ],
      { encoding: "utf8" },
    );
    if (result.status !== 0) {
      throw new Error(`corpus run failed:\n${result.stdout ?? ""}${result.stderr ?? ""}`);
    }
    const current = JSON.parse(fs.readFileSync(path.join(out, "CURRENT.json"), "utf8")) as {
      generation_ref: string;
    };
    const generation = path.join(out, current.generation_ref);
    const bundle = path.join(generation, "corpus-intelligence");
    if (!fs.existsSync(bundle)) {
      throw new Error(`the run published no corpus-intelligence bundle at ${bundle}`);
    }
    fs.rmSync(destination, { recursive: true, force: true });
    copyTree(bundle, path.join(destination, "corpus-intelligence"));
    // The Repository Model bundles the packet was compiled over, beside it.
    //
    // Loading the packet proves the two runtimes canonicalize identically.
    // Proving it *resolves* needs its inputs: every artifact a work signal,
    // duplicate, pair or candidate names has to exist in one of these packets,
    // and that check is the one that would catch a producer emitting a
    // structurally perfect packet about artifacts nothing observed.
    for (const root of fs.readdirSync(path.join(generation, "roots"))) {
      copyTree(
        path.join(generation, "roots", root, "bundle"),
        path.join(destination, "roots", root),
      );
    }
    return destination;
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

if (require.main === module) {
  const destination = process.argv[2];
  if (destination === undefined) {
    process.stderr.write("usage: emit_corpus_intelligence_fixture.ts <destination>\n");
    process.exit(2);
  }
  process.stdout.write(`${emitCorpusIntelligenceFixture(path.resolve(destination))}\n`);
}
