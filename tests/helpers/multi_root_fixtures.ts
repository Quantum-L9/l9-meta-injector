// multi_root_fixtures.ts — the corpora the multi-root tests qualify against.
//
// Two shapes live here. `writeMultiRootCorpus` is small and every property it
// carries is deliberate, so an assertion about it can name the file it is about.
// `writeScaleCorpus` is the opposite: it is generated to a stated size so the
// scan can be qualified at the scale the contract asks for, and its content is
// described by the generator rather than by a reader.
import * as fs from "node:fs";
import * as path from "node:path";
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
}

export interface ScaleCorpusResult extends ScaleCorpusSpec {
  roots: string[];
  /** Files actually written, archives and members included. */
  writtenFiles: number;
  archiveMembers: number;
  /** Members that live inside a nested archive rather than a top-level one. */
  nestedArchiveMembers: number;
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
export function writeScaleCorpus(base: string, spec: ScaleCorpusSpec): ScaleCorpusResult {
  const rootA = path.join(base, "ScaleA");
  const rootB = path.join(base, "ScaleB");
  const rootC = path.join(base, "ScaleZips");
  let written = 0;

  for (let index = 0; index < spec.candidateProjects; index++) {
    const root = index % 2 === 0 ? rootA : rootB;
    const project = `svc-${String(index).padStart(3, "0")}`;
    write(root, `projects/${project}/package.json`, `${JSON.stringify({ name: project, version: "1.0.0" }, null, 2)}\n`);
    write(root, `projects/${project}/src/main.ts`, `export const ${project.replace(/-/g, "_")} = ${index};\n`);
    write(root, `projects/${project}/tests/main.test.ts`, `it('${project}', () => {});\n`);
    write(root, `projects/${project}/PLAN.md`, planDocument(project));
    written += 4;
  }

  // Duplicate payloads: one identical body per cluster, written into both roots.
  for (let index = 0; index < spec.duplicateClusters; index++) {
    const body = `# Shared ${index}\n\nA body repeated verbatim so its cluster is decidable.\n`;
    write(rootA, `shared/doc-${String(index).padStart(4, "0")}.md`, body);
    write(rootB, `shared/doc-${String(index).padStart(4, "0")}.md`, body);
    written += 2;
  }

  // Filler, split across the two roots and unique by construction.
  let filler = 0;
  while (written < spec.artifacts) {
    const root = filler % 2 === 0 ? rootA : rootB;
    write(
      root,
      `bulk/${String(Math.floor(filler / 500)).padStart(3, "0")}/note-${String(filler).padStart(5, "0")}.md`,
      `# Note ${filler}\n\nA unique body numbered ${filler} so no two of these collide.\n`,
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
  };
}
