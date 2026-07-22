import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const lib = require(path.resolve(__dirname, "../scripts/lib/dist-integrity.js"));
function temp(prefix: string) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }
function put(root: string, rel: string, content: string) {
  const file = path.join(root, rel); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); return file;
}
function contract() {
  return {
    schema: "l9.package-contract/v1",
    repository: "Quantum-L9/l9-meta-injector",
    package_name: "l9-meta-injector",
    entrypoints: { runtime: "dist/index.js", types: "dist/index.d.ts" },
    required_files: ["package.json", "dist/index.js", "dist/index.d.ts"],
    allowed_top_level: ["package.json", "dist"],
    forbidden_paths: ["dist/legacy.js"],
    forbidden_prefixes: ["src/"],
    dist_policy: "exact",
    public_schema_policy: "separate",
    consumer_tests: { runtime: "runtime.cjs", types: "types.ts", tsconfig: "tsconfig.json" },
  };
}

describe("RAA-006 dist and package integrity primitives", () => {
  test("identical directory trees pass", () => {
    const a = temp("dist-a-"), b = temp("dist-b-");
    try { put(a, "index.js", "x\n"); put(b, "index.js", "x\n"); expect(lib.compareDirectories(a, b).ok).toBe(true); }
    finally { fs.rmSync(a,{recursive:true,force:true}); fs.rmSync(b,{recursive:true,force:true}); }
  });
  test("changed, missing, and stale files are reported separately", () => {
    const a = temp("dist-a-"), b = temp("dist-b-");
    try {
      put(a, "same.js", "a"); put(b, "same.js", "b");
      put(a, "stale.js", "x"); put(b, "new.js", "y");
      const result = lib.compareDirectories(a, b);
      expect(result.ok).toBe(false);
      expect(result.changed.map((x: {path:string}) => x.path)).toEqual(["same.js"]);
      expect(result.staleInCommitted).toEqual(["stale.js"]);
      expect(result.missingFromCommitted).toEqual(["new.js"]);
    } finally { fs.rmSync(a,{recursive:true,force:true}); fs.rmSync(b,{recursive:true,force:true}); }
  });
  test("package contract rejects forbidden and unexpected packed paths", () => {
    const errors = lib.validatePackedFiles(
      ["package.json","dist/index.js","dist/index.d.ts","src/private.ts","other.txt"],
      contract(),
      ["dist/index.js","dist/index.d.ts"],
    );
    expect(errors.some((x: string) => x.includes("forbidden packed prefix"))).toBe(true);
    expect(errors.some((x: string) => x.includes("top-level path"))).toBe(true);
  });
  test("packed dist must exactly match repository dist", () => {
    const errors = lib.validatePackedFiles(
      ["package.json","dist/index.js","dist/index.d.ts","dist/extra.js"],
      contract(),
      ["dist/index.js","dist/index.d.ts"],
    );
    expect(errors).toContain("packed dist contains unexpected file: dist/extra.js");
  });
  test("npm pack JSON parser tolerates lifecycle noise", () => {
    const parsed = lib.parseNpmPackJson("prepack output\n[{\"filename\":\"x.tgz\",\"files\":[]}]");
    expect(parsed[0].filename).toBe("x.tgz");
  });
});
