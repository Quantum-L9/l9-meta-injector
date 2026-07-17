import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { injectFile } from "../src/inject";
import { verify } from "../src/verify";
import { stripExistingFrontMatter } from "../src/extract";
import { buildMeta } from "../src/normalize_meta";
import { extract, splitContent } from "../src/extract";
import { classify } from "../src/classify";
import { NamespaceConfig } from "../src/namespace";

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), "l9-bodyp-")); }

const NS: NamespaceConfig = {
  namespace: "l9", authority: "l9.doctrine.platform", nearDupThreshold: 0.9,
  hashPrefixLength: 16, outputDir: ".out", indexDir: ".", promptGlob: "Prompt-*.md",
};

const BODY = `## Role
Senior auditor agent.

## Validation Gates
- All findings have line numbers
`;

function metaFor(fp: string, body: string) {
  return buildMeta(fp, body, extract(body), classify(fp, body, "none"), NS, "l9.doctrine.platform", "2026-01-01T00:00:00.000Z");
}

test("first injection of a frontmatter file preserves the body (regression: bodyPreserved=false)", () => {
  const root = tmp();
  const fp = path.join(root, "skills-lint.md");
  fs.writeFileSync(fp, BODY);

  const rec = injectFile(fp, metaFor(fp, splitContent(BODY).body), { dryRun: false, outDir: tmp(), verbose: false, writeInjectLog: false });
  expect(rec.bodyPreserved).toBe(true);

  const v = verify(rec.sourcePath, rec.originalBodyHash, rec.meta);
  expect(v.bodyPreserved).toBe(true);
  expect(v.issues).not.toContain("Body content changed during injection (hash mismatch)");

  // The injected file must still start with frontmatter and contain the exact body.
  const content = fs.readFileSync(fp, "utf8");
  expect(content.startsWith("---")).toBe(true);
  expect(content).toContain("## Role");
});

test("stripExistingFrontMatter consumes the full blank separator buildInjection writes", () => {
  // frontmatter + the "\n\n" separator + body  →  body (no leading newline)
  const injected = "---\nid: x\n---\n\n## Body\ntext\n";
  expect(stripExistingFrontMatter(injected)).toBe("## Body\ntext\n");
});
