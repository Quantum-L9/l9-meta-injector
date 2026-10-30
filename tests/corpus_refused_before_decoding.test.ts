// corpus_refused_before_decoding.test.ts — WU-050: an artifact a decoder claims
// but the scan refused before decoding (secret-shaped path, over budget,
// unreadable) is indexed as exactly that, under the decoder that claims it, and
// counted as eligible-with-refusal in the document signals.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { MemoryCorpusCache } from "../src/corpus_cache";
import {
  UNDECODED_REASON_NOT_ELIGIBLE,
  UNDECODED_REASON_OVERSIZED,
  UNDECODED_REASON_SECRET_PATH,
} from "../src/corpus_documents";
import { runCorpusScan, type CorpusScanResult } from "../src/corpus_scan";
import { defaultDecoderRegistry } from "../src/documents";
import { writeDocx } from "./helpers/document_fixtures";

const scratch: string[] = [];
function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "l9-refused-"));
  scratch.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
});

const TEXT = defaultDecoderRegistry().forPath("a.md");
const DOCX = defaultDecoderRegistry().forPath("a.docx");

function entry(result: CorpusScanResult, relative: string) {
  const found = result.documentIndex.documents.find((document) => document.root_relative_path === relative);
  expect(found, relative).toBeDefined();
  return found as NonNullable<typeof found>;
}

function formatSignal(result: CorpusScanResult, format: string) {
  return result.documentSignals.formats.find((signal) => signal.format === format);
}

function fixtureRoot(): string {
  const root = tmp();
  fs.writeFileSync(path.join(root, "secret-plan.md"), "# Plan\n\nstatus: wip\n");
  fs.writeFileSync(path.join(root, "big.md"), `# Big\n\n${"word ".repeat(400)}\n`);
  fs.writeFileSync(path.join(root, "normal.md"), "# Normal\n\nA short note.\n");
  fs.writeFileSync(path.join(root, "blob.xyz"), "opaque\n");
  writeDocx(path.join(root, "passwords.docx"), { title: "Passwords", headings: [], paragraphs: ["x"] });
  return root;
}

async function scan(root: string, extra: Partial<Parameters<typeof runCorpusScan>[0]> = {}) {
  return runCorpusScan({ roots: [{ path: root, name: "R" }], producerVersion: "t", maxFileBytes: 1000, ...extra });
}

describe("WU-050 RC-087: refused before decoding is not 'no decoder claims this'", () => {
  it("REG-WU-050-RC-087-a: a secret-named Markdown file names the secret refusal and the text decoder", async () => {
    const result = await scan(fixtureRoot());
    const secret = entry(result, "secret-plan.md");
    expect(secret.decoded).toBe(false);
    expect(secret.undecoded_reason).toBe(UNDECODED_REASON_SECRET_PATH);
    expect(secret.decoder_id).toBe("l9.text-decoder");
    expect(secret.decoder_id).toBe(TEXT?.id);
    expect(secret.decoder_version).toBe(TEXT?.version);
    expect(secret.byte_length).toBeNull();
  });

  it("REG-WU-050-RC-087-a: the refusal is a decision about the path, never cached under the content", async () => {
    const root = fixtureRoot();
    const cache = new MemoryCorpusCache();
    await scan(root, { cache });
    fs.renameSync(path.join(root, "secret-plan.md"), path.join(root, "plan.md"));
    const warm = await scan(root, { cache });
    const renamed = entry(warm, "plan.md");
    expect(renamed.decoded).toBe(true);
    expect(renamed.undecoded_reason).toBeNull();
  });

  it("REG-WU-050-RC-087-b: an oversized Markdown file is refused as oversized and counted for markdown", async () => {
    const result = await scan(fixtureRoot());
    const big = entry(result, "big.md");
    expect(big.undecoded_reason).toBe(UNDECODED_REASON_OVERSIZED);
    expect(big.decoder_id).toBe(TEXT?.id);
    expect(big.byte_length).toBeNull();
    // Filed under the claiming decoder's registered format, as the scan already
    // files a text-family encoding refusal: which of its formats the text decoder
    // would have read the bytes as is only known once it reads them.
    const claimed = formatSignal(result, TEXT?.format ?? "text");
    expect(claimed?.decoder_id).toBe(TEXT?.id);
    expect(claimed?.refusals).toContainEqual({ name: UNDECODED_REASON_OVERSIZED, count: 1 });
    expect(claimed?.refusals).toContainEqual({ name: UNDECODED_REASON_SECRET_PATH, count: 1 });
    expect(claimed?.eligible_count).toBe(2);
    expect(claimed?.decoded_count).toBe(0);
    // The one Markdown file that was opened is still the markdown format's.
    expect(formatSignal(result, "markdown")?.decoded_count).toBe(1);
  });

  it("REG-WU-050-RC-087-c: a secret-named Word document names the docx decoder", async () => {
    const result = await scan(fixtureRoot());
    const docx = entry(result, "passwords.docx");
    expect(docx.undecoded_reason).toBe(UNDECODED_REASON_SECRET_PATH);
    expect(docx.decoder_id).toBe(DOCX?.id);
    expect(docx.decoder_version).toBe(DOCX?.version);
    expect(docx.decoder_id).not.toBe(TEXT?.id);
    expect(formatSignal(result, DOCX?.format ?? "docx")?.refusals)
      .toContainEqual({ name: UNDECODED_REASON_SECRET_PATH, count: 1 });
  });

  it("REG-WU-050-RC-087-d: document index, document signals and coverage reconcile", async () => {
    const result = await scan(fixtureRoot());
    const byReason = new Map(
      result.documentIndex.summary.undecoded_by_reason.map((row) => [row.reason, row.count]),
    );
    const gap = result.coverage.documents.decode_gap;
    expect((byReason.get(UNDECODED_REASON_SECRET_PATH) ?? 0) + (byReason.get(UNDECODED_REASON_OVERSIZED) ?? 0))
      .toBe(gap.secret_skipped + gap.oversized);
    expect(byReason.get(UNDECODED_REASON_SECRET_PATH)).toBe(gap.secret_skipped);
    expect(byReason.get(UNDECODED_REASON_OVERSIZED)).toBe(gap.oversized);
    const eligible = result.documentSignals.formats.reduce((sum, signal) => sum + signal.eligible_count, 0);
    expect(eligible).toBe(result.coverage.documents.decoder_eligible_count);
  });

  it("REG-WU-050-RC-087-e: an artifact no decoder claims keeps its reason", async () => {
    const result = await scan(fixtureRoot());
    expect(entry(result, "blob.xyz").undecoded_reason).toBe(UNDECODED_REASON_NOT_ELIGIBLE);
  });
});
