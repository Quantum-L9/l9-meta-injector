// Regression cases for WU-021: CommonMark-faithful fence exclusion (RC-095) and
// de-duplicated title status readings (RC-099).
import { describe, expect, it } from "vitest";
import { defaultExtractors } from "../src/extractors";
import { readDocumentBlockSignals } from "../src/extractors/document_blocks";
import { documentStructureExtractor, workIntelligenceExtractor } from "../src/extractors/work_intelligence";
import { interpretDocumentContent, type AssertionDraft, type Extractor } from "../src/interpretation";

function extract(extractor: Extractor, sourcePath: string, lines: string[]): AssertionDraft[] {
  return extractor.extract({
    subjectId: "artifact:test",
    sourcePath,
    content: `${lines.join("\n")}\n`,
    contentHash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    pathExists: () => false,
  });
}

const work = (lines: string[]) => extract(workIntelligenceExtractor, "a.md", lines);
const structure = (lines: string[]) => extract(documentStructureExtractor, "a.md", lines);

function objects(drafts: AssertionDraft[], predicate: string): string[] {
  return drafts.filter((draft) => draft.predicate === predicate).map((draft) => draft.object);
}

/** Every work.* claim, so a test can say "nothing was read" in one assertion. */
function workClaims(drafts: AssertionDraft[]): string[] {
  return drafts.filter((draft) => draft.predicate.startsWith("work.")).map((d) => `${d.predicate} ${d.object}`);
}

describe("RC-095: fenced code is excluded the way CommonMark delimits it", () => {
  it("REG-WU-021-RC-095-a: a shorter inner fence does not close a longer one", () => {
    const drafts = work(["````markdown", "```", "- [ ] example task", "Status: blocked", "```", "````"]);
    expect(objects(drafts, "work.task.open")).toEqual([]);
    expect(objects(drafts, "work.status")).toEqual([]);
  });

  it("REG-WU-021-RC-095-b: a fence line carrying an info string does not close the block", () => {
    const drafts = work(["```", "```js", "- [ ] inside code", "```"]);
    expect(objects(drafts, "work.task.open")).toEqual([]);
    // The block is still open after the ```js line: a task after the final
    // closer is read, one inside is not.
    const after = work(["```", "```js", "- [ ] inside code", "```", "- [ ] after"]);
    expect(objects(after, "work.task.open")).toEqual(["after"]);
  });

  it("REG-WU-021-RC-095-c: a fence indented inside a list item is a fence", () => {
    const drafts = work([
      "- Example:",
      "",
      "    ```",
      "    - [ ] not a task",
      "    Depends on: example.md",
      "    ```",
    ]);
    expect(objects(drafts, "work.task.open")).toEqual([]);
    expect(objects(drafts, "work.depends_on")).toEqual([]);
  });

  it("REG-WU-021-RC-095-d: a tilde block closes at a longer tilde run, not at backticks", () => {
    const drafts = work(["~~~", "```", "- [ ] hidden", "~~~~", "- [ ] visible"]);
    expect(objects(drafts, "work.task.open")).toEqual(["visible"]);
  });

  it("REG-WU-021-RC-095-e: a closer-shaped line with trailing text does not close the block", () => {
    const drafts = work(["```", "``` trailing", "- [ ] hidden", "Status: blocked", "```", "- [ ] visible"]);
    expect(objects(drafts, "work.task.open")).toEqual(["visible"]);
    expect(objects(drafts, "work.status")).toEqual([]);
  });

  it("REG-WU-021-RC-095-f: simple fences keep excluding headings and tasks", () => {
    expect(objects(structure(["# Real", "", "```sh", "# not a heading", "```"]), "document.heading")).toEqual([
      "H1: Real",
    ]);
    expect(objects(work(["```", "- [ ] example only", "```"]), "work.task.open")).toEqual([]);
  });

  it("REG-WU-021-RC-095-g: tasks after a correctly closed fence keep their lines", () => {
    const drafts = work(["```", "code", "```", "", "- [ ] first", "- [ ] second"]);
    expect(drafts.filter((d) => d.predicate === "work.task.open").map((d) => d.sourceRange)).toEqual([
      { start_line: 5, end_line: 5 },
      { start_line: 6, end_line: 6 },
    ]);
  });

  it("REG-WU-021-RC-095-h: a heading inside a four-backtick block wrapping three is not a heading", () => {
    const drafts = structure(["# Real", "````", "```", "# Not a heading", "```", "````", "## After"]);
    expect(objects(drafts, "document.heading")).toEqual(["H1: Real", "H2: After"]);
  });

  it("does not open a backtick fence whose info string carries a backtick", () => {
    const drafts = work(["```js`x", "- [ ] still prose"]);
    expect(objects(drafts, "work.task.open")).toEqual(["still prose"]);
  });

  it("keeps an unclosed fence running to the end of the document", () => {
    expect(workClaims(work(["```", "- [ ] hidden", "Status: wip"]))).toEqual([]);
  });

  it("never treats frontmatter delimiters as fences", () => {
    const drafts = work(["---", "status: wip", "---", "", "- [ ] read"]);
    expect(objects(drafts, "work.status")).toEqual(["wip"]);
    expect(objects(drafts, "work.task.open")).toEqual(["read"]);
  });

  it("scans a long fence-shaped line in linear time", () => {
    const started = Date.now();
    work(["```", `${"`".repeat(120000)}x`, `${" ".repeat(8)}${"~".repeat(120000)}`, "```"]);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe("RC-099: a title's statuses are each claimed once", () => {
  it("REG-WU-021-RC-099-a: a repeated status marker yields one assertion with a unique id", () => {
    const result = interpretDocumentContent({
      repositorySubjectId: "repo:fixture",
      sourcePath: "p.md",
      content: "# [WIP] Rollout Plan - WIP\n",
      extractors: defaultExtractors(),
      pathExists: () => false,
    });
    const statuses = result.assertions.filter((a) => a.predicate === "work.status");
    expect(statuses.map((a) => a.object)).toEqual(["wip"]);
    const ids = result.assertions.map((a) => a.assertion_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("REG-WU-021-RC-099-b: distinct statuses in one title are all kept", () => {
    expect(objects(work(["# [WIP] Plan - Draft"]), "work.status").sort()).toEqual(["draft", "wip"]);
  });

  it("REG-WU-021-RC-099-c: the line path and the block path agree on a title's statuses", () => {
    for (const title of ["[WIP] Rollout Plan - WIP", "[WIP] Plan - Draft", "WIP: Rollout (wip)"]) {
      const line = objects(work([`# ${title}`]), "work.status").sort();
      const block = readDocumentBlockSignals({
        subjectId: "artifact:x",
        sourcePath: "plans/a.docx",
        sourceContentHash: "sha256:aa",
        normalizedDocumentId: "normdoc:bb",
        decoderId: "l9.docx-decoder",
        decoderVersion: "1.0.0",
        format: "docx",
        blocks: [{ block_id: "b1", kind: "title", text: title, locator: { kind: "docx_block", block_index: 1, part: "word/document.xml" } }],
      })
        .filter((signal) => signal.predicate === "work.status")
        .map((signal) => signal.object)
        .sort();
      expect(line, title).toEqual(block);
      expect(new Set(line).size, title).toBe(line.length);
    }
  });
});
