// QTE-004 — inject.ts mutates files but had no dedicated unit test (only transitive
// coverage via the pipeline integration test). Covers each strategy, dry-run (no
// mutation + diff written), re-run idempotency, body preservation, and the sidecar
// branch for comment-less formats.
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { injectFile } from "../src/inject";
import { buildMeta } from "../src/normalize_meta";
import { extract, splitContent, contentHash } from "../src/extract";
import { classify } from "../src/classify";
import { sidecarPathFor } from "../src/comment";
import { NamespaceConfig } from "../src/namespace";

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), "l9-inject-")); }

const NS: NamespaceConfig = {
  namespace: "l9", authority: "l9.auto", nearDupThreshold: 0.9,
  hashPrefixLength: 16, outputDir: ".out", indexDir: ".",
};
const OPTS = (outDir: string, dryRun = false) => ({ dryRun, outDir, verbose: false, writeInjectLog: true });

function metaFor(fp: string, body: string) {
  return buildMeta(fp, body, extract(body), classify(fp, body, "none"), NS, "l9.auto", "2026-01-01T00:00:00.000Z");
}
function inject(fp: string, outDir: string, dryRun = false) {
  const raw = fs.readFileSync(fp, "utf8");
  const body = fp.endsWith(".md") ? splitContent(raw).body : raw;
  return injectFile(fp, metaFor(fp, body), OPTS(outDir, dryRun));
}

describe("QTE-004 — inject strategies", () => {
  test("yaml-frontmatter: markdown gets a --- header, body preserved", () => {
    const root = tmp();
    const fp = path.join(root, "skills-x.md");
    fs.writeFileSync(fp, "## Role\nAn agent.\n");
    const rec = inject(fp, tmp());
    expect(rec.injectionStrategy).toBe("yaml-frontmatter");
    expect(rec.bodyPreserved).toBe(true);
    const out = fs.readFileSync(fp, "utf8");
    expect(out.startsWith("---")).toBe(true);
    expect(out).toContain("## Role");
  });

  test("line-comment: a .ts file gets a comment-wrapped block after any shebang, body preserved", () => {
    const root = tmp();
    const fp = path.join(root, "tool.ts");
    fs.writeFileSync(fp, "export const x = 1;\n");
    const rec = inject(fp, tmp());
    expect(rec.injectionStrategy).toBe("line-comment");
    expect(rec.bodyPreserved).toBe(true);
    expect(fs.readFileSync(fp, "utf8")).toContain("export const x = 1;");
  });

  test("sidecar: a .json file is left byte-for-byte and a .l9meta.yaml is written", () => {
    const root = tmp();
    const fp = path.join(root, "data.json");
    const original = '{"a":1}\n';
    fs.writeFileSync(fp, original);
    const rec = inject(fp, tmp());
    expect(rec.injectionStrategy).toBe("sidecar");
    expect(rec.sidecarPath).toBe(sidecarPathFor(fp));
    // Source file untouched.
    expect(fs.readFileSync(fp, "utf8")).toBe(original);
    // Sidecar exists and carries the header.
    expect(fs.existsSync(rec.sidecarPath!)).toBe(true);
    expect(fs.readFileSync(rec.sidecarPath!, "utf8")).toContain("id:");
  });
});

describe("QTE-004 — dry-run writes a diff and mutates nothing", () => {
  test("dryRun leaves the source unchanged and emits a .diff", () => {
    const root = tmp();
    const out = tmp();
    const fp = path.join(root, "skills-y.md");
    const original = "## Body\ntext\n";
    fs.writeFileSync(fp, original);

    const rec = inject(fp, out, /*dryRun*/ true);
    expect(rec.headerInjected).toBe(false);
    // Source file not mutated.
    expect(fs.readFileSync(fp, "utf8")).toBe(original);
    // Diff artifact written under outDir.
    expect(rec.dryRunDiffPath).toBeDefined();
    expect(fs.existsSync(rec.dryRunDiffPath!)).toBe(true);
    expect(fs.readFileSync(rec.dryRunDiffPath!, "utf8")).toMatch(/^\+/m);
  });

  test("nested files land in mirrored diff paths and a parent escape is refused", () => {
    const root = tmp();
    const out = tmp();
    fs.mkdirSync(path.join(root, "src", "a"), { recursive: true });
    fs.mkdirSync(path.join(root, "src", "b"), { recursive: true });
    const a = path.join(root, "src", "a", "index.ts");
    const b = path.join(root, "src", "b", "index.ts");
    fs.writeFileSync(a, "export const a = 1;\n");
    fs.writeFileSync(b, "export const b = 2;\n");
    const meta = (fp: string) => buildMeta(fp, fs.readFileSync(fp, "utf8"), extract(fs.readFileSync(fp, "utf8")), classify(fp, fs.readFileSync(fp, "utf8"), "none"), NS, "l9.auto", "2026-01-01T00:00:00.000Z", root);
    const recA = injectFile(a, meta(a), OPTS(out, true));
    const recB = injectFile(b, meta(b), OPTS(out, true));
    expect(recA.dryRunDiffPath).toBe(path.join(out, "src", "a", "index.ts.diff"));
    expect(recB.dryRunDiffPath).toBe(path.join(out, "src", "b", "index.ts.diff"));
    expect(fs.existsSync(recA.dryRunDiffPath!)).toBe(true);
    expect(fs.existsSync(recB.dryRunDiffPath!)).toBe(true);
    const escaped = { ...meta(a), source_path: "../secret" };
    expect(() => injectFile(a, escaped, OPTS(out, true))).toThrow(/escapes output directory/);
  });
});

describe("QTE-004 — re-run idempotency and body preservation", () => {
  test("injecting twice leaves the file byte-identical after the first run", () => {
    const root = tmp();
    const fp = path.join(root, "skills-z.md");
    fs.writeFileSync(fp, "## Role\nStable agent body.\n");

    inject(fp, tmp());
    const afterFirst = fs.readFileSync(fp, "utf8");
    const rec2 = inject(fp, tmp());
    const afterSecond = fs.readFileSync(fp, "utf8");

    expect(afterSecond).toBe(afterFirst);
    expect(rec2.bodyPreserved).toBe(true);
    // Re-run is a no-op → post-body hash equals the original body hash.
    expect(rec2.postInjectionBodyHash).toBe(rec2.originalBodyHash);
  });

  test("postInjectionBodyHash matches a fresh hash of the stripped body (line-comment)", () => {
    const root = tmp();
    const fp = path.join(root, "mod.ts");
    fs.writeFileSync(fp, "export function f() { return 42; }\n");
    const rec = inject(fp, tmp());
    expect(rec.bodyPreserved).toBe(true);
    expect(rec.postInjectionBodyHash).toBe(contentHash("export function f() { return 42; }\n"));
  });
});
