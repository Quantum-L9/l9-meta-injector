// multi_root_fixtures.ts — the corpora the multi-root tests qualify against.
//
// Two shapes live here. `writeMultiRootCorpus` is small and every property it
// carries is deliberate, so an assertion about it can name the file it is about.
// `writeScaleCorpus` is the opposite: it is generated to a stated size so the
// scan can be qualified at the scale the contract asks for, and its content is
// described by the generator rather than by a reader.
import * as fs from "node:fs";
import * as path from "node:path";
import {
  writeDocx,
  writeHtml,
  writeNotebook,
  writePdf,
  writePptx,
  writeXlsx,
} from "./document_fixtures";
import { writeRawZip } from "./zip_fixtures";

function write(root: string, relative: string, contents: string): void {
  const absolute = path.join(root, relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, contents, "utf8");
}

/** A plan long enough to clear the lexical minimum, parameterized by subject. */
export function planDocument(subject: string, extra = ""): string {
  return [
    `# ${subject} Deployment Plan`,
    "",
    "Status: WIP",
    "Type: plan",
    "",
    `The ${subject} service is deployed from a container image built in continuous`,
    `integration and promoted through staging before production. The ${subject} routing`,
    "table is regenerated whenever an upstream dependency changes, and the regeneration",
    "is verified against a recorded fixture rather than against a live upstream.",
    "",
    "- [ ] wire up the routing table",
    "- [x] pick a hosting region",
    "",
    "Blocked by: procurement",
    "Depends on: platform-team",
    extra,
  ].join("\n");
}

export interface MultiRootCorpus {
  base: string;
  oldSsd: string;
  backup: string;
  archives: string;
}

/**
 * Three roots that overlap the way a real archive overlaps.
 *
 * - `widget-api` exists on both disks, so its project candidate spans roots.
 * - `PLAN.md` is byte-identical on both disks, so its duplicate cluster does too.
 * - `notes/` on each disk holds the same relative filename with different bytes,
 *   which is the case a path namespace has to keep apart.
 * - the archive root holds a ZIP whose members duplicate documents on disk.
 */
export function writeMultiRootCorpus(base: string): MultiRootCorpus {
  const oldSsd = path.join(base, "OldSSD");
  const backup = path.join(base, "Backup");
  const archives = path.join(base, "ArchiveZips");

  const plan = planDocument("Widget");
  write(oldSsd, "widget-api/package.json", `${JSON.stringify({ name: "widget-api", version: "2.0.0" }, null, 2)}\n`);
  write(oldSsd, "widget-api/src/index.ts", "export const widget = 1;\n");
  write(oldSsd, "widget-api/src/router.ts", "export const route = () => 1;\n");
  write(oldSsd, "widget-api/tests/router.test.ts", "it('routes', () => {});\n");
  write(oldSsd, "widget-api/.github/workflows/ci.yml", "on: push\njobs: {}\n");
  write(oldSsd, "widget-api/Dockerfile", "FROM scratch\n");
  write(oldSsd, "widget-api/PLAN.md", plan);
  write(oldSsd, "notes/monday.md", "# Monday\n\nA short note about nothing in particular.\n");
  // The two gaps, one of each kind. A `.doc` is an OLE compound document: a
  // text-bearing format nothing in the shipped registry opens, so its bytes are
  // never looked at and a placeholder is honest. A `.png` is a document with no
  // text layer, which is a different finding and is also never opened.
  //
  // Deliberately not a `.pdf` or a `.docx`: those *are* decoded now, so a
  // placeholder in either would be a decode failure rather than a gap, and this
  // test is about the gap.
  write(oldSsd, "reports/quarterly.doc", "not really a doc\n");
  write(oldSsd, "photos/scan.png", "PNG not really a png\n");

  write(backup, "widget-api/package.json", `${JSON.stringify({ name: "widget-api", version: "1.4.0" }, null, 2)}\n`);
  write(backup, "widget-api/src/index.ts", "export const widget = 0;\n");
  write(backup, "widget-api/PLAN.md", plan);
  write(backup, "widget-api/ROADMAP.md", [
    "# Widget Roadmap",
    "",
    "Type: roadmap",
    "",
    "Milestone 1: ship the routing table",
    "Milestone 2: promote the container image through staging",
    "",
    "Supersedes: the 2019 routing note",
  ].join("\n"));
  write(backup, "notes/monday.md", "# Monday\n\nA different short note about something else entirely.\n");

  fs.mkdirSync(archives, { recursive: true });
  writeRawZip(path.join(archives, "old-work.zip"), [
    { name: "widget-api/PLAN.md", content: plan },
    { name: "loose/README.md", content: "# Loose\n\nA readme that lives only inside the archive.\n" },
  ]);

  return { base, oldSsd, backup, archives };
}

export interface ScaleCorpusSpec {
  /** Artifacts written directly to disk, before archives. */
  artifacts: number;
  archives: number;
  /** Distinct byte payloads that appear more than once. */
  duplicateClusters: number;
  candidateProjects: number;
  /** Archives that hold another archive, so nesting is exercised at depth. */
  nestedArchives: number;
  /**
   * Documents to write *per binary format*.
   *
   * A scale corpus made only of Markdown qualifies the passes that read Markdown
   * and nothing else. The operator's disks are not made of Markdown: they are
   * made of Word documents, decks, spreadsheets, notebooks and PDFs, and every
   * one of those has to be opened by a decoder before a single word of it can
   * reach a topic. Leaving them out would mean the ten-thousand-document run
   * measured the cheapest path through the scan.
   */
  mixedDocumentsPerFormat: number;
}

export interface ScaleCorpusResult extends ScaleCorpusSpec {
  roots: string[];
  /** Files actually written, archives and members included. */
  writtenFiles: number;
  archiveMembers: number;
  /** Members that live inside a nested archive rather than a top-level one. */
  nestedArchiveMembers: number;
  /** How many documents of each format the corpus holds, by decoder format name. */
  mixedDocumentCounts: Record<string, number>;
}

/**
 * A corpus generated to a stated size, split across three roots.
 *
 * Three rather than two, and the third is a ZIP-only root, because that is the
 * shape a real archive corpus has: a working drive, a backup of it, and a folder
 * of zips nobody has opened in years. The duplicate payloads are written into
 * more than one root so the duplicate clusters are cross-root by construction,
 * and the projects are given declared identifiers so the project candidates are
 * too. Documents are kept short: the qualification this fixture supports is about
 * scale and identity, and a corpus of long documents would spend the whole test
 * budget on shingling.
 */
/**
 * Vocabulary every filler note carries: the common terms an index must not hold.
 *
 * One sentence rather than a paragraph. It only has to be present in every
 * document to be the common vocabulary the prefix bound must exclude, and every
 * extra word is ten thousand more shingles for the near-duplicate pass to hash.
 */
const SCALE_BOILERPLATE =
  "This note was written during the migration and kept for the record.";

/** Subjects the filler notes are drawn from, so real topic groups exist. */
const SCALE_SUBJECTS: readonly string[] = [
  "Acquisition reads a folder, an external drive or a zip archive without writing into it.",
  "Identity comes from content hashes and root-relative paths, never from a mount point.",
  "The cache is keyed by the bytes and by the identity of the rules applied to them.",
  "Duplicate clusters are byte equality and are facts rather than similarity judgements.",
  "Near-duplicate candidates report shared shingles and claim nothing about meaning.",
  "Coverage reports what the decoders could not open as well as what they could.",
  "Archive members are staged into tool-owned scratch and carried as virtual artifacts.",
  "Readiness evidence is counts and citations, and carries no ranking or priority.",
  "Resumable scans record completed work so an interrupted run does not repeat it.",
  "Embedding vectors are candidate analysis and never become facts about a corpus.",
  "Snapshot identity excludes every analysis profile so a policy change is not a byte change.",
  "Project candidates come from a declared manifest identifier rather than a directory name.",
];

/**
 * One filler note: boilerplate, a subject, and a line nothing else has.
 *
 * Long enough to clear the topic pass's minimum token count, which is what makes
 * a ten-thousand-document scale run a test of the topic pass rather than a test
 * of a corpus that had nothing for it to look at.
 */
function scaleNoteBody(index: number): string {
  const subject = SCALE_SUBJECTS[index % SCALE_SUBJECTS.length] as string;
  return [
    `# Note ${index}`,
    "",
    SCALE_BOILERPLATE,
    subject,
    "",
    `Reference ${index}: a paragraph unique to note ${index} and found nowhere else.`,
    "",
  ].join("\n");
}

/**
 * The prose a mixed-format document carries.
 *
 * Drawn from the same subject pool as the Markdown filler, on purpose: a PDF that
 * shares no vocabulary with anything else in the corpus can be decoded perfectly
 * and still join no topic, and a scale run over such a corpus would report the
 * decoders working and the analysis finding nothing — indistinguishable from the
 * decoders not being wired to the analysis at all.
 */
function mixedDocumentLines(index: number): string[] {
  const subject = SCALE_SUBJECTS[index % SCALE_SUBJECTS.length] as string;
  return [
    SCALE_BOILERPLATE,
    subject,
    `Filed as document ${index} and carried forward from the previous review.`,
  ];
}

/**
 * Write one document of every binary format, numbered.
 *
 * Each states something explicit about itself, so the corpus exercises the block
 * reader at scale rather than only the decoders: a run where ten thousand
 * documents are decoded and none of them is found to say anything is the failure
 * these formats were added to catch.
 */
function writeMixedDocuments(
  root: string,
  directory: string,
  index: number,
): Record<string, number> {
  const stamp = String(index).padStart(3, "0");
  const lines = mixedDocumentLines(index);
  const at = (name: string): string => path.join(root, directory, name);
  fs.mkdirSync(path.join(root, directory), { recursive: true });

  writeDocx(at(`brief-${stamp}.docx`), {
    title: `Migration Brief ${stamp}`,
    headings: ["Scope"],
    paragraphs: ["Status: wip", ...lines],
    listItems: [`[ ] Complete review ${stamp}`],
  });
  writePptx(at(`review-${stamp}.pptx`), [
    { title: `Quarterly Roadmap ${stamp}`, bullets: ["Status: active", ...lines] },
  ]);
  // The stamp appears in the body of every format, not only in its filename.
  // Without it the spreadsheets and registers sharing a subject would be byte
  // identical, and the fixture would manufacture duplicate clusters the spec did
  // not ask for — quietly changing what the duplicate assertions are measuring.
  writeXlsx(at(`tracker-${stamp}.xlsx`), [
    {
      name: "Tracker",
      rows: [["Status: planned"], [`Tracker ${stamp}`], [lines[0] as string], [lines[1] as string]],
    },
  ]);
  writeNotebook(at(`study-${stamp}.ipynb`), {
    title: `Latency Study ${stamp}`,
    markdown: ["Status: draft", ...lines],
    code: ["print('never executed')"],
  });
  writePdf(at(`research-${stamp}.pdf`), [`Research Summary ${stamp}`, "Status: complete", ...lines], {
    title: `Research Summary ${stamp}`,
  });
  writeHtml(at(`retro-${stamp}.html`), {
    title: `Retro Notes ${stamp}`,
    headings: ["Findings"],
    paragraphs: ["Status: archived", ...lines],
  });
  write(
    root,
    `${directory}/register-${stamp}.csv`,
    // A register with a status column, which is what a register is. The column
    // name is the label, so this gives the block reader a `csv_row` coordinate to
    // cite at scale rather than only the formats that are ZIP containers.
    `register,subject,status\n"${stamp}","${lines[1]}","planned"\n`,
  );

  return { docx: 1, pptx: 1, xlsx: 1, ipynb: 1, pdf: 1, html: 1, csv: 1 };
}

export function writeScaleCorpus(base: string, spec: ScaleCorpusSpec): ScaleCorpusResult {
  const rootA = path.join(base, "ScaleA");
  const rootB = path.join(base, "ScaleB");
  const rootC = path.join(base, "ScaleZips");
  let written = 0;
  const mixedDocumentCounts: Record<string, number> = {};

  for (let index = 0; index < spec.candidateProjects; index++) {
    const root = index % 2 === 0 ? rootA : rootB;
    const project = `svc-${String(index).padStart(3, "0")}`;
    write(root, `projects/${project}/package.json`, `${JSON.stringify({ name: project, version: "1.0.0" }, null, 2)}\n`);
    write(root, `projects/${project}/src/main.ts`, `export const ${project.replace(/-/g, "_")} = ${index};\n`);
    write(root, `projects/${project}/tests/main.test.ts`, `it('${project}', () => {});\n`);
    write(root, `projects/${project}/PLAN.md`, planDocument(project));
    written += 4;
  }

  // Mixed-format documents, split across the two file roots so neither the
  // decoders nor the block reader can be qualified on one root's worth of them.
  for (let index = 0; index < spec.mixedDocumentsPerFormat; index++) {
    const root = index % 2 === 0 ? rootA : rootB;
    const counts = writeMixedDocuments(root, "documents", index);
    for (const [format, count] of Object.entries(counts)) {
      mixedDocumentCounts[format] = (mixedDocumentCounts[format] ?? 0) + count;
      written += count;
    }
  }

  // Duplicate payloads: one identical body per cluster, written into both roots.
  for (let index = 0; index < spec.duplicateClusters; index++) {
    const body = `# Shared ${index}\n\nA body repeated verbatim so its cluster is decidable.\n`;
    write(rootA, `shared/doc-${String(index).padStart(4, "0")}.md`, body);
    write(rootB, `shared/doc-${String(index).padStart(4, "0")}.md`, body);
    written += 2;
  }

  // Filler, split across the two roots and unique by construction.
  //
  // Deliberately real prose rather than one line each. A corpus of one-sentence
  // notes is below the topic pass's minimum token count, so a scale run over it
  // would report zero eligible documents and qualify nothing — which is a
  // quieter version of switching the pass off.
  //
  // Each body has three parts, and each part is there for a reason:
  //
  //   - boilerplate every note shares, which is the vocabulary that produces a
  //     posting list the size of the corpus and is exactly what the rarest-first
  //     prefix bound has to keep out of the index;
  //   - a subject drawn from a small pool, so genuine topic groups exist to be
  //     found rather than a corpus of ten thousand unrelated documents where
  //     finding nothing would look like success;
  //   - a unique line, so no two filler documents are duplicates of each other.
  let filler = 0;
  while (written < spec.artifacts) {
    const root = filler % 2 === 0 ? rootA : rootB;
    write(
      root,
      `bulk/${String(Math.floor(filler / 500)).padStart(3, "0")}/note-${String(filler).padStart(5, "0")}.md`,
      scaleNoteBody(filler),
    );
    filler++;
    written++;
  }

  // Archives spread over all three roots, with the ZIP-only root taking the
  // largest share: a folder of zips is a root in its own right, not a corner of
  // one, and the corpus must cross that boundary like any other.
  const archiveRoots = [rootC, rootA, rootB, rootC];
  let archiveMembers = 0;
  let nestedArchiveMembers = 0;
  for (let index = 0; index < spec.archives; index++) {
    const root = archiveRoots[index % archiveRoots.length] as string;
    const target = path.join(root, "zips", `bundle-${String(index).padStart(3, "0")}.zip`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const members = [
      { name: "notes/inner.md", content: `# Inner ${index}\n\nA member body numbered ${index}.\n` },
      { name: "notes/shared.md", content: "# Shared member\n\nIdentical in every archive in this corpus.\n" },
    ];
    writeRawZip(target, members);
    archiveMembers += members.length;
    written += 1;
  }

  // Nested archives: a ZIP holding a ZIP, so depth is exercised rather than
  // assumed. Built by writing the inner archive to a scratch path, reading its
  // bytes back, and storing them as a member of the outer one.
  const scratch = path.join(base, ".nested-scratch");
  fs.mkdirSync(scratch, { recursive: true });
  for (let index = 0; index < spec.nestedArchives; index++) {
    const innerPath = path.join(scratch, `inner-${index}.zip`);
    const innerMembers = [
      { name: "deep/buried.md", content: `# Buried ${index}\n\nTwo archives down, and still observed.\n` },
    ];
    writeRawZip(innerPath, innerMembers);
    const outer = path.join(rootC, "zips", `nested-${String(index).padStart(2, "0")}.zip`);
    fs.mkdirSync(path.dirname(outer), { recursive: true });
    writeRawZip(outer, [
      { name: "carried/inner.zip", content: fs.readFileSync(innerPath) },
      { name: "readme.md", content: `# Nested ${index}\n\nThe archive beside this one holds another.\n` },
    ]);
    archiveMembers += 2;
    nestedArchiveMembers += innerMembers.length;
    written += 1;
  }
  fs.rmSync(scratch, { recursive: true, force: true });

  return {
    ...spec,
    roots: [rootA, rootB, rootC],
    writtenFiles: written,
    archiveMembers,
    nestedArchiveMembers,
    mixedDocumentCounts,
  };
}
