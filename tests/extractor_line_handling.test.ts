// Regression cases for WU-020: linear-time extractor patterns on hostile lines
// (RC-094) and BOM / lone-CR aware line splitting (RC-096).
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { defaultExtractors } from "../src/extractors";
import { toLines } from "../src/extractors/common";
import { readDocumentBlockSignals } from "../src/extractors/document_blocks";
import { declaredAuthorityExtractor, repositoryStatusExtractor } from "../src/extractors/prose";
import {
  contractInvariantsExtractor,
  manifestExtractor,
  serviceSpecExtractor,
} from "../src/extractors/structured";
import { documentStructureExtractor, workIntelligenceExtractor } from "../src/extractors/work_intelligence";
import { inventoryTree } from "../src/inventory";
import { interpretRepository, type AssertionDraft, type Extractor } from "../src/interpretation";
import { sha256TextPrefixed } from "../src/repository_model";

const BUDGET_MS = 2000;
const HOSTILE_LENGTH = 120000;

function run(extractor: Extractor, sourcePath: string, content: string): AssertionDraft[] {
  return extractor.extract({
    subjectId: "artifact:test",
    sourcePath,
    content,
    contentHash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    pathExists: () => false,
  });
}

function within(budget: number, body: () => void): void {
  const started = Date.now();
  body();
  expect(Date.now() - started).toBeLessThan(budget);
}

/** `predicate object @line` triples. */
function claims(drafts: AssertionDraft[], predicate?: string): string[] {
  return drafts
    .filter((draft) => predicate === undefined || draft.predicate === predicate)
    .map((draft) => `${draft.predicate} ${draft.object} @${draft.sourceRange.start_line}`);
}

const SPACES = " ".repeat(HOSTILE_LENGTH);

describe("RC-094: extractor patterns stay linear on hostile lines", () => {
  it("REG-WU-020-RC-094-a: a long milestone bullet carrying a line separator", () => {
    for (const stray of [" ", "\r"]) {
      const content = `## Milestones\n- first\n-${SPACES}a${stray}b\n`;
      within(BUDGET_MS, () => {
        const drafts = run(workIntelligenceExtractor, "plan.md", content);
        expect(claims(drafts, "work.milestone")[0]).toBe("work.milestone first @2");
      });
    }
  });

  it("REG-WU-020-RC-094-b: a long service-spec value carrying a line separator", () => {
    within(BUDGET_MS, () => {
      run(serviceSpecExtractor, "spec.yaml", `service:\n  name:${SPACES}a b\n`);
    });
  });

  it("REG-WU-020-RC-094-c: long TOML pair values carrying a line separator", () => {
    within(BUDGET_MS, () => {
      run(manifestExtractor, "pyproject.toml", `[project]\nname =${SPACES}a b\n`);
    });
    within(BUDGET_MS, () => {
      run(manifestExtractor, "Cargo.toml", `[package]\nname =${SPACES}a b\n`);
    });
  });

  it("REG-WU-020-RC-094-d: long README replacement pointers carrying a line separator", () => {
    within(BUDGET_MS, () => {
      run(repositoryStatusExtractor, "README.md", `> replaced by${SPACES}a b\n`);
    });
    within(BUDGET_MS, () => {
      run(repositoryStatusExtractor, "README.md", `> replacement:${SPACES}a b\n`);
    });
  });

  it("REG-WU-020-RC-094-e: many trigger words on one contract line", () => {
    const tenant = "tenant context ".repeat(32000);
    const derivation = `derivation ${"never ".repeat(80000)}`;
    for (const line of [tenant, derivation]) {
      within(BUDGET_MS, () => {
        expect(run(contractInvariantsExtractor, "contracts/a.md", `${line}\n`)).toEqual([]);
      });
    }
  });

  it("REG-WU-020-RC-094-f: invariant phrasing is read as before, and not across a sentence boundary", () => {
    const content = [
      "The tenant context is immutable once set.",
      "Packets are derived rather than mutated.",
      "Replay is always explicit.",
      "Lineage is reconstructable from receipts.",
      "",
    ].join("\n");
    expect(claims(run(contractInvariantsExtractor, "contracts/a.md", content), "contract.invariant")).toEqual([
      "contract.invariant tenant-context-immutable @1",
      "contract.invariant packets-derived-not-mutated @2",
      "contract.invariant replay-is-explicit @3",
      "contract.invariant lineage-is-reconstructable @4",
    ]);
    const split = [
      "The tenant context is set once. It is immutable",
      "Packets are derived. Rather than that, they are mutated",
      "Replay happens. It is explicit",
      "Lineage matters. We reconstruct it",
      "",
    ].join("\n");
    expect(run(contractInvariantsExtractor, "contracts/a.md", split)).toEqual([]);
  });

  it("evaluates invariants exactly as the original co-occurrence patterns did", () => {
    // The rule shapes the term-sequence evaluation replaced, kept here as the
    // differential oracle (RC-094 mitigation).
    const ORIGINAL: { object: string; patterns: RegExp[] }[] = [
      {
        object: "gate-compatible-ingress",
        patterns: [
          /\bgate[- ]compatible\b/i,
          /\bthrough\s+(?:the\s+)?gate\b/i,
          /\bgate\s+ingress\b/i,
          /\benters?\s+through\s+gate\b/i,
        ],
      },
      {
        object: "tenant-context-immutable",
        patterns: [/\btenant[_ ]context\b[^.\n]*\bimmutable\b/i, /\bimmutable\b[^.\n]*\btenant\b/i],
      },
      {
        object: "packets-derived-not-mutated",
        patterns: [
          /\bderivation\b[^.\n]*\b(?:not|never)\b[^.\n]*\bmutat/i,
          /\bderived?\b[^.\n]*\brather\s+than\b[^.\n]*\bmutat/i,
          /\bderived?,?\s+(?:not|never)\s+mutat/i,
          /\bnever\s+mutat/i,
        ],
      },
      {
        object: "replay-is-explicit",
        patterns: [/\breplay\b[^.\n]*\bexplicit\b/i, /\bexplicit\b[^.\n]*\breplay\b/i],
      },
      {
        object: "lineage-is-reconstructable",
        patterns: [
          /\blineage\b[^.\n]*\breconstruct/i,
          /\breconstruct\w*\b[^.\n]*\blineage\b/i,
          /\blineage\b[^.\n]*\btraceable\b/i,
        ],
      },
    ];
    const words = [
      "tenant", "context", "tenant_context", "immutable", "derivation", "derive", "derived", "not", "never",
      "mutated", "mutation", "rather", "than", "replay", "explicit", "lineage", "reconstruct",
      "reconstructable", "traceable", "gate", "gate-compatible", "through", "the", "ingress", "enters",
      "x", ".", ",", "immutableness", "nevermore", "derivations",
    ];
    // Deterministic pseudo-random sentences over the trigger vocabulary.
    let seed = 7;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed;
    };
    const lines: string[] = [];
    for (let count = 0; count < 4000; count++) {
      const length = 2 + (next() % 9);
      const parts: string[] = [];
      for (let word = 0; word < length; word++) parts.push(words[next() % words.length]);
      lines.push(parts.join(next() % 5 === 0 ? "" : " "));
    }
    for (const line of lines) {
      const expected = ORIGINAL.filter((rule) => rule.patterns.some((pattern) => pattern.test(line)))
        .map((rule) => rule.object)
        .sort();
      const actual = run(contractInvariantsExtractor, "contracts/a.md", `${line}\n`)
        .filter((draft) => draft.predicate === "contract.invariant")
        .map((draft) => draft.object)
        .sort();
      expect(actual, line).toEqual(expected);
    }
  });

  it("REG-WU-020-RC-094-g: ordinary bullets, spec keys, TOML pairs and replacement lines read as before", () => {
    expect(
      claims(run(workIntelligenceExtractor, "plan.md", "## Milestones\n- Beta\n1. [x] GA launch\n- \n"), "work.milestone"),
    ).toEqual(["work.milestone Beta @2", "work.milestone GA launch @3"]);
    expect(
      claims(
        run(
          serviceSpecExtractor,
          "spec.yaml",
          "service:\n  name: \"svc\"  # comment\n  version: 1.2.3\nactions:\n  - name: match\n  - name:   sync  \n",
        ),
      ),
    ).toEqual([
      "service.name svc @2",
      "service.version 1.2.3 @3",
      "service.action match @5",
      "service.action sync @6",
    ]);
    expect(claims(run(manifestExtractor, "Cargo.toml", '[package]\nname   =   "c"\n[dependencies]\naxum="0.7"\n'))).toEqual([
      "package.name c @2",
      "package.packaging_system cargo @2",
      "package.dependency axum @4",
      "package.framework axum @4",
    ]);
    expect(
      claims(
        run(
          repositoryStatusExtractor,
          "README.md",
          [
            "> **Deprecated** — replaced by [new-repo](https://example.invalid/new)",
            "> SSOT replacement: `Quantum-L9/next`",
            "> replaced by   ",
            "> Archived: use Quantum-L9/other instead",
            "",
          ].join("\n"),
        ),
        "repository.replaced_by",
      ),
    ).toEqual([
      "repository.replaced_by new-repo @1",
      "repository.replaced_by Quantum-L9/next @2",
      "repository.replaced_by Quantum-L9/other @4",
    ]);
  });
});

describe("RC-096: BOM and lone CR at the interpretation boundary", () => {
  it("REG-WU-020-RC-096-a: a BOM does not hide a line-1 heading", () => {
    const content = "﻿# Deployment Roadmap\n\nbody\n";
    const structure = run(documentStructureExtractor, "b.md", content);
    expect(claims(structure, "document.title")).toEqual(["document.title Deployment Roadmap @1"]);
    expect(claims(structure, "document.heading")).toEqual(["document.heading H1: Deployment Roadmap @1"]);
    const work = run(workIntelligenceExtractor, "b.md", content);
    expect(claims(work, "work.kind")).toEqual(["work.kind roadmap @1"]);
    for (const draft of [...structure, ...work]) expect(draft.evidenceExcerpt).not.toContain("﻿");
  });

  it("REG-WU-020-RC-096-b: BOM frontmatter still reads", () => {
    expect(claims(run(workIntelligenceExtractor, "a.md", "﻿---\nstatus: wip\n---\n"), "work.status")).toEqual([
      "work.status wip @2",
    ]);
  });

  it("REG-WU-020-RC-096-c: a CR-only document reads like its LF twin", () => {
    const lf = run(workIntelligenceExtractor, "old.txt", "Status: blocked\nDepends on: infra.txt\n- [ ] order servers\n");
    const cr = run(workIntelligenceExtractor, "old.txt", "Status: blocked\rDepends on: infra.txt\r- [ ] order servers\r");
    expect(claims(cr)).toEqual(claims(lf));
    expect(claims(cr).map((claim) => claim.split(" @")[1])).toEqual(["1", "2", "3"]);
  });

  it("REG-WU-020-RC-096-d: mixed line endings cite the editor-visible line", () => {
    expect(claims(run(workIntelligenceExtractor, "m.md", "# Title\r\rintro\nStatus: blocked\n"), "work.status")).toEqual([
      "work.status blocked @4",
    ]);
  });

  it("REG-WU-020-RC-096-e: toLines treats CRLF, LF and lone CR as one terminator and drops a BOM", () => {
    expect(toLines("a\r\nb")).toEqual(["a", "b"]);
    expect(toLines("a\n")).toEqual(["a"]);
    expect(toLines("a\r")).toEqual(["a"]);
    expect(toLines("")).toEqual([]);
    expect(toLines("﻿")).toEqual([]);
    expect(toLines("﻿a\r\r\nb\n\rc")).toEqual(["a", "", "b", "", "c"]);
    // Only one leading BOM is removed; a second is content.
    expect(toLines("﻿﻿a")).toEqual(["﻿a"]);
  });

  it("REG-WU-020-RC-096-f: a lone CR separates milestones inside a block", () => {
    const signals = readDocumentBlockSignals({
      subjectId: "artifact:x",
      sourcePath: "plans/a.docx",
      sourceContentHash: "sha256:aa",
      normalizedDocumentId: "normdoc:bb",
      decoderId: "l9.docx-decoder",
      decoderVersion: "1.0.0",
      format: "docx",
      blocks: [
        { block_id: "b1", kind: "heading", text: "Milestones", locator: { kind: "docx_block", block_index: 1, part: "word/document.xml" } },
        { block_id: "b2", kind: "list_item", text: "Ship v1\rShip v2", locator: { kind: "docx_block", block_index: 2, part: "word/document.xml" } },
      ],
    });
    expect(
      signals.filter((signal) => signal.predicate === "work.milestone").map((signal) => signal.object).sort(),
    ).toEqual(["Ship v1", "Ship v2"]);
  });

  describe("through interpretRepository", () => {
    const scratch: string[] = [];
    afterAll(() => {
      for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
    });

    it("REG-WU-020-RC-096-g: hashes the decoded text with its BOM and reads the README title", () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "l9-bom-"));
      scratch.push(root);
      const readme = "﻿# Fixture Readme\n\nbody\n";
      const manifest = '﻿{\n  "name": "bom-pkg"\n}\n';
      fs.writeFileSync(path.join(root, "README.md"), readme, "utf8");
      fs.writeFileSync(path.join(root, "package.json"), manifest, "utf8");
      const inventory = inventoryTree({
        root,
        outDir: path.join(os.tmpdir(), `l9-bom-out-${path.basename(root)}`),
        dryRun: true,
        injectHeaders: false,
        folderSidecars: false,
        writeSidecars: false,
      });
      const result = interpretRepository({ root, subjectId: "repo:fixture", inventory, extractors: defaultExtractors() });
      const title = result.assertions.find((a) => a.source_path === "README.md" && a.predicate === "document.title");
      expect(title?.object).toBe("Fixture Readme");
      expect(title?.source_range.start_line).toBe(1);
      expect(title?.source_content_hash).toBe(sha256TextPrefixed(readme));
      const name = result.assertions.find((a) => a.source_path === "package.json" && a.predicate === "package.name");
      expect(name?.object).toBe("bom-pkg");
      expect(name?.source_content_hash).toBe(sha256TextPrefixed(manifest));
    });
  });

  it("REG-WU-020-RC-096-h: LF and CRLF documents produce identical drafts", () => {
    const documents: [Extractor, string, string][] = [
      [workIntelligenceExtractor, "plan.md", "# Roadmap\n\nStatus: wip\n\n## Milestones\n- Beta\n- GA\n\n- [ ] task\nTODO: more\n"],
      [documentStructureExtractor, "doc.md", "---\ntitle: x\n---\n# Title\n## Section\n"],
      [serviceSpecExtractor, "spec.yaml", "service:\n  name: svc\nactions:\n  - name: match\n"],
      [manifestExtractor, "pyproject.toml", '[project]\nname = "a"\ndependencies = [\n  "fastapi",\n]\n'],
      [contractInvariantsExtractor, "contracts/a.md", "Replay is explicit.\nLineage is traceable.\n"],
      [repositoryStatusExtractor, "README.md", "# R\n\n> **Deprecated**: replaced by x/y\n"],
      [declaredAuthorityExtractor, "README.md", "# R\n\nThis repository is the source of truth for x.\n"],
    ];
    for (const [extractor, sourcePath, lf] of documents) {
      const crlf = lf.replace(/\n/g, "\r\n");
      expect(run(extractor, sourcePath, crlf), `${extractor.id} ${sourcePath}`).toEqual(run(extractor, sourcePath, lf));
    }
  });
});
