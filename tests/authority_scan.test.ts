import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, test } from "vitest";
import { META_AUTHORITY_RELATIVE_PATH, loadRepositoryAuthority, parseAuthorityYaml } from "../src/authority";
import {
  assertRepositoryAuthorityForOperation,
  inspectRepositoryAuthority,
  scanRepositoryAuthority,
} from "../src/authority_scan";

function tempRepo(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "l9-authority-"));
}

function write(root: string, relative: string, content: string): void {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
}

const AUTHORITY = `schema: l9.meta-authority/v1
writer:
  repository: Quantum-L9/l9-meta-injector
  ref: v4.0.0
default_carrier: central_manifest
legacy_writers: forbidden
inline_allow:
  - prompts/**/*.md
  - kernels/**/*.md
validation_commands:
  - npm test
`;

describe("repository authority loading", () => {
  test("parses and validates the narrow v1 authority grammar", () => {
    const parsed = parseAuthorityYaml(AUTHORITY);
    expect(parsed.writer.repository).toBe("Quantum-L9/l9-meta-injector");
    expect(parsed.inline_allow).toEqual(["prompts/**/*.md", "kernels/**/*.md"]);
  });

  test("fails closed on unknown keys, duplicate keys, and unsupported schemas", () => {
    expect(() => parseAuthorityYaml(`${AUTHORITY}extra: nope\n`)).toThrow("unsupported top-level key");
    expect(() => parseAuthorityYaml(AUTHORITY.replace("schema:", "schema: l9.meta-authority/v1\nschema:"))).toThrow("duplicate key");
    expect(() => parseAuthorityYaml(AUTHORITY.replace("l9.meta-authority/v1", "l9.meta-authority/v2"))).toThrow("unsupported authority schema");
  });

  test("accepts a UTF-8 BOM without weakening schema validation", () => {
    const parsed = parseAuthorityYaml(`\uFEFF${AUTHORITY}`);
    expect(parsed.schema).toBe("l9.meta-authority/v1");
  });

  test("parses quoted commas in inline lists without splitting the scalar", () => {
    const parsed = parseAuthorityYaml(AUTHORITY.replace(
      "inline_allow:\n  - prompts/**/*.md\n  - kernels/**/*.md",
      'inline_allow: ["prompts/{a,b}/**/*.md", "kernels/**/*.md"]',
    ));
    expect(parsed.inline_allow).toEqual(["prompts/{a,b}/**/*.md", "kernels/**/*.md"]);
  });

  test("reports missing and mismatched authority without inferring policy", () => {
    const root = tempRepo();
    expect(loadRepositoryAuthority(root).conflicts[0].code).toBe("META_AUTHORITY_FILE_MISSING");
    write(root, META_AUTHORITY_RELATIVE_PATH, AUTHORITY);
    expect(loadRepositoryAuthority(root, { expectedWriter: { repository: "Other/writer" } }).conflicts[0].code)
      .toBe("META_AUTHORITY_WRITER_MISMATCH");
  });
});

describe("hidden control-surface authority scan", () => {
  test("detects the active l9-deploy writer and verifier pattern", () => {
    const root = tempRepo();
    write(root, META_AUTHORITY_RELATIVE_PATH, AUTHORITY);
    write(root, "scripts/inject-l9-meta.py", `L9_META = True\nPath("x").write_text("x-l9-meta")\n`);
    write(root, "scripts/verify-l9-meta.py", `subprocess.run([sys.executable, "scripts/inject-l9-meta.py", "--check"])\n`);
    write(root, ".github/workflows/meta.yml", `steps:\n  - run: python scripts/verify-l9-meta.py\n`);

    const inspection = inspectRepositoryAuthority(root, {
      expectedWriter: { repository: "Quantum-L9/l9-meta-injector", ref: "v4.0.0" },
    });
    expect(inspection.scannedPaths).toContain(".github/workflows/meta.yml");
    expect(inspection.evidence.some((item) => item.kind === "writer_script")).toBe(true);
    expect(inspection.evidence.some((item) => item.kind === "writer_invocation")).toBe(true);
    expect(inspection.conflicts.some((item) => item.code === "META_AUTHORITY_CONFLICT")).toBe(true);
    expect(inspection.authorityResolved).toBe(false);
    expect(() => assertRepositoryAuthorityForOperation("check", inspection)).toThrow("blocked");
    expect(assertRepositoryAuthorityForOperation("inventory", inspection)).toBe(inspection.authority);
  });

  test("accepts a pinned canonical Action invocation without treating it as a competitor", () => {
    const root = tempRepo();
    write(root, META_AUTHORITY_RELATIVE_PATH, AUTHORITY);
    write(root, ".github/workflows/meta.yml", `steps:\n  - uses: Quantum-L9/l9-meta-injector@0123456789abcdef0123456789abcdef01234567\n    with:\n      mode: check\n`);
    const inspection = inspectRepositoryAuthority(root);
    expect(inspection.evidence.some((item) => item.kind === "canonical_invocation")).toBe(true);
    expect(inspection.conflicts).toEqual([]);
    expect(inspection.authorityResolved).toBe(true);
    expect(assertRepositoryAuthorityForOperation("check", inspection)).toBe(inspection.authority);
  });

  test("does not let a canonical invocation hide a competing writer in the same workflow", () => {
    const root = tempRepo();
    write(root, META_AUTHORITY_RELATIVE_PATH, AUTHORITY);
    write(root, ".github/workflows/meta.yml", `steps:
  - uses: Quantum-L9/l9-meta-injector@0123456789abcdef0123456789abcdef01234567
    with:
      mode: check
  - run: python scripts/verify-l9-meta.py
`);
    const inspection = inspectRepositoryAuthority(root);
    expect(inspection.evidence.some((item) => item.kind === "canonical_invocation")).toBe(true);
    expect(inspection.evidence.some((item) => item.kind === "writer_invocation")).toBe(true);
    expect(inspection.conflicts.some((item) => item.code === "META_AUTHORITY_CONFLICT")).toBe(true);
  });

  test("does not turn inert documentation and test examples into active conflicts", () => {
    const root = tempRepo();
    write(root, META_AUTHORITY_RELATIVE_PATH, AUTHORITY);
    write(root, "docs/migration.md", "Example: python scripts/inject-l9-meta.py and x-l9-meta");
    write(root, "tests/legacy_writer.test.ts", "const marker = 'L9_META'; writeFileSync('x', marker)");
    write(root, "README.md", "L9_ARTIFACT_META");
    const scan = scanRepositoryAuthority(root);
    expect(scan.conflicts).toEqual([]);
  });

  test("fails closed when a candidate control surface cannot be fully inspected", () => {
    const root = tempRepo();
    write(root, "package.json", "{\n  \"name\": \"x\"\n}\n");
    const scan = scanRepositoryAuthority(root, { maxFileBytes: 1 });
    expect(scan.scanGaps.some((item) => item.code === "META_AUTHORITY_SCAN_INCOMPLETE")).toBe(true);
    expect(scan.conflicts.some((item) => item.code === "META_AUTHORITY_SCAN_INCOMPLETE")).toBe(true);
  });

  test("includes pre-commit and hidden hook invocations", () => {
    const root = tempRepo();
    write(root, ".pre-commit-config.yaml", `- repo: local\n  hooks:\n    - entry: python scripts/verify-l9-meta.py\n`);
    write(root, ".githooks/pre-commit", "python scripts/inject-l9-meta.py --check\n");
    const scan = scanRepositoryAuthority(root);
    expect(scan.scannedPaths).toContain(".pre-commit-config.yaml");
    expect(scan.scannedPaths).toContain(".githooks/pre-commit");
    expect(scan.conflicts.length).toBeGreaterThanOrEqual(2);
  });
});
