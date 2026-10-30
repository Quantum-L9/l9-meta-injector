// corpus_decode_gap.test.ts — why an eligible document did not decode, by the
// reason the text path actually recorded.
//
// The text path refuses with an `EncodingStatus`: `binary` for a NUL byte,
// `invalid` for bytes that are not UTF-8, `unreadable` for a file it could not
// read. `encoding_rejected` is the first two and nothing else; `unreadable` is
// not an encoding verdict and stays with "any other refusal reason". Every
// bucket reconciles, so `unaccounted` is 0 in each case below (RC-065).
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { runCorpusScan } from "../src/corpus_scan";

/**
 * A file the scan inventoried and then could not read is an environment state
 * this suite cannot produce honestly on a filesystem it runs as root on, so the
 * derive stage's read fails for one named file and is the real read for every
 * other. Since WU-038 the derive stage reads each whole-file document once
 * (`fs.promises.readFile`) and probes that verified buffer, so the read is the
 * seam an unreadable file fails at.
 */
const UNREADABLE_BASENAME = "vanished-at-derive.md";
const realReadFile = fs.promises.readFile.bind(fs.promises);
vi.spyOn(fs.promises, "readFile").mockImplementation(((target: fs.PathLike | fs.promises.FileHandle, ...rest: unknown[]) => {
  if (typeof target === "string" && path.basename(target) === UNREADABLE_BASENAME) {
    return Promise.reject(Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" }));
  }
  return (realReadFile as (...args: unknown[]) => Promise<unknown>)(target, ...rest);
}) as typeof fs.promises.readFile);

const scratch: string[] = [];
function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "l9-decode-gap-"));
  scratch.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
});

async function decodeGapOf(files: Record<string, Buffer | string>) {
  const root = tmp();
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(root, name), content);
  const result = await runCorpusScan({ roots: [{ path: root }], producerVersion: "test" });
  return result.coverage.documents.decode_gap;
}

const latin1 = Buffer.from("Caf\xe9 cr\xe8me br\xfbl\xe9e, a note written on an old machine.\n", "latin1");
const nul = Buffer.concat([Buffer.from("header text "), Buffer.from([0x00, 0x01, 0x02]), Buffer.from(" tail\n")]);

describe("decode_gap.encoding_rejected", () => {
  it("REG-WU-044-RC-065-a: counts a Latin-1 note and a NUL-bearing text file as encoding rejections", async () => {
    const gap = await decodeGapOf({ "notes.md": latin1, "dump.txt": nul });
    expect(gap.encoding_rejected).toBe(2);
    expect(gap.other_refusal).toBe(0);
    // REG-WU-044-RC-065-c
    expect(gap.unaccounted).toBe(0);
  });

  it("REG-WU-044-RC-065-b: still counts a binary text file alone", async () => {
    const gap = await decodeGapOf({ "dump.txt": nul });
    expect(gap.encoding_rejected).toBe(1);
    expect(gap.other_refusal).toBe(0);
    // REG-WU-044-RC-065-c
    expect(gap.unaccounted).toBe(0);
  });

  it("REG-WU-044-RC-065-c: reconciles every bucket on a corpus mixing decoded and refused documents", async () => {
    const gap = await decodeGapOf({
      "readme.md": "# A readable note\n\nPlain UTF-8 text.\n",
      "notes.md": latin1,
      "dump.txt": nul,
    });
    expect(gap.encoding_rejected).toBe(2);
    expect(gap.unaccounted).toBe(0);
  });

  it("REG-WU-044-RC-065-d: leaves a file unreadable at derive time in other_refusal", async () => {
    const gap = await decodeGapOf({ [UNREADABLE_BASENAME]: "# Present at inventory\n", "dump.txt": nul });
    expect(gap.other_refusal).toBe(1);
    expect(gap.encoding_rejected).toBe(1);
    expect(gap.unaccounted).toBe(0);
  });
});
