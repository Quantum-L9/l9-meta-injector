/**
 * WU-025 (RC-028, RC-029): every competing-writer invocation is judged on its own
 * line, and write-signal detection costs O(file bytes) for any surface within
 * maxFileBytes, without moving existing evidence.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { scanRepositoryAuthority } from "../src/authority_scan";
import type { AuthorityLegacyPolicy } from "../src/operation_contracts";

const roots: string[] = [];
function tempRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "l9-authority-cost-"));
  roots.push(root);
  return root;
}
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

function write(root: string, relative: string, content: string): void {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
}

const MASKED_WORKFLOW = `name: meta
on: push
steps:
  - run: npx l9-meta-injector check # supersedes scripts/verify_l9_meta.py
  - run: python scripts/inject_l9_meta.py
`;

describe("RC-028: every invocation is evaluated", () => {
  test.each<AuthorityLegacyPolicy>(["forbidden", "migration_only"])(
    "REG-WU-025-RC-028-a: a canonical line naming a legacy script does not mask a later live invocation (%s)",
    (policy) => {
      const root = tempRepo();
      write(root, ".github/workflows/meta.yml", MASKED_WORKFLOW);
      const scan = scanRepositoryAuthority(root, { legacyPolicy: policy });
      const conflict = scan.conflicts.find((item) => item.message === "active control surface invokes a competing metadata writer");
      expect(conflict?.code).toBe("META_AUTHORITY_CONFLICT");
      expect(conflict?.path).toBe(".github/workflows/meta.yml");
      const invocation = scan.evidence.find((item) => item.kind === "writer_invocation");
      expect(invocation?.line).toBe(5);
      expect(invocation?.excerpt).toBe("- run: python scripts/inject_l9_meta.py");
    },
  );

  test("REG-WU-025-RC-028-b: a surface whose only invocation token is on a canonical line does not conflict", () => {
    const root = tempRepo();
    write(root, ".github/workflows/meta.yml", "steps:\n  - run: npx l9-meta-injector check # supersedes scripts/verify_l9_meta.py\n");
    const scan = scanRepositoryAuthority(root, { legacyPolicy: "forbidden" });
    expect(scan.conflicts).toEqual([]);
    expect(scan.evidence.map((item) => item.kind)).toEqual(["canonical_invocation"]);
  });

  test("REG-WU-025-RC-028-c: two competing invocations in one workflow yield one conflict at the first", () => {
    const root = tempRepo();
    write(root, ".github/workflows/meta.yml", "steps:\n  - run: python scripts/verify-l9-meta.py\n  - run: python scripts/inject-l9-meta.py\n");
    const scan = scanRepositoryAuthority(root, { legacyPolicy: "forbidden" });
    const invocations = scan.evidence.filter((item) => item.kind === "writer_invocation");
    expect(invocations).toHaveLength(1);
    expect(invocations[0].line).toBe(2);
    expect(scan.conflicts.filter((item) => item.message === "active control surface invokes a competing metadata writer")).toHaveLength(1);
  });

  // REG-WU-025-RC-028-d is the existing tests/authority_scan.test.ts case
  // "does not let a canonical invocation hide a competing writer in the same workflow",
  // which this unit leaves unchanged and must keep passing.
});

describe("RC-029: write-signal detection is linear in file size", () => {
  const MIB = 1024 * 1024;
  // The pre-correction scanner needs minutes for each of these; the corrected one
  // needs milliseconds. The budget is generous so a loaded CI host cannot flake it.
  const BUDGET_MS = 2_000;

  function timedScan(content: string): { elapsed: number; scan: ReturnType<typeof scanRepositoryAuthority> } {
    const root = tempRepo();
    write(root, "scripts/build.sh", content);
    const started = process.hrtime.bigint();
    const scan = scanRepositoryAuthority(root, { legacyPolicy: "forbidden" });
    return { elapsed: Number(process.hrtime.bigint() - started) / 1e6, scan };
  }

  test("REG-WU-025-RC-029-a: one 1 MiB line of '>' completes within budget without conflict", () => {
    const { elapsed, scan } = timedScan(">".repeat(MIB));
    expect(scan.scannedPaths).toContain("scripts/build.sh");
    expect(scan.conflicts).toEqual([]);
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });

  test("REG-WU-025-RC-029-b: ~1 MiB of 'open(' with no ')' completes within budget", () => {
    const { elapsed, scan } = timedScan("open(".repeat(Math.floor(MIB / 5)));
    expect(scan.scannedPaths).toContain("scripts/build.sh");
    expect(scan.conflicts).toEqual([]);
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });

  test("REG-WU-025-RC-029-c: ~1 MiB single line of 'json.dump ' completes within budget", () => {
    const { elapsed, scan } = timedScan("json.dump ".repeat(Math.floor(MIB / 10)));
    expect(scan.scannedPaths).toContain("scripts/build.sh");
    expect(scan.conflicts).toEqual([]);
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });

  test("REG-WU-025-RC-029-d: a redirect into an L9 metadata file is a writer_script on that line", () => {
    const root = tempRepo();
    write(root, "scripts/x.sh", "#!/bin/sh\necho data > out/L9_META.json\n");
    const scan = scanRepositoryAuthority(root, { legacyPolicy: "forbidden" });
    const writer = scan.evidence.find((item) => item.kind === "writer_script");
    expect(writer?.line).toBe(2);
    expect(writer?.excerpt).toBe("echo data > out/L9_META.json");
    expect(scan.conflicts.some((item) => item.code === "META_AUTHORITY_CONFLICT" && item.path === "scripts/x.sh")).toBe(true);
  });

  test("REG-WU-025-RC-029-f: a multi-line open(..., \"w\") in a file named as an L9 writer is detected at the open( line", () => {
    const root = tempRepo();
    write(root, "scripts/inject_l9_meta.py", "import os\n\nwith open(\n    path,\n    \"w\") as handle:\n    handle.write(header)\n");
    const scan = scanRepositoryAuthority(root, { legacyPolicy: "forbidden" });
    const writer = scan.evidence.find((item) => item.kind === "writer_script");
    expect(writer?.line).toBe(3);
    expect(writer?.excerpt).toBe("with open(");
  });

  test("REG-WU-025-RC-029-e: evidence on the existing fixtures keeps its outcome and line numbers", () => {
    const root = tempRepo();
    write(root, "scripts/inject-l9-meta.py", `L9_META = True\nPath("x").write_text("x-l9-meta")\n`);
    write(root, "scripts/verify-l9-meta.py", `subprocess.run([sys.executable, "scripts/inject-l9-meta.py", "--check"])\n`);
    write(root, ".github/workflows/meta.yml", `steps:\n  - run: python scripts/verify-l9-meta.py\n`);
    write(root, "scripts/build_report.py", "# Report builder.\n# NOTE: this module used to be annotated with L9_META headers before the migration.\nimport json\n\ndef emit(report, handle):\n    json.dump(report, handle)\n");
    write(root, "scripts/sync-metadata.sh", "#!/bin/sh\nnpx l9-meta-injector apply . > build/meta.log\n");
    write(root, "scripts/emit_bundle.js", "// Historical marker retained in a comment: L9_ARTIFACT_META\nconst fs = require(\"node:fs\");\n\nfunction emit(target, data) {\n  fs.writeFileSync(target, JSON.stringify(data));\n}\n");
    write(root, "scripts/inject-meta.py", "from pathlib import Path\n\ndef inject(target, header):\n    Path(target).write_text(header)\n");
    const scan = scanRepositoryAuthority(root, { legacyPolicy: "forbidden" });
    expect(scan.evidence.map((item) => `${item.path}:${item.kind}:${item.rule}@${item.line}`)).toEqual(PINNED_EVIDENCE);
  });
});

// Captured from the pre-correction scanner at bf66978; the rewrite must not move any of it.
const PINNED_EVIDENCE: string[] = [
  ".github/workflows/meta.yml:writer_invocation:legacy-writer-invocation@2",
  "scripts/build_report.py:legacy_marker:legacy-marker-l9-meta@2",
  "scripts/emit_bundle.js:legacy_marker:legacy-marker-l9-artifact-meta@1",
  "scripts/inject-l9-meta.py:legacy_marker:legacy-marker-l9-meta@1",
  "scripts/inject-l9-meta.py:legacy_marker:legacy-marker-x-l9-meta@2",
  "scripts/inject-l9-meta.py:writer_script:l9-metadata-write-signal@2",
  "scripts/sync-metadata.sh:canonical_invocation:canonical-l9-meta-injector-invocation@2",
  "scripts/verify-l9-meta.py:writer_invocation:legacy-writer-invocation@1",
];
