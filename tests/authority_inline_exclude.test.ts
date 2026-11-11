import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, test } from "vitest";
import { parseAuthorityYaml } from "../src/authority";
import { isAuthorityConfig, REQUIRED_SEMANTIC_LEDGERS } from "../src/operation_contracts";

function document(version: "v1" | "v2", exclude?: string): string {
  const lines = [
    `schema: l9.meta-authority/${version}`,
    "writer:",
    "  repository: Example/product",
    "  ref: v1",
    "default_carrier: central_manifest",
    "legacy_writers: forbidden",
    'inline_allow: ["**", ".github/workflows/**", ".gitignore"]',
    ...(exclude === undefined ? [] : [exclude]),
  ];
  if (version === "v2")
    lines.push(
      "semantic_foundation:",
      "  repository: Quantum-L9/.github",
      `  revision: ${"a".repeat(40)}`,
      "  release: v1",
      "  admission: candidate",
      "  ledgers:",
      ...REQUIRED_SEMANTIC_LEDGERS.map((id) => `    ${id}: sha256:${"a".repeat(64)}`),
      "product:",
      "  id: example-product",
      "  owner: Example/product",
      "  kind: Unknown",
      "  archetype: Unknown",
    );
  return `${lines.join("\n")}\n`;
}

const INVALID_PATTERNS = [
  "",
  "/absolute/**",
  "./relative/**",
  "../escape/**",
  "a/../b",
  "a/./b",
  "a//b",
  "a/",
  "!a/**",
  "a\\b",
  " a/**",
  "a/** ",
  "a\u0000b",
  "a\u0001b",
  "a\u007fb",
  "a".repeat(513),
];

describe.each(["v1", "v2"] as const)("%s authority inline_exclude", (version) => {
  test("old documents remain valid without the optional field", () => {
    const parsed = parseAuthorityYaml(document(version));
    expect(parsed.inline_exclude).toBeUndefined();
    expect(isAuthorityConfig(parsed)).toBe(true);
  });

  test.each([
    ["inline_exclude: []", []],
    [
      'inline_exclude: ["tests/fixtures/**", ".github/workflows/bytes.yml"]',
      ["tests/fixtures/**", ".github/workflows/bytes.yml"],
    ],
    [
      'inline_exclude:\n  - "tests/fixtures/**"\n  - ".env.example"',
      ["tests/fixtures/**", ".env.example"],
    ],
  ])("accepts positive safe list syntax %s", (list, expected) => {
    const parsed = parseAuthorityYaml(document(version, String(list)));
    expect(parsed.inline_exclude).toEqual(expected);
    expect(isAuthorityConfig(parsed)).toBe(true);
  });

  test.each(INVALID_PATTERNS)(
    "rejects unsafe exclusion %j via parser and object validator",
    (pattern) => {
      expect(() =>
        parseAuthorityYaml(document(version, `inline_exclude: ${JSON.stringify([pattern])}`)),
      ).toThrow();
      expect(
        isAuthorityConfig({ ...parseAuthorityYaml(document(version)), inline_exclude: [pattern] }),
      ).toBe(false);
    },
  );

  test.each([
    "inline_exclude:",
    'inline_exclude: "tests/**"',
    "inline_exclude: null",
    "inline_exclude: [null]",
    'inline_exclude: ["tests/**", "tests/**"]',
    "inline_exclude: []\ninline_exclude: []",
  ])("rejects malformed, duplicate or non-list exclusions %s", (list) => {
    expect(() => parseAuthorityYaml(document(version, list))).toThrow();
  });
});

describe("authority safe path-pattern schema parity", () => {
  const schema = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../schemas/meta-authority.schema.json"), "utf8"),
  ) as {
    $defs: { inline_allow: { items: { pattern: string } } };
    oneOf: Array<{ properties: { inline_exclude: { $ref: string } } }>;
  };
  const pattern = new RegExp(schema.$defs.inline_allow.items.pattern, "u");

  test("both authority versions admit optional exclusions through the same grammar", () => {
    expect(schema.oneOf.map((branch) => branch.properties.inline_exclude.$ref)).toEqual([
      "#/$defs/inline_allow",
      "#/$defs/inline_allow",
    ]);
  });

  test.each(["**", ".github/workflows/**", ".gitignore", "**/.env.example", "tests/fixtures/**"])(
    "schema admits safe pattern %s",
    (safe) => {
      expect(pattern.test(safe)).toBe(true);
    },
  );

  test.each(INVALID_PATTERNS.filter((item) => item.length <= 512))(
    "schema rejects unsafe pattern %j",
    (unsafe) => {
      expect(pattern.test(unsafe)).toBe(false);
    },
  );
});
