import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { verify } from "../src/verify";
import { contentHash, stripExistingFrontMatter } from "../src/extract";
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
});
