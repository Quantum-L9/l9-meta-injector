import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { verify } from "../src/verify";
import { contentHash, stripExistingFrontMatter } from "../src/extract";
import { inspectFrontMatterDocument, patchManagedFrontMatter } from "../src/frontmatter_patch";
import { NormalizedMeta } from "../src/schema";

// verify() only reads these fields off the meta; a minimal cast is sufficient.
const meta = {
  artifact_type: "context",
  callable: false,
  mcp_primitive: "none",
  namespace: "l9",
  sharing_scope: "private",
} as unknown as NormalizedMeta;

function tmpFile(contents: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "l9-verify-"));
  const fp = path.join(dir, "doc.md");
  fs.writeFileSync(fp, contents);
  return fp;
}

describe("verify — bodyPreserved reflects the actual body hash", () => {
  it("bodyPreserved=true when the recovered body matches origHash", () => {
    const injected = "---\nid: x\n---\nHello body\n";
    const fp = tmpFile(injected);
    const origHash = contentHash(stripExistingFrontMatter(injected)); // pre-injection body hash
    expect(verify(fp, origHash, meta).bodyPreserved).toBe(true);
  });

  it("bodyPreserved=false when the body was altered (hash mismatch)", () => {
    const origHash = contentHash("Hello body\n"); // hash of the ORIGINAL body
    const fp = tmpFile("---\nid: x\n---\nHello CORRUPTED body\n"); // body changed on disk
    const result = verify(fp, origHash, meta);
    expect(result.bodyPreserved).toBe(false);
    expect(result.issues.some((i) => /body content changed/i.test(i))).toBe(true);
  });

  // Regression: recovery must round-trip the exact bytes the patcher writes, so the
  // fixture is derived from the patcher instead of being hand-written. A hand-written
  // separator assumption is what previously drifted from the implementation.
  it("bodyPreserved=true for a fresh file the patcher gave frontmatter to", () => {
    const body = "# Project Overview\n\nSome prose.\n";
    const inspected = inspectFrontMatterDocument(body);
    const origHash = contentHash(inspected.body); // fresh file: body == whole file
    const patched = patchManagedFrontMatter(body, { id: "x" });
    expect(patched.safe).toBe(true);
    expect(verify(tmpFile(patched.content), origHash, meta).bodyPreserved).toBe(true);
  });

  // Regression: a file that ALREADY carried frontmatter, with a blank line before the
  // body. The lossy recovery collapsed that blank line and reported a corrupted body for
  // a file whose bytes after the fence were never touched — which aborted governed apply
  // on any repository whose markdown was already annotated.
  it("bodyPreserved=true when the file already had frontmatter and a blank separator", () => {
    const original = "---\ntitle: Runbook\nowner: platform\n---\n\n# Runbook\n\nBody.\n";
    const origHash = contentHash(inspectFrontMatterDocument(original).body);
    const patched = patchManagedFrontMatter(original, { id: "x" });
    expect(patched.safe).toBe(true);
    expect(patched.content).toContain("\n---\n\n# Runbook");
    expect(verify(tmpFile(patched.content), origHash, meta).bodyPreserved).toBe(true);
  });

  it("stripExistingFrontMatter still collapses the separator it was written for", () => {
    const body = "# Project Overview\n\nSome prose.\n";
    expect(stripExistingFrontMatter("---\nid: x\n---\n\n" + body)).toBe(body);
  });
});
