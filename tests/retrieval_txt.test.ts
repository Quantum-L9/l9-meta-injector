import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { findFiles, scanFiles } from "../src/retrieval";

describe("findFiles — .txt support", () => {
  it("finds .md files with .md glob", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "l9-ret-"));
    fs.writeFileSync(path.join(tmp, "foo.md"), "# Foo");
    fs.writeFileSync(path.join(tmp, "bar.txt"), "Plain text");
    const found = findFiles(tmp, "**/*.md");
    expect(found.some(f => f.endsWith(".md"))).toBe(true);
    expect(found.some(f => f.endsWith(".txt"))).toBe(false);
    fs.rmSync(tmp, { recursive: true });
  });

  it("finds .txt files with .txt glob", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "l9-ret-"));
    fs.writeFileSync(path.join(tmp, "foo.md"), "# Foo");
    fs.writeFileSync(path.join(tmp, "bar.txt"), "Plain text");
    const found = findFiles(tmp, "**/*.txt");
    expect(found.some(f => f.endsWith(".txt"))).toBe(true);
    expect(found.some(f => f.endsWith(".md"))).toBe(false);
    fs.rmSync(tmp, { recursive: true });
  });

  it("finds both .md and .txt with wildcard glob", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "l9-ret-"));
    fs.writeFileSync(path.join(tmp, "foo.md"), "# Foo");
    fs.writeFileSync(path.join(tmp, "bar.txt"), "Plain text");
    const found = findFiles(tmp, "**/*");
    expect(found.some(f => f.endsWith(".md"))).toBe(true);
    expect(found.some(f => f.endsWith(".txt"))).toBe(true);
    fs.rmSync(tmp, { recursive: true });
  });
});

describe("scanFiles — .txt headerConvention is always none", () => {
  it(".txt files get headerConvention=none regardless of content", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "l9-scan-"));
    const fp = path.join(tmp, "plain.txt");
    fs.writeFileSync(fp, "---\nid: foo\n---\nsome content here");
    const scanned = scanFiles([fp]);
    expect(scanned[0].headerConvention).toBe("none");
    expect(scanned[0].hasExistingFrontMatter).toBe(false);
    fs.rmSync(tmp, { recursive: true });
  });
});
