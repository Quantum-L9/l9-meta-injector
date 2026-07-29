// ADR-016 — injection is overwrite-only: an injected file must carry exactly ONE header.
// Legacy consolidation-v1 headers (L9_META / L9_ARTIFACT_META), which the v3 sentinel
// logic does not recognize, must be REPLACED at the head of the file, never appended to
// or preserved beneath a fresh header. These tests pin that contract and its guard rails
// (mid-file mentions preserved, shebang preserved, idempotent re-run).
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { injectFile } from "../src/inject";
import { buildMeta } from "../src/normalize_meta";
import { extract, splitContent, contentHash } from "../src/extract";
import { classify } from "../src/classify";
import { stripLeadingLegacyMetaBlock } from "../src/comment";
import { NamespaceConfig } from "../src/namespace";

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), "l9-overwrite-")); }

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

const LEGACY_PY_HEADER =
  "# --- L9_META ---\n" +
  "# l9_schema: 1\n" +
  "# origin: legacy-sdk\n" +
  "# layer: [ingest]\n" +
  "# owner: platform\n" +
  "# status: active\n" +
  "# --- /L9_META ---\n";

describe("ADR-016 — overwrite existing legacy headers (line-comment)", () => {
  test("a legacy # --- L9_META --- block is replaced, not stacked", () => {
    const root = tmp();
    const fp = path.join(root, "config.py");
    const bodyCode = "import os\n\nX = 1\n";
    fs.writeFileSync(fp, LEGACY_PY_HEADER + bodyCode);

    const rec = inject(fp, tmp());
    const out = fs.readFileSync(fp, "utf8");

    // Exactly one header: the v3 sentinel block, and the legacy sentinels are gone.
    expect(out).toContain(">>> l9:meta >>>");
    expect(out).not.toContain("L9_META");        // no legacy open/close sentinel survives
    expect(out).not.toContain("l9_schema: 1");    // no legacy field survives
    // Genuine code body preserved verbatim.
    expect(out).toContain("import os");
    expect(out).toContain("X = 1");
    expect(rec.bodyPreserved).toBe(true);
    expect(rec.postInjectionBodyHash).toBe(contentHash(bodyCode));
  });

  test("re-running is byte-identical after the first overwrite (idempotent)", () => {
    const root = tmp();
    const fp = path.join(root, "svc.py");
    fs.writeFileSync(fp, LEGACY_PY_HEADER + "import sys\n");

    inject(fp, tmp());
    const afterFirst = fs.readFileSync(fp, "utf8");
    const rec2 = inject(fp, tmp());
    const afterSecond = fs.readFileSync(fp, "utf8");

    expect(afterSecond).toBe(afterFirst);
    expect(afterFirst).not.toContain("L9_META");
    expect((afterSecond.match(/>>> l9:meta >>>/g) || []).length).toBe(1); // never duplicated
    expect(rec2.bodyPreserved).toBe(true);
  });

  test("a shebang is preserved when a legacy block follows it", () => {
    const root = tmp();
    const fp = path.join(root, "run.py");
    fs.writeFileSync(fp, "#!/usr/bin/env python\n" + LEGACY_PY_HEADER + "main()\n");

    inject(fp, tmp());
    const out = fs.readFileSync(fp, "utf8");

    expect(out.startsWith("#!/usr/bin/env python\n")).toBe(true);
    expect(out).not.toContain("L9_META");
    expect(out).toContain(">>> l9:meta >>>");
    expect(out).toContain("main()");
  });
});

describe("ADR-016 — overwrite existing legacy headers (markdown frontmatter)", () => {
  test("a legacy <!-- L9_META ... /L9_META --> block at the top of markdown is replaced", () => {
    const root = tmp();
    const fp = path.join(root, "skills-doc.md");
    const legacy = "<!-- L9_META\nl9_schema: 1\norigin: legacy\n/L9_META -->\n";
    fs.writeFileSync(fp, legacy + "## Role\nAn agent.\n");

    inject(fp, tmp());
    const out = fs.readFileSync(fp, "utf8");

    expect(out.startsWith("---")).toBe(true);      // one v3 frontmatter header
    expect(out).not.toContain("L9_META");           // legacy HTML sentinel gone
    expect(out).toContain("## Role");               // prose preserved
  });
});

describe("ADR-016 — guard rails: only the leading header region is stripped", () => {
  test("a mid-file mention of the token is NOT removed", () => {
    // A legacy block at the head is stripped; a documentation example of the same token
    // further down the body must survive untouched.
    const body =
      "# real code\n" +
      "def f():\n" +
      "    # example header format: # --- L9_META --- ... # --- /L9_META ---\n" +
      "    return 1\n";
    const input = LEGACY_PY_HEADER + body;
    const stripped = stripLeadingLegacyMetaBlock(input);

    expect(stripped).toBe(body);                    // leading block removed, body intact
    expect(stripped).toContain("example header format"); // mid-file mention preserved
  });

  test("no legacy header → body returned unchanged", () => {
    const body = "export const x = 1;\n// mentions L9_META in a comment but no block\n";
    expect(stripLeadingLegacyMetaBlock(body)).toBe(body);
  });

  test("an unterminated opener (no closing sentinel) is left verbatim", () => {
    const body = "# --- L9_META ---\n# l9_schema: 1\nprint('no close')\n";
    expect(stripLeadingLegacyMetaBlock(body)).toBe(body);
  });
});
