// architecture_coverage.ts — run one coverage-matrix case through the real scan.
//
// `docs/architecture-statement-coverage.json` states, for every document form the
// architecture-statement reader is asked about, exactly what it emits and what it
// reports. This helper is the one way a case is turned into that observation: the
// case's source is written as a real file (a real .docx for the Word cases), the
// corpus scan runs over it with the projection selected, and the result is
// reduced to the fields the matrix states. Nothing here reads blocks itself.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ArchitectureEvidenceRecord } from "../../src/corpus_architecture_evidence";
import { runCorpusScan } from "../../src/corpus_scan";
import { type DocxSpec, writeDocx } from "./document_fixtures";

export interface CoverageCase {
  id: string;
  status: "supported" | "unsupported" | "excluded";
  form: string;
  title: string;
  format: "markdown" | "docx";
  path: string;
  source?: string;
  docx?: DocxSpec;
  note: string;
  expect: CoverageObservation;
}

export interface CoverageRecord {
  statement_class: string;
  form: string;
  label: string;
  declared_text: string;
  locator: Record<string, unknown>;
  unit_index: number | null;
  continuation_blocks: number;
}

export interface CoverageObservation {
  records: CoverageRecord[];
  diagnostics: string[];
}

export interface CoverageMatrix {
  schema: string;
  extractor_id: string;
  extractor_version: string;
  profile_version: string;
  cases: CoverageCase[];
}

/** The matrix, as committed. */
export function loadCoverageMatrix(repo: string): CoverageMatrix {
  return JSON.parse(
    fs.readFileSync(path.join(repo, "docs", "architecture-statement-coverage.json"), "utf8"),
  ) as CoverageMatrix;
}

/** Write a case's document as a real file under a fresh root. */
export function materializeCase(testCase: CoverageCase): {
  root: string;
  file: string;
  cleanup: () => void;
} {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "l9-arch-coverage-"));
  const root = path.join(base, "Coverage");
  fs.mkdirSync(root);
  const file = path.join(root, testCase.path);
  if (testCase.format === "docx") {
    if (testCase.docx === undefined)
      throw new Error(`${testCase.id}: a docx case needs a docx spec`);
    writeDocx(file, testCase.docx);
  } else {
    if (testCase.source === undefined)
      throw new Error(`${testCase.id}: a markdown case needs a source`);
    fs.writeFileSync(file, testCase.source, "utf8");
  }
  return { root, file, cleanup: () => fs.rmSync(base, { recursive: true, force: true }) };
}

/** The position a record starts at: its first line, or its block's index. */
function startOf(record: CoverageRecord): number {
  const locator = record.locator as { line_start?: number; block_index?: number };
  return locator.line_start ?? locator.block_index ?? -1;
}

/** Source order, so the matrix reads top to bottom as the document does. */
function compareCoverageRecords(left: CoverageRecord, right: CoverageRecord): number {
  return (
    startOf(left) - startOf(right) ||
    (left.unit_index ?? -1) - (right.unit_index ?? -1) ||
    (left.declared_text < right.declared_text
      ? -1
      : left.declared_text > right.declared_text
        ? 1
        : 0)
  );
}

/** What the reader emitted and reported for one case, in a fixed order. */
export async function observeCase(testCase: CoverageCase): Promise<{
  observation: CoverageObservation;
  records: ArchitectureEvidenceRecord[];
  root: string;
  cleanup: () => void;
}> {
  const { root, cleanup } = materializeCase(testCase);
  const result = await runCorpusScan({
    roots: [{ path: root, name: "Coverage" }],
    producerVersion: "coverage-matrix",
    architectureEvidence: true,
  });
  const evidence = result.architectureEvidence;
  if (evidence === null) throw new Error("the projection was not selected");
  const records = evidence.records.filter((record) => record.source_path === testCase.path);
  const observation: CoverageObservation = {
    records: records
      .map((record) => ({
        statement_class: record.statement_class,
        form: record.recognition.form,
        label: record.recognition.label,
        declared_text: record.declared_text,
        locator: record.structured_locator,
        unit_index: record.unit_index,
        continuation_blocks: record.continuation_block_ids.length,
      }))
      .sort(compareCoverageRecords),
    diagnostics: evidence.manifest.diagnostics
      .filter((diagnostic) => diagnostic.source_path === testCase.path)
      .map((diagnostic) => diagnostic.code),
  };
  return { observation, records, root, cleanup };
}

/** Words of a text, punctuation and markup removed, for locator verification. */
export function wordsOf(text: string): string[] {
  return text
    .replace(/…$/, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 0);
}

/** True when `needle` occurs as a contiguous run of words inside `haystack`. */
export function containsWords(haystack: readonly string[], needle: readonly string[]): boolean {
  if (needle.length === 0) return false;
  for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    if (needle.every((word, offset) => haystack[start + offset] === word)) return true;
  }
  return false;
}
