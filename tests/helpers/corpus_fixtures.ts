// corpus_fixtures.ts — the deterministic corpus the intelligence tests qualify against.
//
// The corpus is written from these constants rather than committed as a tree so
// that its content, and therefore every hash, cluster id and candidate id derived
// from it, is stated in one readable place. Every property the acceptance matrix
// asserts is deliberate:
//
//   plan.md                            explicit title, kind, WIP status, tasks, dependency
//   roadmap.md                         explicit kind and two milestones
//   notes.txt                          plain text, no declared work state
//   exact-copy-of-plan.md              byte-identical to plan.md
//   revised-plan.md                    lexically close to plan.md, different bytes
//   unrelated.md                       shares no wording with plan.md
//   nested/blocked-work.md             explicit blocked status and blocker
//   archive-a.zip!/old-plan.md         a plan inside an archive
//   archive-a.zip!/copy-of-notes.txt   byte-identical to notes.txt
//   archive-a.zip!/inner.zip!/draft.md a draft two archives deep
import * as fs from "node:fs";
import * as path from "node:path";
import { writeRawZip } from "./zip_fixtures";

/**
 * The body plan.md and revised-plan.md share.
 *
 * Long enough to clear the 20-token minimum by a wide margin, so the similarity
 * score is decided by the sentences that differ rather than by the corpus being
 * too short to score at all.
 */
const SHARED_PLAN_BODY = [
  "The corpus acquisition layer observes a local folder, an external drive, or a zip archive",
  "without writing anything into the source it is reading. Archive members are staged into",
  "tool-owned scratch and carried as virtual artifacts, so the observed tree keeps the exact",
  "bytes it had before the run started. Identity is derived from content and from",
  "source-relative paths, never from the mount point the corpus happened to be read from.",
  "",
  "Interpretation runs as a separate pass over the same observation. It reads what each",
  "document declares about itself and cites the exact line that declares it, so a consumer",
  "can check every claim against the file that produced it rather than trusting the",
  "producer. Contradictions are preserved, because a document that says two things is",
  "evidence of exactly that.",
  "",
  "Exact duplicates are a decidable fact. Two artifacts are duplicates when both carry a",
  "known content hash and those hashes are equal, which is why a file on disk and a member",
  "inside an archive can belong to one cluster. The cluster names a representative so that",
  "a graph has something to draw an edge toward, and the representative is chosen by the",
  "shortest path purely so the rendering stays readable.",
  "",
  "Near-duplicate candidates are a different kind of statement. The score is the overlap of",
  "the unique five-token shingles of two normalized documents, which measures shared",
  "wording and nothing else. Two documents about entirely different subjects can share",
  "wording, and two documents about one subject can share none, so the result is offered as",
  "a candidate for a person to look at rather than as a conclusion about what the documents",
  "mean.",
  "",
  "The corpus index is a projection over those four inputs. It resolves every artifact it",
  "names against the emitted packet, so a reference that does not resolve is never written,",
  "and it carries the analysis profile that produced it so that two indexes can be compared",
  "without guessing which rules each of them was built under.",
].join("\n");

const PLAN_MD = [
  "---",
  "title: Corpus Intelligence Plan",
  "kind: plan",
  "status: WIP",
  "---",
  "",
  "# Corpus Intelligence Plan",
  "",
  "Depends on: notes.txt",
  "",
  SHARED_PLAN_BODY,
  "",
  "## Tasks",
  "",
  "- [ ] cluster exact duplicates across physical files and archive members",
  "- [ ] score near-duplicate candidates without claiming a shared topic",
  "- [x] carry artifact-scoped assertions through the packet boundary",
  "TODO: describe the corpus index projection in the architecture notes",
  "",
].join("\n");

/**
 * The same document after an edit.
 *
 * One task is reworded, one supersession pointer is added, and one task is
 * dropped. That is what a real revision of a plan looks like, and it is the shape
 * the similarity threshold has to be able to see across.
 */
const REVISED_PLAN_MD = [
  "---",
  "title: Corpus Intelligence Plan",
  "kind: plan",
  "status: WIP",
  "---",
  "",
  "# Corpus Intelligence Plan",
  "",
  "Depends on: notes.txt",
  "Supersedes: plan.md",
  "",
  SHARED_PLAN_BODY,
  "",
  "## Tasks",
  "",
  "- [ ] cluster exact duplicates across physical files and archive members",
  "- [ ] score near-duplicate candidates without claiming a shared subject",
  "- [x] carry artifact-scoped assertions through the packet boundary",
  "",
].join("\n");

const ROADMAP_MD = [
  "# Deployment Roadmap",
  "",
  "This document sequences the deployment work into ordered stages so that each stage can",
  "be verified on its own before the next one begins. Nothing here commits a date; the",
  "ordering is the commitment.",
  "",
  "## Milestones",
  "",
  "- acquisition hardening lands and the archive security suite stays green",
  "- corpus intelligence emits a deterministic index and a readable report",
  "",
  "Milestone 3: the topology consumer accepts artifact-scoped assertions unchanged",
  "",
].join("\n");

const NOTES_TXT = [
  "Title: Working Notes",
  "",
  "Rough notes taken while reading the acquisition layer. Nothing here is a decision and",
  "nothing here is a plan; the intent is to have somewhere to put an observation before it",
  "is understood well enough to write down properly.",
  "",
  "The staging directory is tool-owned and carries an ownership marker, which is what makes",
  "the recursive cleanup safe to run at all.",
  "",
].join("\n");

const UNRELATED_MD = [
  "# Office Coffee Rota",
  "",
  "Whoever finishes the pot starts the next one. The grinder setting is fourteen and the",
  "filters live in the second drawer down, behind the mugs nobody uses. If the machine",
  "shows a red light, descale it before blaming the beans.",
  "",
  "Tuesday is the day the milk delivery arrives, so nobody needs to buy any on Monday.",
  "",
].join("\n");

const BLOCKED_WORK_MD = [
  "---",
  "title: Consolidation Review",
  "status: blocked",
  "---",
  "",
  "# Consolidation Review",
  "",
  "Blocked by: the corpus index is not emitted yet",
  "References: ../plan.md",
  "",
  "Review cannot start until the corpus index exists, because the review is over the index",
  "rather than over the files themselves.",
  "",
].join("\n");

const ARCHIVED_PLAN_MD = [
  "---",
  "title: Old Acquisition Plan",
  "kind: plan",
  "status: superseded",
  "---",
  "",
  "# Old Acquisition Plan",
  "",
  "Superseded by: plan.md",
  "",
  "- [ ] expand archives beside the source file",
  "",
  "This is the approach the acquisition rewrite replaced. It is kept because deleting the",
  "record of a rejected approach makes the next person rediscover it.",
  "",
].join("\n");

const NESTED_DRAFT_MD = [
  "# World Model Sketch",
  "",
  "Status: draft",
  "",
  "Milestone: name the layers before naming the edges",
  "",
  "An early sketch of how observation, interpretation and analysis relate. Written before",
  "the acquisition layer existed, so most of the vocabulary in it is provisional.",
  "",
].join("\n");

/** Every physical file in the corpus, by source-relative path. */
export const CORPUS_FILES: Readonly<Record<string, string>> = {
  "plan.md": PLAN_MD,
  "exact-copy-of-plan.md": PLAN_MD,
  "revised-plan.md": REVISED_PLAN_MD,
  "roadmap.md": ROADMAP_MD,
  "notes.txt": NOTES_TXT,
  "unrelated.md": UNRELATED_MD,
  "nested/blocked-work.md": BLOCKED_WORK_MD,
};

/** Virtual locators the archive contributes, for readable assertions. */
export const ARCHIVE_MEMBER_PATHS = {
  oldPlan: "archive-a.zip!/old-plan.md",
  copyOfNotes: "archive-a.zip!/copy-of-notes.txt",
  innerArchive: "archive-a.zip!/inner.zip",
  nestedDraft: "archive-a.zip!/inner.zip!/draft.md",
} as const;

/**
 * Write the corpus into `root` and return it.
 *
 * The inner archive is built first so its exact bytes can be embedded in the
 * outer one; both are stored rather than deflated, which keeps the archive bytes
 * a pure function of the member content on every platform.
 */
export function writeCorpusFixture(root: string): string {
  fs.mkdirSync(root, { recursive: true });
  for (const [relative, content] of Object.entries(CORPUS_FILES)) {
    const absolute = path.join(root, ...relative.split("/"));
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content, "utf8");
  }

  const scratch = fs.mkdtempSync(path.join(root, ".corpus-fixture-build-"));
  const innerPath = path.join(scratch, "inner.zip");
  writeRawZip(innerPath, [{ name: "draft.md", content: NESTED_DRAFT_MD, stored: true }]);
  const inner = fs.readFileSync(innerPath);

  writeRawZip(path.join(root, "archive-a.zip"), [
    { name: "old-plan.md", content: ARCHIVED_PLAN_MD, stored: true },
    { name: "copy-of-notes.txt", content: NOTES_TXT, stored: true },
    { name: "inner.zip", content: inner, stored: true },
  ]);
  fs.rmSync(scratch, { recursive: true, force: true });
  return root;
}
