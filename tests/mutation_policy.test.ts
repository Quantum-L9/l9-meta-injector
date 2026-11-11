import {
  assertCarrierDecisionCoverage,
  authorityFreeCarrierTier,
  type CarrierSubject,
  resolveCarrierDecision,
  resolveCarrierDecisions,
} from "../src/mutation_policy";
import {
  type AuthorityConfig,
  isAuthorityConfig,
  META_AUTHORITY_SCHEMA,
} from "../src/operation_contracts";

const authority: AuthorityConfig = {
  schema: META_AUTHORITY_SCHEMA,
  writer: { repository: "Quantum-L9/l9-meta-injector", ref: "v4.0.0" },
  default_carrier: "central_manifest",
  legacy_writers: "forbidden",
  inline_allow: ["prompts/**", "skills/**/SKILL.md", "doctrines/*.md", "kernels/**"],
};

function subject(
  path: string,
  artifactType: CarrierSubject["artifactType"],
  strategy: CarrierSubject["strategy"],
): CarrierSubject {
  return { path, artifactType, strategy };
}

describe("explicit metadata carrier policy", () => {
  test.each([
    [".git/config", "source", "line-comment"],
    [".l9/metadata-index.jsonl", "source", "sidecar"],
    ["node_modules/pkg/index.js", "source", "line-comment"],
    ["asset.png", "source", "skip-binary"],
    ["notes.md.l9meta.yaml", "source", "line-comment"],
    ["run.inject.log", "source", "sidecar"],
    // WU-013 / RC-016: normalize-filenames sidecars are injector-generated too.
    ["docs/My Note.md.normalize.log.yaml", "source", "yaml-frontmatter"],
  ] as const)("hard-skips protected or binary path %s", (filePath, artifactType, strategy) => {
    expect(
      resolveCarrierDecision(subject(filePath, artifactType, strategy), authority, "apply").carrier,
    ).toBe("hard_skip");
  });

  test.each([
    ["dist/index.js", "source", "line-comment"],
    ["coverage/report.json", "source", "sidecar"],
    ["vendor/lib.py", "source", "line-comment"],
    ["package-lock.json", "source", "sidecar"],
    ["public/app.min.js", "source", "line-comment"],
    ["public/app.js.map", "source", "sidecar"],
  ] as const)(
    "inventories generated or externally managed path %s",
    (filePath, artifactType, strategy) => {
      expect(
        resolveCarrierDecision(subject(filePath, artifactType, strategy), authority, "apply")
          .carrier,
      ).toBe("inventory_only");
    },
  );

  test.each([
    ["src/app.ts", "source", "line-comment"],
    ["tests/app.test.ts", "test", "line-comment"],
    [".github/workflows/ci.yml", "source", "line-comment"],
    ["infra/main.tf", "source", "line-comment"],
    ["package.json", "source", "sidecar"],
    ["data/schema.json", "context", "sidecar"],
    ["docs/reference.rst", "context", "yaml-frontmatter"],
  ] as const)(
    "routes source/config/control path %s to central manifest",
    (filePath, artifactType, strategy) => {
      expect(
        resolveCarrierDecision(subject(filePath, artifactType, strategy), authority, "check")
          .carrier,
      ).toBe("central_manifest");
    },
  );

  test.each([
    ["prompts/release.md", "prompt"],
    ["skills/github/SKILL.md", "skill"],
    ["doctrines/safety.md", "doctrine"],
    ["kernels/change/CHANGE.md", "kernel"],
  ] as const)("allows explicit managed prose path %s inline", (filePath, artifactType) => {
    expect(
      resolveCarrierDecision(
        subject(filePath, artifactType, "yaml-frontmatter"),
        authority,
        artifactType === "skill" ? "skills" : "apply",
      ).carrier,
    ).toBe("inline_managed");
  });

  test("an explicit allow can authorize a safe source comment carrier", () => {
    const broad = { ...authority, inline_allow: ["**"] };
    expect(
      resolveCarrierDecision(subject("src/app.ts", "source", "line-comment"), broad, "apply")
        .carrier,
    ).toBe("inline_managed");
  });

  test("an allow pattern cannot force generic documentation inline", () => {
    const broad = { ...authority, inline_allow: ["docs/**"] };
    expect(
      resolveCarrierDecision(
        subject("docs/README.md", "unknown", "yaml-frontmatter"),
        broad,
        "apply",
      ).carrier,
    ).toBe("central_manifest");
  });

  test("default inline_managed still requires explicit allow", () => {
    const inlineDefault: AuthorityConfig = {
      ...authority,
      default_carrier: "inline_managed",
      inline_allow: [],
    };
    const result = resolveCarrierDecision(
      subject("prompts/release.md", "prompt", "yaml-frontmatter"),
      inlineDefault,
      "apply",
    );
    expect(result.carrier).toBe("central_manifest");
    expect(result.reason).toContain("requires an explicit");
  });

  test("skills mode does not bypass explicit inline authority", () => {
    const none: AuthorityConfig = { ...authority, inline_allow: [] };
    expect(
      resolveCarrierDecision(
        subject("skills/github/SKILL.md", "skill", "yaml-frontmatter"),
        none,
        "skills",
      ).carrier,
    ).toBe("central_manifest");
  });

  test.each([
    "/absolute/**",
    "../escape/**",
    "prompts/../secrets/**",
    "!prompts/**",
    "prompts\\**",
    "./prompts/**",
    "prompts//**",
  ])("rejects unsafe inline_allow pattern %s", (pattern) => {
    expect(isAuthorityConfig({ ...authority, inline_allow: [pattern] })).toBe(false);
  });

  test("returns deterministic path-sorted decisions with complete coverage", () => {
    const subjects = [
      subject("prompts/z.md", "prompt", "yaml-frontmatter"),
      subject("src/a.ts", "source", "line-comment"),
      subject("asset.zip", "source", "skip-binary"),
      subject("vendor/b.js", "source", "line-comment"),
    ];
    const decisions = resolveCarrierDecisions({ authority, mode: "check", subjects });
    expect(decisions.map((item) => item.path)).toEqual([
      "asset.zip",
      "prompts/z.md",
      "src/a.ts",
      "vendor/b.js",
    ]);
    assertCarrierDecisionCoverage(subjects, decisions);
  });

  test("rejects duplicate subjects and incomplete decision ledgers", () => {
    const duplicate = subject("src/a.ts", "source", "line-comment");
    expect(() =>
      resolveCarrierDecisions({ authority, mode: "check", subjects: [duplicate, duplicate] }),
    ).toThrow(/duplicate/);
    expect(() => assertCarrierDecisionCoverage([duplicate], [])).toThrow(/coverage mismatch/);
  });

  test.each(["/x", "../x", "a\\b", ".", ""])("rejects unsafe subject path %s", (filePath) => {
    expect(() =>
      resolveCarrierDecision(subject(filePath, "context", "yaml-frontmatter"), authority, "check"),
    ).toThrow();
  });
});

describe("format-safe opt-in precedence", () => {
  const broad = { ...authority, inline_allow: ["**"] };

  test.each([
    ["tests/check.py", "line-comment"],
    ["scripts/run.sh", "line-comment"],
    ["config/settings.toml", "line-comment"],
    ["infra/deploy.yaml", "line-comment"],
    ["web/app.css", "block-comment"],
    ["views/page.html", "block-comment"],
    ["src/main.asm", "line-comment"],
    ["docs/main.tex", "line-comment"],
    ["src/main.erl", "line-comment"],
  ] as const)("admits supported carrier %s only with opt-in", (name, strategy) => {
    expect(resolveCarrierDecision(subject(name, "source", strategy), broad, "apply").carrier).toBe(
      "inline_managed",
    );
    expect(
      resolveCarrierDecision(
        subject(name, "source", strategy),
        { ...broad, inline_allow: [] },
        "apply",
      ).carrier,
    ).toBe("central_manifest");
  });

  test.each([
    ["src/fixtures/sample.py", "line-comment", "central_manifest"],
    ["tests/fixture/input.yaml", "line-comment", "central_manifest"],
    ["tests/__fixtures__/sample.py", "line-comment", "central_manifest"],
    ["tests/golden_tests/output.css", "block-comment", "central_manifest"],
    ["datasets/train.py", "line-comment", "central_manifest"],
    ["src/generated/api.ts", "line-comment", "inventory_only"],
    ["packages/pkg/vendor/lib.py", "line-comment", "inventory_only"],
    ["src/api.generated.ts", "line-comment", "inventory_only"],
    ["pnpm-lock.yaml", "line-comment", "inventory_only"],
    ["config/state.lock", "line-comment", "inventory_only"],
    ["nested/node_modules/x.js", "line-comment", "hard_skip"],
    ["nested/.git/config", "line-comment", "hard_skip"],
    ["nested/.l9/authority.yaml", "line-comment", "hard_skip"],
    [".env", "line-comment", "hard_skip"],
    [".env.production", "line-comment", "hard_skip"],
    ["config/app.json", "sidecar", "central_manifest"],
    ["data/events.jsonl", "sidecar", "central_manifest"],
    ["notes.txt", "sidecar", "central_manifest"],
    ["prompts/input.md", "line-comment", "central_manifest"],
    ["src/app.ts", "block-comment", "central_manifest"],
    ["config/app.yaml", "block-comment", "central_manifest"],
    ["web/app.css", "line-comment", "central_manifest"],
  ] as const)("blanket allow never overrides protection for %s", (name, strategy, carrier) => {
    expect(resolveCarrierDecision(subject(name, "context", strategy), broad, "apply").carrier).toBe(
      carrier,
    );
  });

  test("exclusion outranks opt-in and leaves a named central reason", () => {
    const excluded = { ...broad, inline_exclude: ["tests/**"] };
    expect(
      resolveCarrierDecision(subject("tests/check.py", "test", "line-comment"), excluded, "check"),
    ).toMatchObject({
      carrier: "central_manifest",
      authorityRule: "inline_exclude:tests/**",
      reason: expect.stringContaining("inline_exclude"),
    });
    expect(
      resolveCarrierDecision(
        subject("tests/node_modules/x.py", "test", "line-comment"),
        excluded,
        "apply",
      ).carrier,
    ).toBe("hard_skip");
  });

  test("SKILL.md stays protected outside skills mode", () => {
    expect(
      resolveCarrierDecision(
        subject("skills/check/SKILL.md", "skill", "yaml-frontmatter"),
        broad,
        "apply",
      ).carrier,
    ).toBe("central_manifest");
  });

  test.each([".gitignore", ".env.example", ".github/workflows/ci.yml", ".github/CODEOWNERS"])(
    "hidden control %s requires its name, not a blanket",
    (name) => {
      expect(
        resolveCarrierDecision(subject(name, "source", "line-comment"), broad, "apply").carrier,
      ).toBe("central_manifest");
      expect(
        resolveCarrierDecision(
          subject(name, "source", "line-comment"),
          { ...broad, inline_allow: [name] },
          "apply",
        ).carrier,
      ).toBe("inline_managed");
    },
  );

  test.each(["src/main.s", "src/main.S", "src/main.m", "src/main.M"])(
    "even a supplied comment strategy cannot authorize ambiguous dialect %s",
    (name) => {
      for (const strategy of ["line-comment", "block-comment"] as const) {
        for (const inline_allow of [["**"], [name]]) {
          expect(
            resolveCarrierDecision(
              subject(name, "source", strategy),
              { ...broad, inline_allow },
              "apply",
            ).carrier,
          ).toBe("central_manifest");
        }
      }
    },
  );

  test.each([
    "nested/.github/workflows/ci.yml",
    "nested/.github/workflows/sub/ci.yml",
    "nested/.github/CODEOWNERS",
  ])("no allow can authorize nested GitHub control %s inline", (name) => {
    for (const inline_allow of [
      ["**"],
      [name],
      ["nested/.github/workflows/**", "nested/.github/CODEOWNERS"],
      ["**/.github/workflows/**", "**/.github/CODEOWNERS"],
    ]) {
      expect(
        resolveCarrierDecision(
          subject(name, "source", "line-comment"),
          { ...broad, inline_allow },
          "apply",
        ),
      ).toMatchObject({
        carrier: "central_manifest",
        authorityRule: "hidden-control-not-explicit",
      });
    }
  });
});

describe("authority-free carrier tier", () => {
  test.each([
    [".git/config", "line-comment", "hard_skip"],
    ["node_modules/pkg/index.js", "line-comment", "hard_skip"],
    ["asset.png", "skip-binary", "hard_skip"],
    ["dist/a.js", "line-comment", "inventory_only"],
    ["vendor/b.js", "line-comment", "inventory_only"],
    ["skills/lint_file.md", "yaml-frontmatter", null],
  ] as const)("%s is %s", (filePath, strategy, carrier) => {
    expect(authorityFreeCarrierTier({ path: filePath, strategy })?.carrier ?? null).toBe(carrier);
  });
});
