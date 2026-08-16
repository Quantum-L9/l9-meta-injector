import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { inventoryTree } from "../src/inventory";
import {
  DEFAULT_MAX_FILE_BYTES,
  INTERPRETATION_PROFILE_ID,
  INTERPRETATION_PROFILE_VERSION,
  MAX_EXCERPT_LENGTH,
  boundExcerpt,
  interpretRepository,
  isSecretCandidatePath,
  looksSecret,
  type Extractor,
  type InterpretationResult,
} from "../src/interpretation";
import { defaultExtractors } from "../src/extractors";

const SUBJECT = "repo:fixture";

/** Materialize a repository, inventory it without writing into it, interpret it. */
function interpret(files: Record<string, string>, root?: string): InterpretationResult {
  const repoRoot = root ?? fs.mkdtempSync(path.join(os.tmpdir(), "l9-interp-"));
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(repoRoot, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, "utf8");
  }
  const inventory = inventoryTree({
    root: repoRoot,
    outDir: path.join(os.tmpdir(), `l9-interp-out-${path.basename(repoRoot)}`),
    dryRun: true,
    injectHeaders: false,
    folderSidecars: false,
    writeSidecars: false,
  });
  return interpretRepository({
    root: repoRoot,
    subjectId: SUBJECT,
    inventory,
    extractors: defaultExtractors(),
  });
}

function objectsFor(result: InterpretationResult, predicate: string): string[] {
  return result.assertions
    .filter((assertion) => assertion.predicate === predicate)
    .map((assertion) => assertion.object)
    .sort();
}

describe("interpretation seam", () => {
  it("leaves existing behavior untouched when nothing matches", () => {
    const result = interpret({ "notes.txt": "nothing structured here\n" });
    expect(result.assertions).toEqual([]);
    expect(result.diagnostics).toEqual([]);
    expect(result.profile.profile_id).toBe(INTERPRETATION_PROFILE_ID);
    expect(result.profile.profile_version).toBe(INTERPRETATION_PROFILE_VERSION);
  });

  it("produces the same assertions for the same bytes", () => {
    const files = { "pyproject.toml": '[tool.poetry]\nname = "svc"\n' };
    const first = interpret(files);
    const second = interpret(files);
    expect(second.assertions.map((a) => ({ ...a, source_content_hash: a.source_content_hash })))
      .toEqual(first.assertions);
    expect(second.profile.profile_hash).toBe(first.profile.profile_hash);
  });

  it("produces the same assertions from a different checkout path", () => {
    const files = {
      "pyproject.toml": '[tool.poetry]\nname = "svc"\npython = "^3.11"\n',
      "spec.yaml": 'service:\n  name: "svc-api"\nactions:\n  - name: "execute"\n',
    };
    const left = interpret(files);
    const right = interpret(files);
    // Identity must not carry the temp directory either checkout lives in.
    expect(right.assertions.map((a) => a.assertion_id)).toEqual(
      left.assertions.map((a) => a.assertion_id),
    );
    for (const assertion of left.assertions) {
      expect(path.isAbsolute(assertion.source_path)).toBe(false);
    }
  });

  it("orders assertions deterministically regardless of extractor order", () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "l9-interp-order-"));
    fs.writeFileSync(path.join(repoRoot, "pyproject.toml"), '[tool.poetry]\nname = "svc"\n');
    fs.writeFileSync(path.join(repoRoot, "spec.yaml"), 'service:\n  name: "api"\n');
    const inventory = inventoryTree({
      root: repoRoot,
      outDir: path.join(os.tmpdir(), "l9-interp-order-out"),
      dryRun: true,
      injectHeaders: false,
      folderSidecars: false,
      writeSidecars: false,
    });
    const forward = interpretRepository({
      root: repoRoot,
      subjectId: SUBJECT,
      inventory,
      extractors: defaultExtractors(),
    });
    const reversed = interpretRepository({
      root: repoRoot,
      subjectId: SUBJECT,
      inventory,
      extractors: [...defaultExtractors()].reverse(),
    });
    expect(reversed.assertions).toEqual(forward.assertions);
    expect(reversed.profile.profile_hash).toBe(forward.profile.profile_hash);
  });

  it("requires an exact source span and a source hash on every assertion", () => {
    const result = interpret({
      "pyproject.toml": '[tool.poetry]\nname = "svc"\npython = "^3.11"\n',
    });
    expect(result.assertions.length).toBeGreaterThan(0);
    for (const assertion of result.assertions) {
      expect(assertion.source_range.start_line).toBeGreaterThanOrEqual(1);
      expect(assertion.source_range.end_line).toBeGreaterThanOrEqual(
        assertion.source_range.start_line,
      );
      expect(assertion.source_content_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(assertion.evidence_excerpt.length).toBeGreaterThan(0);
      expect(assertion.evidence_excerpt.length).toBeLessThanOrEqual(MAX_EXCERPT_LENGTH);
      expect(assertion.extractor_id).toBeTruthy();
      expect(["declared", "observed"]).toContain(assertion.evidence_class);
    }
  });

  it("binds the profile hash to the extractor set", () => {
    const files = { "pyproject.toml": '[tool.poetry]\nname = "svc"\n' };
    const full = interpret(files);
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "l9-interp-profile-"));
    fs.writeFileSync(path.join(repoRoot, "pyproject.toml"), files["pyproject.toml"]);
    const inventory = inventoryTree({
      root: repoRoot,
      outDir: path.join(os.tmpdir(), "l9-interp-profile-out"),
      dryRun: true,
      injectHeaders: false,
      folderSidecars: false,
      writeSidecars: false,
    });
    const reduced = interpretRepository({
      root: repoRoot,
      subjectId: SUBJECT,
      inventory,
      extractors: defaultExtractors().slice(0, 2),
    });
    expect(reduced.profile.profile_hash).not.toBe(full.profile.profile_hash);
  });
});

describe("secret safety", () => {
  it("never opens candidate secret files", () => {
    expect(isSecretCandidatePath(".env")).toBe(true);
    expect(isSecretCandidatePath(".env.local")).toBe(true);
    expect(isSecretCandidatePath("deploy/server.pem")).toBe(true);
    expect(isSecretCandidatePath("keys/id_rsa")).toBe(true);
    expect(isSecretCandidatePath("config/credentials.yaml")).toBe(true);
    expect(isSecretCandidatePath("app/secret_store.py")).toBe(true);
    expect(isSecretCandidatePath("src/main.py")).toBe(false);
    expect(isSecretCandidatePath("pyproject.toml")).toBe(false);
  });

  it("skips a secret-named python file rather than interpreting it", () => {
    const result = interpret({
      "secrets_router.py": '@app.get("/leak")\nasync def leak():\n    return 1\n',
    });
    expect(objectsFor(result, "http.route")).toEqual([]);
    expect(result.diagnostics.map((d) => d.code)).toContain(
      "interpretation.secret_path_skipped",
    );
  });

  it("persists no secret value from an innocuously named file", () => {
    const result = interpret({
      "package.json": JSON.stringify(
        { name: "svc", dependencies: { fastapi: "^1.0.0" } },
        null,
        2,
      ),
      "settings.py": 'API_KEY = "ghp_abcdefghijklmnopqrstuvwxyz0123456789"\n',
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz0123456789");
  });

  it("recognizes credential shapes", () => {
    expect(looksSecret('api_key = "abcdefghijklmnop"')).toBe(true);
    expect(looksSecret("-----BEGIN RSA PRIVATE KEY-----")).toBe(true);
    expect(looksSecret("AKIAIOSFODNN7EXAMPLE")).toBe(true);
    expect(looksSecret("fastapi")).toBe(false);
    expect(looksSecret("GET /health")).toBe(false);
  });

  it("bounds every excerpt", () => {
    const long = "x".repeat(MAX_EXCERPT_LENGTH * 3);
    expect(boundExcerpt(long).length).toBeLessThanOrEqual(MAX_EXCERPT_LENGTH);
    expect(boundExcerpt("  a\n\n  b  ")).toBe("a b");
  });

  it("reports an oversized file instead of reading it", () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "l9-interp-big-"));
    fs.writeFileSync(path.join(repoRoot, "pyproject.toml"), '[tool.poetry]\nname = "svc"\n');
    const inventory = inventoryTree({
      root: repoRoot,
      outDir: path.join(os.tmpdir(), "l9-interp-big-out"),
      dryRun: true,
      injectHeaders: false,
      folderSidecars: false,
      writeSidecars: false,
    });
    const result = interpretRepository({
      root: repoRoot,
      subjectId: SUBJECT,
      inventory,
      extractors: defaultExtractors(),
      maxFileBytes: 1,
    });
    expect(result.assertions).toEqual([]);
    expect(result.diagnostics.map((d) => d.code)).toContain("interpretation.file_too_large");
    expect(DEFAULT_MAX_FILE_BYTES).toBeGreaterThan(1);
  });
});

describe("extractors report, never resolve", () => {
  it("preserves competing status and role claims from one README", () => {
    const result = interpret({
      "README.md": [
        "> **DEPRECATED.** Do not use this repository as an org bootstrap template.",
        ">",
        "> **SSOT replacement:** [org/replacement](https://github.com/org/replacement)",
        "",
        "# Sample",
        "",
        "> The reference implementation for all services.",
        "",
      ].join("\n"),
    });
    expect(objectsFor(result, "repository.status")).toEqual(["deprecated"]);
    expect(objectsFor(result, "repository.replaced_by")).toEqual(["org/replacement"]);
    // The stale claim is preserved rather than deleted by the stronger one.
    expect(objectsFor(result, "repository.self_described_role")).toEqual([
      "reference-implementation",
    ]);
    expect(objectsFor(result, "repository.disclaimed_role")).toEqual(["bootstrap-template"]);
  });

  it("keeps two manifests' package names as separate sourced claims", () => {
    const result = interpret({
      "pyproject.toml": '[tool.poetry]\nname = "service-a"\n',
      "client/package.json": JSON.stringify({ name: "@scope/client" }, null, 2),
    });
    const names = result.assertions.filter((a) => a.predicate === "package.name");
    expect(names.map((a) => a.object).sort()).toEqual(["@scope/client", "service-a"]);
    // Each claim keeps the file that made it, so a consumer can tell them apart.
    expect(new Set(names.map((a) => a.source_path)).size).toBe(2);
  });

  it("observes a route and its handler markers without judging the endpoint", () => {
    const result = interpret({
      "engine/main.py": [
        "@app.post('/v1/execute')",
        "async def execute(payload: dict):",
        "    # TODO: route to your engine handler",
        "    return {}",
        "",
        "@app.get('/health')",
        "async def health():",
        "    return {'status': 'ok'}",
        "",
      ].join("\n"),
    });
    expect(objectsFor(result, "http.route")).toEqual(["GET /health", "POST /v1/execute"]);
    expect(objectsFor(result, "http.handler_body_marker")).toEqual(["execute: todo-marker"]);
    // No assertion may claim the endpoint is wired, unwired, or production ready.
    const forbidden = /fully[- ]implemented|not[- ]implemented|production[- ]ready|reachable/i;
    for (const assertion of result.assertions) {
      expect(forbidden.test(assertion.object)).toBe(false);
    }
  });

  it("flags a declared canonical path that is not in the tree", () => {
    const result = interpret({
      "AGENTS.md": [
        "Agents must treat the following as canonical:",
        "- `contracts/present.yaml`",
        "- `contracts/absent.yaml`",
        "",
      ].join("\n"),
      "contracts/present.yaml": "kind: contract\n",
    });
    expect(objectsFor(result, "authority.canonical_contract")).toEqual([
      "contracts/absent.yaml",
      "contracts/present.yaml",
    ]);
    expect(objectsFor(result, "authority.unresolved_reference")).toEqual([
      "contracts/absent.yaml",
    ]);
    expect(objectsFor(result, "authority.canonical_contract_count")).toEqual(["2"]);
  });

  it("stays silent when an authority header has no list", () => {
    const result = interpret({ "AGENTS.md": "Agents must treat the following as canonical:\n" });
    expect(objectsFor(result, "authority.canonical_contract")).toEqual([]);
    expect(objectsFor(result, "authority.canonical_contract_count")).toEqual([]);
  });

  it("does not treat a broken extractor as a crash", () => {
    const exploding: Extractor = {
      id: "exploding/v1",
      version: "1.0.0",
      matches: (sourcePath) => sourcePath === "boom.txt",
      extract: () => {
        throw new Error("bad parse");
      },
    };
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "l9-interp-boom-"));
    fs.writeFileSync(path.join(repoRoot, "boom.txt"), "content\n");
    const inventory = inventoryTree({
      root: repoRoot,
      outDir: path.join(os.tmpdir(), "l9-interp-boom-out"),
      dryRun: true,
      injectHeaders: false,
      folderSidecars: false,
      writeSidecars: false,
    });
    const result = interpretRepository({
      root: repoRoot,
      subjectId: SUBJECT,
      inventory,
      extractors: [exploding],
    });
    expect(result.assertions).toEqual([]);
    expect(result.diagnostics.map((d) => d.code)).toContain(
      "interpretation.extractor_failed",
    );
  });
});
