// encoding_safety.test.ts — whole-file UTF-8 validation, and the mutation paths
// that depend on it.
//
// The case that motivates all of this is the file whose first 8 KiB are pure
// ASCII and whose tail is not UTF-8. A prefix probe calls it text, the injector
// decodes it with replacement characters, writes the whole file back, and the
// tail is destroyed. Every test here uses that shape rather than a file that is
// invalid from byte zero.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, test } from "vitest";
import { ENCODING_CHUNK_BYTES, probeBufferEncoding, probeFileEncoding, readUtf8Strict } from "../src/encoding";
import { injectFile } from "../src/inject";
import { findFiles, discoverFiles } from "../src/retrieval";
import { coerceNormalizedMeta } from "../src/schema";

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "l9-encoding-"));
}

/** ASCII for `padBytes`, then a lone 0x93 — valid Windows-1252, invalid UTF-8. */
function lateInvalidUtf8(padBytes: number): Buffer {
  return Buffer.concat([
    Buffer.from("# Heading\n\n".repeat(Math.ceil(padBytes / 11)), "utf8").subarray(0, padBytes),
    Buffer.from([0x93, 0x63, 0x75, 0x72, 0x6c, 0x79, 0x94, 0x0a]),
  ]);
}

const META = coerceNormalizedMeta({
  id: "enc-1", title: "Encoding", artifact_type: "source", mcp_primitive: "resource",
  callable: false, retrievable: true, injectable: true, namespace: "test",
  sharing_scope: "agnostic", source_path: "x.md", content_hash: "Unknown",
  token_cost_estimate: 0, authority: "test", created_or_detected_at: "Unknown",
});

describe("probeFileEncoding", () => {
  test("valid UTF-8 across a chunk boundary is accepted", () => {
    const root = tmp();
    const file = path.join(root, "big.md");
    // A multi-byte character straddling the chunk boundary would be misread by a
    // decoder that restarted per chunk.
    const filler = "a".repeat(ENCODING_CHUNK_BYTES - 1);
    fs.writeFileSync(file, Buffer.from(`${filler}é${"b".repeat(100)}`, "utf8"));
    const probe = probeFileEncoding(file);
    expect(probe.status).toBe("utf8");
    expect(probe.hasBom).toBe(false);
  });

  test("an invalid byte past the first 8 KiB is still detected", () => {
    const root = tmp();
    const file = path.join(root, "late.md");
    fs.writeFileSync(file, lateInvalidUtf8(16 * 1024));
    const probe = probeFileEncoding(file);
    expect(probe.status).toBe("invalid");
    expect(probe.reason).toMatch(/invalid UTF-8 at byte offset/);
  });

  test("a truncated multi-byte sequence at end of file is detected", () => {
    const root = tmp();
    const file = path.join(root, "truncated.md");
    // First two bytes of a three-byte sequence, then EOF.
    fs.writeFileSync(file, Buffer.from([0x41, 0xe2, 0x82]));
    const probe = probeFileEncoding(file);
    expect(probe.status).toBe("invalid");
    expect(probe.reason).toMatch(/truncated UTF-8 sequence/);
  });

  test("a NUL byte marks the file binary", () => {
    const root = tmp();
    const file = path.join(root, "b.bin");
    fs.writeFileSync(file, Buffer.from([0x41, 0x00, 0x42]));
    expect(probeFileEncoding(file).status).toBe("binary");
  });

  test("a UTF-8 BOM is valid and reported", () => {
    const root = tmp();
    const file = path.join(root, "bom.md");
    fs.writeFileSync(file, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("# T\n", "utf8")]));
    const probe = probeFileEncoding(file);
    expect(probe.status).toBe("utf8");
    expect(probe.hasBom).toBe(true);
  });

  test("an empty file is valid UTF-8", () => {
    const root = tmp();
    const file = path.join(root, "empty.md");
    fs.writeFileSync(file, "");
    expect(probeFileEncoding(file).status).toBe("utf8");
  });

  test("a missing file is unreadable rather than invalid", () => {
    expect(probeFileEncoding(path.join(tmp(), "absent.md")).status).toBe("unreadable");
  });

  test("buffer probing matches file probing", () => {
    expect(probeBufferEncoding(Buffer.from("é", "utf8")).status).toBe("utf8");
    expect(probeBufferEncoding(Buffer.from([0x93])).status).toBe("invalid");
    expect(probeBufferEncoding(Buffer.from([0x00])).status).toBe("binary");
  });

  test("readUtf8Strict refuses rather than decoding lossily", () => {
    const root = tmp();
    const file = path.join(root, "bad.md");
    fs.writeFileSync(file, lateInvalidUtf8(9000));
    expect(() => readUtf8Strict(file)).toThrow(/UNSUPPORTED_ENCODING/);
  });
});

describe("mutation paths refuse a lossy decode", () => {
  test("injectFile refuses a file whose tail is not UTF-8, leaving bytes intact", () => {
    const root = tmp();
    const file = path.join(root, "late.md");
    const original = lateInvalidUtf8(9000);
    fs.writeFileSync(file, original);

    expect(() => injectFile(file, META, {
      dryRun: false, outDir: tmp(), verbose: false, writeInjectLog: false,
    })).toThrow(/UNSUPPORTED_ENCODING/);

    expect(fs.readFileSync(file).equals(original)).toBe(true);
  });

  test("injectFile still works on a valid file of the same shape", () => {
    const root = tmp();
    const file = path.join(root, "good.md");
    fs.writeFileSync(file, `${"# Heading\n\n".repeat(900)}clean tail\n`);
    const result = injectFile(file, META, {
      dryRun: false, outDir: tmp(), verbose: false, writeInjectLog: false,
    });
    expect(result.headerInjected).toBe(true);
    expect(result.bodyPreserved).toBe(true);
    expect(fs.readFileSync(file, "utf8")).toContain("clean tail");
  });

  test("discovery excludes a file whose tail is not UTF-8", () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, "clean.md"), "# Clean\n");
    fs.writeFileSync(path.join(root, "late.md"), lateInvalidUtf8(9000));

    const found = findFiles(root, "**/*").map((file) => path.basename(file));
    expect(found).toEqual(["clean.md"]);

    const discovery = discoverFiles(root, "**/*");
    const ledger = discovery.summary;
    expect(JSON.stringify(ledger)).toContain("unsupported_encoding");
  });
});
