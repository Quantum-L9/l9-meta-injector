// Regression cases for manifest/v1 (WU-019 / RC-093): TOML table and
// array-of-tables headers, PEP 621 dependency arrays, and package.json nesting.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { manifestExtractor } from "../src/extractors/structured";
import type { AssertionDraft } from "../src/interpretation";
import { observeRepositoryModel, validateRepositoryModelPacket } from "../src/repository_model";

const REVISION = "git:0000000000000000000000000000000000000000";
const PRODUCER_VERSION = "4.0.0";

function extract(sourcePath: string, content: string): AssertionDraft[] {
  return manifestExtractor.extract({
    subjectId: "repo:fixture",
    sourcePath,
    content,
    contentHash: "sha256:0",
    pathExists: () => false,
  });
}

/** `predicate object @line` triples, in emission order. */
function claims(drafts: AssertionDraft[], predicate?: string): string[] {
  return drafts
    .filter((draft) => predicate === undefined || draft.predicate === predicate)
    .map((draft) => `${draft.predicate} ${draft.object} @${draft.sourceRange.start_line}`);
}

function objects(drafts: AssertionDraft[], predicate: string): string[] {
  return drafts.filter((draft) => draft.predicate === predicate).map((draft) => draft.object).sort();
}

const scratchDirs: string[] = [];
function repo(files: Record<string, string>): string {
  const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "l9-manifest-")), "repo");
  scratchDirs.push(path.dirname(root));
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, "utf8");
  }
  return root;
}
afterAll(() => {
  for (const dir of scratchDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function dependenciesDiagnostic(root: string): boolean {
  const packet = observeRepositoryModel({
    root,
    repositoryName: "repo",
    sourceRevision: REVISION,
    producerVersion: PRODUCER_VERSION,
  });
  expect(validateRepositoryModelPacket(packet).status).toBe("passed");
  return packet.payload.diagnostics.some(
    (d) => d.code === "unsupported-by-evidence" && d.details?.field === "dependencies",
  );
}

describe("manifest/v1 TOML sections", () => {
  it("REG-WU-019-RC-093-a: an array-of-tables header ends the poetry dependency table", () => {
    const drafts = extract(
      "pyproject.toml",
      [
        "[tool.poetry]",
        'name = "svc"',
        "",
        "[tool.poetry.dependencies]",
        'fastapi = "^0.110"',
        "",
        "[[tool.poetry.source]]",
        'name = "internal"',
        'url = "https://example.invalid/simple"',
        'priority = "supplemental"',
        "",
      ].join("\n"),
    );
    expect(objects(drafts, "package.dependency")).toEqual(["fastapi"]);
    expect(objects(drafts, "package.name")).toEqual(["svc"]);
  });

  it("REG-WU-019-RC-093-b: a Cargo [[bin]] name is not a second package name", () => {
    const drafts = extract(
      "Cargo.toml",
      ['[package]', 'name = "mycrate"', 'version = "0.1.0"', "", "[[bin]]", 'name = "mycli"', ""].join("\n"),
    );
    expect(claims(drafts, "package.name")).toEqual(["package.name mycrate @2"]);
    expect(claims(drafts, "package.packaging_system")).toEqual(["package.packaging_system cargo @2"]);
  });

  it("REG-WU-019-RC-093-c: a Cargo [[bin]] after [dependencies] contributes no dependency", () => {
    const drafts = extract(
      "Cargo.toml",
      ['[package]', 'name = "mycrate"', "", "[dependencies]", 'axum = "0.7"', "", "[[bin]]", 'name = "mycli"', 'path = "src/cli.rs"', ""].join("\n"),
    );
    expect(objects(drafts, "package.dependency")).toEqual(["axum"]);
    expect(claims(drafts, "package.framework")).toEqual(["package.framework axum @5"]);
  });

  it("REG-WU-019-RC-093-f: extras group names under [project.optional-dependencies] are not dependencies", () => {
    const drafts = extract(
      "pyproject.toml",
      ["[project]", 'name = "app"', "", "[project.optional-dependencies]", 'dev = ["pytest"]', 'docs = ["mkdocs"]', ""].join("\n"),
    );
    // DEC-RC-093 option 1: runtime scope only — neither the group names nor
    // their array values are package.dependency.
    expect(objects(drafts, "package.dependency")).toEqual([]);
    expect(objects(drafts, "package.name")).toEqual(["app"]);
  });

  it("keeps Poetry dev groups as they are today (DEC-RC-093 option 1)", () => {
    const drafts = extract(
      "pyproject.toml",
      [
        "[tool.poetry]",
        'name = "svc"',
        "[tool.poetry.group.dev.dependencies]",
        'pytest = "^8"',
        "[tool.poetry.dev-dependencies]",
        'black = "^24"',
        "",
      ].join("\n"),
    );
    expect(objects(drafts, "package.dependency")).toEqual(["black", "pytest"]);
  });
});

describe("manifest/v1 PEP 621 dependencies", () => {
  it("REG-WU-019-RC-093-d: a one-line [project].dependencies array is read", () => {
    const drafts = extract(
      "pyproject.toml",
      ["[project]", 'name = "app"', 'dependencies = ["fastapi>=0.110", "uvicorn"]', ""].join("\n"),
    );
    expect(claims(drafts, "package.dependency")).toEqual([
      "package.dependency fastapi @3",
      "package.dependency uvicorn @3",
    ]);
    expect(claims(drafts, "package.framework")).toEqual(["package.framework fastapi @3"]);
    expect(claims(drafts, "package.server")).toEqual(["package.server uvicorn @3"]);
    for (const draft of drafts.filter((d) => d.predicate === "package.dependency")) {
      expect(draft.evidenceClass).toBe("declared");
      expect(draft.confidence).toBe("medium");
    }
  });

  it("REG-WU-019-RC-093-e: a multi-line array cites each requirement on its own line", () => {
    const drafts = extract(
      "pyproject.toml",
      [
        "[project]",
        'name = "app"',
        "dependencies = [",
        '  "Django>=5.0",',
        "  # a comment line, with \"quotes\" and ] bracket",
        '  "requests[socks,security] >= 2.31",',
        "  'pywin32 ; sys_platform == \"win32\"',",
        '  "zope.interface~=6.0",',
        "]",
        'version = "1.0"',
        "",
      ].join("\n"),
    );
    expect(claims(drafts, "package.dependency")).toEqual([
      "package.dependency django @4",
      "package.dependency requests @6",
      "package.dependency pywin32 @7",
      "package.dependency zope.interface @8",
    ]);
    expect(claims(drafts, "package.framework")).toEqual(["package.framework django @4"]);
  });

  it("stays silent on an unterminated dependencies array", () => {
    const drafts = extract(
      "pyproject.toml",
      ["[project]", 'name = "app"', "dependencies = [", '  "fastapi",', 'license = "MIT"', ""].join("\n"),
    );
    expect(objects(drafts, "package.dependency")).toEqual([]);
    expect(objects(drafts, "package.name")).toEqual(["app"]);
  });
});

describe("manifest/v1 package.json nesting", () => {
  it("REG-WU-019-RC-093-g: nested name fields are not the package name", () => {
    const content = JSON.stringify(
      {
        name: "top",
        version: "1.0.0",
        author: { name: "Jane Doe", version: "x" },
        contributors: [{ name: "Bob" }],
      },
      null,
      2,
    );
    const drafts = extract("package.json", content);
    expect(claims(drafts, "package.name")).toEqual(["package.name top @2"]);
    expect(claims(drafts, "package.version")).toEqual(["package.version 1.0.0 @3"]);
  });

  it("REG-WU-019-RC-093-h: an empty dependencies object declares nothing", () => {
    const content = [
      "{",
      '  "name": "x",',
      '  "dependencies": {},',
      '  "license": "MIT",',
      '  "main": "index.js",',
      '  "scripts": {',
      '    "test": "vitest"',
      "  }",
      "}",
      "",
    ].join("\n");
    const drafts = extract("package.json", content);
    expect(objects(drafts, "package.dependency")).toEqual([]);
    expect(claims(drafts, "package.name")).toEqual(["package.name x @2"]);
  });

  it("REG-WU-019-RC-093-i: an inline dependencies object is read and closed on its own line", () => {
    const content = [
      "{",
      '  "dependencies": { "express": "^4" },',
      '  "name": "later",',
      '  "version": "2.0.0"',
      "}",
      "",
    ].join("\n");
    const drafts = extract("package.json", content);
    expect(claims(drafts, "package.dependency")).toEqual(["package.dependency express @2"]);
    expect(claims(drafts, "package.framework")).toEqual(["package.framework express @2"]);
    expect(claims(drafts, "package.name")).toEqual(["package.name later @3"]);
    expect(claims(drafts, "package.version")).toEqual(["package.version 2.0.0 @4"]);
  });

  it("REG-WU-019-RC-093-j: a minified package.json is read on line 1", () => {
    const drafts = extract("package.json", '{"name":"x","version":"1","dependencies":{"a":"1"}}');
    expect(claims(drafts)).toEqual([
      "package.name x @1",
      "package.version 1 @1",
      "package.dependency a @1",
    ]);
  });

  it("REG-WU-019-RC-093-k: braces, brackets and escaped quotes inside strings do not move depth", () => {
    const content = [
      "{",
      '  "description": "use {x} \\"q\\" [y] }}",',
      '  "keywords": ["{", "}", "\\\\"],',
      '  "dependencies": {',
      '    "left-pad": "1.0.0"',
      "  },",
      '  "name": "esc"',
      "}",
      "",
    ].join("\n");
    const drafts = extract("package.json", content);
    expect(claims(drafts)).toEqual([
      "package.dependency left-pad @5",
      "package.name esc @7",
    ]);
  });

  it("REG-WU-019-RC-093-o: malformed package.json does not throw and emits only attributable claims", () => {
    const unterminated = ['{', '  "name": "ok",', '  "version": "1', '  "dependencies": { "a": "1" }', "}", ""].join("\n");
    expect(() => extract("package.json", unterminated)).not.toThrow();
    expect(claims(extract("package.json", unterminated))).toEqual(["package.name ok @2"]);

    const unbalanced = ['{', '  "name": "ok"', "}", "}", '"name": "after"', ""].join("\n");
    expect(() => extract("package.json", unbalanced)).not.toThrow();
    expect(claims(extract("package.json", unbalanced))).toEqual(["package.name ok @2"]);

    const unclosed = ['{', '  "dependencies": {', '    "a": "1",'].join("\n");
    expect(() => extract("package.json", unclosed)).not.toThrow();
    expect(claims(extract("package.json", unclosed))).toEqual(["package.dependency a @3"]);
  });

  it("agrees with JSON.parse on top-level name, version and dependencies", () => {
    const documents: unknown[] = [
      { name: "a", version: "1.0.0", dependencies: { express: "^4", Fastify: "4" } },
      {
        version: "0.0.1",
        description: "{ \"name\": \"fake\" } [", // decoy text
        author: { name: "n", email: "e" },
        devDependencies: { vitest: "1" },
        dependencies: {},
        name: "b",
        nested: { dependencies: { notme: "1" } },
      },
      { name: "c\"q", dependencies: { "@scope/pkg": "npm:x@1" }, peerDependencies: { react: "18" } },
    ];
    for (const document of documents) {
      for (const content of [JSON.stringify(document), JSON.stringify(document, null, 2), JSON.stringify(document, null, "\t")]) {
        const parsed = JSON.parse(content) as { name?: string; version?: string; dependencies?: Record<string, string> };
        const drafts = extract("package.json", content);
        expect(objects(drafts, "package.name")).toEqual(parsed.name === undefined ? [] : [parsed.name]);
        expect(objects(drafts, "package.version")).toEqual(parsed.version === undefined ? [] : [parsed.version]);
        expect(objects(drafts, "package.dependency")).toEqual(
          Object.keys(parsed.dependencies ?? {}).map((key) => key.toLowerCase()).sort(),
        );
      }
    }
  });
});

describe("manifest/v1 preserved behaviour", () => {
  it("REG-WU-019-RC-093-l: existing poetry and multi-line package.json fixtures yield the same assertions", () => {
    expect(claims(extract("pyproject.toml", '[tool.poetry]\nname = "svc"\n'))).toEqual([
      "package.name svc @2",
      "package.packaging_system poetry @1",
    ]);
    expect(claims(extract("pyproject.toml", '[tool.poetry]\nname = "svc"\npython = "^3.11"\n'))).toEqual([
      "package.name svc @2",
      "package.packaging_system poetry @1",
    ]);
    expect(
      claims(extract("pyproject.toml", '[tool.poetry.dependencies]\npython = "^3.11"\nfastapi = "^0.110"\n')),
    ).toEqual([
      "package.python_constraint ^3.11 @2",
      "package.dependency fastapi @3",
      "package.framework fastapi @3",
    ]);
    expect(
      claims(extract("pyproject.toml", '[build-system]\nbuild-backend = "poetry.core.masonry.api"\n')),
    ).toEqual(["package.build_backend poetry.core.masonry.api @2", "package.packaging_system poetry @2"]);
    expect(
      claims(extract("package.json", '{\n  "name": "deps-repo",\n  "dependencies": {\n    "express": "^4.0.0"\n  }\n}\n')),
    ).toEqual(["package.name deps-repo @2", "package.dependency express @4", "package.framework express @4"]);
    expect(claims(extract("package.json", JSON.stringify({ name: "fixture", version: "1.2.3" }, null, 2)))).toEqual([
      "package.name fixture @2",
      "package.version 1.2.3 @3",
    ]);
  });
});

describe("manifest/v1 through observeRepositoryModel", () => {
  it("REG-WU-019-RC-093-m: a PEP 621-only repository declares its dependencies", () => {
    const root = repo({
      "pyproject.toml": '[project]\nname = "svc"\ndependencies = [\n  "fastapi>=0.110",\n]\n',
    });
    const packet = observeRepositoryModel({
      root,
      repositoryName: "repo",
      sourceRevision: REVISION,
      producerVersion: PRODUCER_VERSION,
    });
    const claim = packet.payload.assertions.find((a) => a.predicate === "package.dependency");
    expect(claim?.object).toBe("fastapi");
    expect(claim?.evidence_class).toBe("declared");
    expect(dependenciesDiagnostic(root)).toBe(false);
  });

  it("REG-WU-019-RC-093-n: a package.json with an empty dependencies object stays unsupported", () => {
    const root = repo({
      "package.json": '{\n  "name": "x",\n  "dependencies": {},\n  "license": "MIT",\n  "main": "index.js"\n}\n',
    });
    expect(dependenciesDiagnostic(root)).toBe(true);
  });
});
