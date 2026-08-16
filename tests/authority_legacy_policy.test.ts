/**
 * Legacy-writer authority policy (findings F-3 and F-4).
 *
 * F-3: `legacy_writers` existed only in schema validation and never reached a runtime
 * decision, so declaring `migration_only` changed nothing.
 * F-4: historical `L9_META` text plus any unrelated generic file write anywhere in the
 * same file was classified as an active competing metadata writer, which made a mature
 * repository un-adoptable without deleting its own history.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, test } from "vitest";
import { META_AUTHORITY_RELATIVE_PATH } from "../src/authority";
import { dispositionForEvidence, inspectRepositoryAuthority } from "../src/authority_scan";
import type { AuthorityLegacyPolicy } from "../src/operation_contracts";

function tempRepo(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "l9-legacy-policy-"));
}

function write(root: string, relative: string, content: string): void {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
}

function authorityYaml(policy: AuthorityLegacyPolicy): string {
  return `schema: l9.meta-authority/v1
writer:
  repository: Quantum-L9/l9-meta-injector
  ref: v4.0.0
default_carrier: central_manifest
legacy_writers: ${policy}
inline_allow: []
`;
}

/** A governed repository whose authority declares `policy`. */
function governedRepo(policy: AuthorityLegacyPolicy): string {
  const root = tempRepo();
  write(root, META_AUTHORITY_RELATIVE_PATH, authorityYaml(policy));
  return root;
}

function inspect(root: string) {
  return inspectRepositoryAuthority(root, {
    expectedWriter: { repository: "Quantum-L9/l9-meta-injector" },
  });
}

// A file that carries historical L9 metadata text and also happens to write a file, but
// whose write has nothing to do with L9 metadata.
const HISTORICAL_PLUS_JSON_DUMP = `# Report builder.
# NOTE: this module used to be annotated with L9_META headers before the migration.
import json

def emit(report, handle):
    json.dump(report, handle)
`;

const HISTORICAL_PLUS_WRITE_FILE_SYNC = `// Historical marker retained in a comment: L9_ARTIFACT_META
const fs = require("node:fs");

function emit(target, data) {
  fs.writeFileSync(target, JSON.stringify(data));
}
`;

// A surface whose own filename and body claim to write competing L9 metadata.
const COMPETING_WRITER = `from pathlib import Path

def inject(target, header):
    Path(target).write_text(header)
`;

describe("historical markers are inert evidence", () => {
  test("a historical marker with no writer evidence does not block", () => {
    const root = governedRepo("forbidden");
    write(root, "scripts/legacy_notes.py", "# migrated away from L9_META in 2024\n");
    const inspection = inspect(root);
    expect(inspection.conflicts).toEqual([]);
    expect(inspection.authorityResolved).toBe(true);
  });

  test("a historical marker plus an unrelated json.dump does not block", () => {
    const root = governedRepo("forbidden");
    write(root, "scripts/build_report.py", HISTORICAL_PLUS_JSON_DUMP);
    const inspection = inspect(root);
    expect(inspection.conflicts).toEqual([]);
    expect(inspection.evidence.some((item) => item.kind === "writer_script")).toBe(false);
    expect(inspection.authorityResolved).toBe(true);
  });

  test("a historical marker plus an unrelated writeFileSync does not block", () => {
    const root = governedRepo("forbidden");
    write(root, "scripts/emit_bundle.js", HISTORICAL_PLUS_WRITE_FILE_SYNC);
    const inspection = inspect(root);
    expect(inspection.conflicts).toEqual([]);
    expect(inspection.evidence.some((item) => item.kind === "writer_script")).toBe(false);
    expect(inspection.authorityResolved).toBe(true);
  });

  test("non-blocking marker evidence is still preserved, with path and line", () => {
    const root = governedRepo("forbidden");
    write(root, "scripts/build_report.py", HISTORICAL_PLUS_JSON_DUMP);
    const inspection = inspect(root);
    const marker = inspection.evidence.find((item) => item.kind === "legacy_marker");
    expect(marker).toBeDefined();
    expect(marker?.path).toBe("scripts/build_report.py");
    expect(marker?.line).toBe(2);
    expect(marker?.excerpt).toContain("L9_META");
    const notice = inspection.notices.find((item) => item.code === "META_LEGACY_METADATA_PRESENT");
    expect(notice?.path).toBe("scripts/build_report.py");
    expect(inspection.conflicts).toEqual([]);
  });
});

describe("legacy_writers: forbidden", () => {
  test("an explicit competing metadata writer blocks", () => {
    const root = governedRepo("forbidden");
    write(root, "scripts/inject-l9-meta.py", COMPETING_WRITER);
    const inspection = inspect(root);
    expect(inspection.evidence.some((item) => item.kind === "writer_script")).toBe(true);
    expect(inspection.conflicts.some((item) => item.code === "META_AUTHORITY_CONFLICT")).toBe(true);
    expect(inspection.authorityResolved).toBe(false);
  });

  test("an active competing writer invocation blocks", () => {
    const root = governedRepo("forbidden");
    write(root, ".github/workflows/meta.yml", "steps:\n  - run: python scripts/verify-l9-meta.py\n");
    const inspection = inspect(root);
    const conflict = inspection.conflicts.find((item) => item.code === "META_AUTHORITY_CONFLICT");
    expect(conflict?.message).toMatch(/invokes a competing metadata writer/);
    expect(conflict?.path).toBe(".github/workflows/meta.yml");
  });
});

describe("legacy_writers: migration_only", () => {
  test("a dormant legacy writer artifact is allowed with a migration diagnostic", () => {
    const root = governedRepo("migration_only");
    write(root, "scripts/inject-l9-meta.py", COMPETING_WRITER);
    const inspection = inspect(root);
    expect(inspection.legacyPolicy).toBe("migration_only");
    expect(inspection.conflicts).toEqual([]);
    expect(inspection.authorityResolved).toBe(true);
    const notice = inspection.notices.find((item) => item.code === "META_LEGACY_WRITER_MIGRATION");
    expect(notice?.path).toBe("scripts/inject-l9-meta.py");
    expect(notice?.evidence?.join(" ")).toContain("l9-metadata-write-signal");
    // The evidence itself is unchanged; only its disposition differs from `forbidden`.
    expect(inspection.evidence.some((item) => item.kind === "writer_script")).toBe(true);
  });

  test("an active competing writer invocation still blocks", () => {
    const root = governedRepo("migration_only");
    write(root, "scripts/inject-l9-meta.py", COMPETING_WRITER);
    write(root, ".githooks/pre-commit", "python scripts/inject-l9-meta.py --check\n");
    const inspection = inspect(root);
    expect(inspection.conflicts.some((item) => item.code === "META_AUTHORITY_CONFLICT")).toBe(true);
    expect(inspection.conflicts.some((item) => item.path === ".githooks/pre-commit")).toBe(true);
    expect(inspection.authorityResolved).toBe(false);
  });

  test("the declared policy is what changes the outcome, on identical sources", () => {
    for (const policy of ["forbidden", "migration_only"] as const) {
      const root = governedRepo(policy);
      write(root, "scripts/inject-l9-meta.py", COMPETING_WRITER);
      const inspection = inspect(root);
      expect(inspection.evidence.filter((item) => item.kind === "writer_script")).toHaveLength(1);
      expect(inspection.conflicts.length).toBe(policy === "forbidden" ? 1 : 0);
    }
  });
});

describe("the canonical writer is never a competitor", () => {
  test("a pinned canonical Action invocation never conflicts, under either policy", () => {
    for (const policy of ["forbidden", "migration_only"] as const) {
      const root = governedRepo(policy);
      write(root, ".github/workflows/meta.yml",
        "steps:\n  - uses: Quantum-L9/l9-meta-injector@0123456789abcdef0123456789abcdef01234567\n    with:\n      mode: check\n");
      write(root, "scripts/run-meta.sh", "#!/bin/sh\nnpx l9-meta-injector apply .\n");
      const inspection = inspect(root);
      expect(inspection.evidence.some((item) => item.kind === "canonical_invocation")).toBe(true);
      expect(inspection.evidence.some((item) => item.kind === "writer_invocation")).toBe(false);
      expect(inspection.conflicts).toEqual([]);
      expect(inspection.authorityResolved).toBe(true);
    }
  });

  test("redirecting the canonical writer's own output is not a competing write", () => {
    // `l9-meta-injector` contains an L9 metadata token by construction, and a shell
    // redirect is a write signal. Together they must not make this package a competitor.
    const root = governedRepo("forbidden");
    write(root, "scripts/sync-metadata.sh", "#!/bin/sh\nnpx l9-meta-injector apply . > build/meta.log\n");
    const inspection = inspect(root);
    expect(inspection.evidence.some((item) => item.kind === "writer_script")).toBe(false);
    expect(inspection.conflicts).toEqual([]);
    expect(inspection.authorityResolved).toBe(true);
  });
});

describe("policy disposition is a single explicit table", () => {
  test("each evidence kind resolves the same way every time", () => {
    expect(dispositionForEvidence("canonical_invocation", "forbidden")).toBe("inert");
    expect(dispositionForEvidence("legacy_marker", "forbidden")).toBe("inert");
    expect(dispositionForEvidence("legacy_marker", "migration_only")).toBe("inert");
    expect(dispositionForEvidence("writer_invocation", "forbidden")).toBe("conflict");
    expect(dispositionForEvidence("writer_invocation", "migration_only")).toBe("conflict");
    expect(dispositionForEvidence("writer_script", "forbidden")).toBe("conflict");
    expect(dispositionForEvidence("writer_script", "migration_only")).toBe("migration");
  });

  test("an unresolved policy fails closed", () => {
    expect(dispositionForEvidence("writer_script", undefined)).toBe("conflict");
    expect(dispositionForEvidence("writer_invocation", undefined)).toBe("conflict");
  });
});
