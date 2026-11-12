import * as fs from "fs";import * as path from "path";
const authority=require("../scripts/lib/architecture-authority");const api=require("../scripts/lib/public-api");const dist=require("../scripts/lib/dist-integrity");
describe("architecture authority",()=>{
 test("active authority and schemas validate",()=>{expect(authority.validateAuthorityDocument(authority.readJson(path.join(process.cwd(),"docs/architecture-authority.json")))).toEqual([]);expect(authority.validateAuthoritySchemaDocument(authority.readJson(path.join(process.cwd(),"docs/schemas/architecture-authority.schema.json")))).toEqual([]);});
 test("traceability and legacy archive validate",()=>{expect(authority.validateTraceabilityDocument(authority.readJson(path.join(process.cwd(),"docs/traceability-map.json")))).toEqual([]);expect(authority.verifyLegacyArchive(process.cwd())).toEqual([]);});
 test("API and package contracts validate",()=>{const contract=authority.readJson(path.join(process.cwd(),"docs/public-api-contract.json"));const pkg=authority.readJson(path.join(process.cwd(),"package.json"));expect(api.validateContract(contract,process.cwd())).toEqual([]);expect(api.validatePackageAgainstContract(pkg,contract)).toEqual([]);expect(dist.validatePackageContract(authority.readJson(path.join(process.cwd(),"docs/package-contract.json")))).toEqual([]);});
 test("manifest inventory contains API boundary",()=>{const paths=authority.AUTHORITY_CRITICAL_PATHS;for(const rel of ["src/index.ts","src/public/inventory.ts","src/public/schema.ts","src/public/advanced.ts","src/public/llm.ts","docs/public-api-contract.json","scripts/check-public-api.js","tests/public_api_runtime.test.ts"])expect(paths).toContain(rel);});
 test("active docs do not revive the legacy plane",()=>{for(const rel of ["docs/contracts.md","docs/decision_log.md","docs/manifest.md","docs/public-api.md"]){const text=fs.readFileSync(path.join(process.cwd(),rel),"utf8");expect(text).not.toMatch(/consolidate_request|move_map\.csv|L9_ARTIFACT_META|folder_artifact_consolidation/i);}});
});

// ADR-093: the architecture manifest is computed from the tree under test, never committed.
describe("architecture manifest is computed, not committed (ADR-093)", () => {
  const os = require("node:os") as typeof import("node:os");
  const { spawnSync } = require("node:child_process");
  const { gitBinary } = require("../scripts/lib/git-binary");

  test("no committed copy exists or is tracked", () => {
    expect(authority.RETIRED_MANIFEST).toBe("docs/architecture-manifest.json");
    expect(fs.existsSync(path.join(authority.REPO, authority.RETIRED_MANIFEST))).toBe(false);
    const git = gitBinary(() => { throw new Error("git missing"); });
    const listed = spawnSync(git, ["ls-files", "--", authority.RETIRED_MANIFEST], { cwd: authority.REPO, encoding: "utf8" });
    expect(listed.status, listed.stderr).toBe(0);
    expect(listed.stdout).toBe("");
  });

  test("every authority-critical file is computed once, from the tree", () => {
    const manifest = authority.buildManifest(authority.REPO);
    const paths = manifest.entries.map((entry: { path: string }) => entry.path);
    expect(paths).toEqual(authority.AUTHORITY_CRITICAL_PATHS);
    expect(new Set(paths).size).toBe(paths.length);
    for (const entry of manifest.entries) expect(entry.git_blob_sha1).toMatch(/^[0-9a-f]{40}$/);
    expect(authority.buildManifest(authority.REPO)).toEqual(manifest);
  });

  test("a missing, duplicated, symlinked or retired path is refused", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "l9-architecture-manifest-"));
    try {
      fs.writeFileSync(path.join(root, "a.md"), "a\n", "utf8");
      expect(authority.buildManifest(root, ["a.md"]).entries).toHaveLength(1);
      expect(() => authority.buildManifest(root, ["a.md", "missing.md"])).toThrow(/missing or unsafe authority-critical file: missing\.md/);
      expect(() => authority.buildManifest(root, ["a.md", "a.md"])).toThrow(/listed twice: a\.md/);
      expect(() => authority.buildManifest(root, [authority.RETIRED_MANIFEST])).toThrow(/retired manifest/);
      if (process.platform !== "win32") {
        fs.symlinkSync("a.md", path.join(root, "link.md"));
        expect(() => authority.buildManifest(root, ["link.md"])).toThrow(/missing or unsafe authority-critical file: link\.md/);
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("check:manifest passes on this tree without writing anything", () => {
    const script = path.join(authority.REPO, "scripts", "generate-architecture-manifest.js");
    const run = spawnSync(process.execPath, [script, "--check"], { cwd: authority.REPO, encoding: "utf8" });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain("architecture-manifest: OK");
    expect(fs.existsSync(path.join(authority.REPO, authority.RETIRED_MANIFEST))).toBe(false);
  });
});
