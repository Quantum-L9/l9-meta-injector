/**
 * Governed failure observability (finding F-5).
 *
 * A refused apply used to print `passed=false` and exit 1, with the reason available only
 * by reading the injector's source. Every probe below asserts that a failing run names the
 * code, the path, and the reason on its own output — and that quoted repository content
 * never leaks a credential on the way out.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { runApplyAsync } from "../src/apply";
import { runCheckAsync, type CheckConfig } from "../src/check";

const report = require("../scripts/lib/operation-report") as {
  redact: (value: string) => string;
  renderApply: (label: string, apply: unknown, warnings?: string[]) => string[];
  renderCheck: (label: string, check: unknown, warnings?: string[]) => string[];
  renderThrow: (label: string, error: unknown, env?: NodeJS.ProcessEnv) => string[];
};

const roots: string[] = [];

const VALID_AUTHORITY = [
  "schema: l9.meta-authority/v1",
  "writer:",
  "  repository: Quantum-L9/l9-meta-injector",
  "  ref: v4.0.0",
  "default_carrier: inline_managed",
  "legacy_writers: forbidden",
  'inline_allow: ["**/*.md"]',
  "",
].join("\n");

function tempRoot(authority?: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "l9-failure-report-"));
  roots.push(root);
  fs.mkdirSync(path.join(root, ".l9"), { recursive: true });
  if (authority !== undefined) fs.writeFileSync(path.join(root, ".l9", "meta-authority.yaml"), authority, "utf8");
  fs.writeFileSync(path.join(root, "guide.md"), "# Guide\n\nBody text.\n", "utf8");
  return root;
}

function config(root: string): CheckConfig {
  const external = `${root}.out`;
  return {
    root,
    glob: "**/*.md",
    outDir: external,
    namespace: "fixture",
    authority: "l9.doctrine.platform",
    nearDupThreshold: 0.9,
    hashPrefixLength: 16,
    indexDir: external,
    verbose: false,
    llmEnabled: false,
    normalizeFilenames: false,
    writeInjectLog: false,
    localFiles: false,
    persistOutputs: false,
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(`${root}.out`, { recursive: true, force: true });
  }
});

/** Every governed refusal an operator can hit, and the evidence each must produce. */
const PROBES: Array<{ name: string; setup: (root: string) => void; authority?: string; expect: RegExp[] }> = [
  {
    name: "missing_authority",
    expect: [/META_AUTHORITY_FILE_MISSING/, /meta-authority\.yaml/],
    setup: () => {},
  },
  {
    name: "malformed_authority",
    authority: "schema: l9.meta-authority/v1\nwriter:\n  repository: not-a-repo-slug\n",
    expect: [/META_AUTHORITY_CONFIG_INVALID/, /meta-authority\.yaml/],
    setup: () => {},
  },
  {
    name: "wrong_writer",
    authority: VALID_AUTHORITY.replace("Quantum-L9/l9-meta-injector", "Other-Org/other-writer"),
    expect: [/META_AUTHORITY_WRITER_MISMATCH/, /meta-authority\.yaml/, /Other-Org\/other-writer/],
    setup: () => {},
  },
  {
    name: "competing_writer",
    authority: VALID_AUTHORITY,
    expect: [/META_AUTHORITY_CONFLICT/, /scripts\/inject-l9-meta\.py/],
    setup: (root) => {
      fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
      fs.writeFileSync(path.join(root, "scripts", "inject-l9-meta.py"),
        'from pathlib import Path\n\ndef inject(target, header):\n    Path(target).write_text(header)\n', "utf8");
    },
  },
  {
    name: "unsafe_frontmatter",
    authority: VALID_AUTHORITY,
    expect: [/META_AUTHORITY_CONFLICT/, /broken\.md/, /FRONTMATTER_CLOSING_FENCE_MISSING/],
    setup: (root) => {
      fs.writeFileSync(path.join(root, "broken.md"), "---\ntitle: Broken\n\n# No closing fence\n", "utf8");
    },
  },
];

describe("apply refusals are self-explaining", () => {
  for (const probe of PROBES) {
    test(`${probe.name} renders code, path, and reason`, async () => {
      const root = tempRoot(probe.authority ?? undefined);
      probe.setup(root);

      const result = await runApplyAsync(config(root));
      expect(result.passed).toBe(false);
      expect(result.repositoryMutated).toBe(false);

      const rendered = report.renderApply("apply-cli", result.apply, result.warnings).join("\n");
      for (const pattern of probe.expect) expect(rendered).toMatch(pattern);
      expect(rendered).toContain("the repository was not modified");
    });
  }
});

describe("check failures are self-explaining", () => {
  test("drift renders kind, path, and message", async () => {
    const root = tempRoot(VALID_AUTHORITY);
    const result = await runCheckAsync(config(root));
    expect(result.passed).toBe(false);

    const rendered = report.renderCheck("check-cli", result.check, result.warnings).join("\n");
    expect(rendered).toMatch(/stale: guide\.md: authorized inline metadata differs/);
    expect(rendered).toMatch(/missing: \.l9\/metadata-index\.jsonl: canonical central metadata index is missing/);
    // Expected/actual hashes accompany the drift so it can be reproduced, not guessed at.
    expect(rendered).toMatch(/expected [0-9a-f]{64}, actual [0-9a-f]{64}/);
  });

  test("an authority conflict renders its code alongside the drift", async () => {
    const root = tempRoot();
    const result = await runCheckAsync(config(root));
    const rendered = report.renderCheck("check-cli", result.check, result.warnings).join("\n");
    expect(rendered).toMatch(/repository authority conflict/);
    expect(rendered).toMatch(/META_AUTHORITY_FILE_MISSING at .*meta-authority\.yaml/);
  });
});

describe("ordering and containment", () => {
  test("multiple findings render in a stable order", () => {
    const check = {
      drift: [
        { path: "b.md", kind: "stale", message: "second" },
        { path: "a.md", kind: "missing", message: "first" },
        { path: "a.md", kind: "conflict", message: "middle" },
      ],
      authorityConflicts: [
        { code: "META_AUTHORITY_CONFLICT", path: "z", message: "z" },
        { code: "META_AUTHORITY_CONFLICT", path: "a", message: "a" },
      ],
      authorityNotices: [],
      carrierDecisions: [],
    };
    const once = report.renderCheck("check-cli", check).join("\n");
    expect(once).toBe(report.renderCheck("check-cli", check).join("\n"));
    expect(once.indexOf("a.md: middle")).toBeLessThan(once.indexOf("a.md: first"));
    expect(once.indexOf("a.md: first")).toBeLessThan(once.indexOf("b.md: second"));
    expect(once.indexOf("at a:")).toBeLessThan(once.indexOf("at z:"));
  });

  test("credential-shaped values are redacted from quoted evidence", () => {
    const rendered = report.renderApply("apply-cli", {
      authorityConflicts: [{
        code: "META_AUTHORITY_CONFLICT",
        path: ".github/workflows/meta.yml",
        message: "active control surface invokes a competing metadata writer",
        evidence: [
          "legacy-writer-invocation at line 7",
          'run: python sync.py --api-key=aB3dEfG9hIjKlMnOpQrStUvWxYz012345',
          "Authorization: Bearer aB3dEfG9hIjKlMnOpQrStUvWxYz012345",
        ],
      }],
      authorityNotices: [],
      carrierDecisions: [],
    }).join("\n");
    expect(rendered).not.toContain("aB3dEfG9hIjKlMnOpQrStUvWxYz012345");
    expect(rendered).toContain("[redacted]");
    // The actionable parts survive redaction.
    expect(rendered).toContain(".github/workflows/meta.yml");
    expect(rendered).toContain("legacy-writer-invocation at line 7");
  });

  test("hashes and pinned Action SHAs are not mistaken for credentials", () => {
    const sha = "0123456789abcdef0123456789abcdef01234567";
    const digest = `sha256:${"a1b2c3d4".repeat(8)}`;
    expect(report.redact(`uses: Quantum-L9/l9-meta-injector@${sha}`)).toContain(sha);
    expect(report.redact(`expected ${digest}`)).toContain(digest);
  });

  test("a thrown error renders a message, not a stack, unless debugging", () => {
    const error = new Error("APPLY_POSTCONDITION_FAILED: index differs from planned bytes");
    expect(report.renderThrow("apply-cli", error, {}).join("\n"))
      .toBe("apply-cli: FAILED: APPLY_POSTCONDITION_FAILED: index differs from planned bytes");
    expect(report.renderThrow("apply-cli", error, { L9_DEBUG: "1" })).toHaveLength(2);
  });
});

describe("non-blocking findings stay visible", () => {
  test("a migration allowance and a frontmatter fallback are both reported as notes", async () => {
    const root = tempRoot(VALID_AUTHORITY.replace("legacy_writers: forbidden", "legacy_writers: migration_only"));
    fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(root, "scripts", "inject-l9-meta.py"),
      'from pathlib import Path\n\ndef inject(target, header):\n    Path(target).write_text(header)\n', "utf8");
    fs.writeFileSync(path.join(root, "service.md"), "---\ntitle: Service\nlimits:\n  cpu: 2\n---\n\n# Service\n", "utf8");

    const result = await runApplyAsync(config(root));
    expect(result.passed).toBe(true);

    const rendered = report.renderApply("apply-cli", result.apply, result.warnings).join("\n");
    expect(rendered).toMatch(/note: META_LEGACY_WRITER_MIGRATION at scripts\/inject-l9-meta\.py/);
    expect(rendered).toMatch(/note: service\.md: .*frontmatter_unsupported:FRONTMATTER_COMPLEX_YAML/);
  });
});
