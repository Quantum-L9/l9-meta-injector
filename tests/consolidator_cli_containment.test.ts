/**
 * tools/consolidation is reference material, not the active engine, but its CLI still
 * reads and writes operator-supplied paths. Every --source / --output / --from-manifest
 * path is contained under the working directory before any filesystem use, as ADR-022
 * requires of the JS CLI (SonarCloud S8707 on the CLI-argument sinks).
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, test } from "vitest";

const SCRIPT = path.join(__dirname, "..", "tools", "consolidation", "folder_artifact_consolidator.py");
const roots: string[] = [];
afterAll(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

function workspace(): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "l9-consolidator-")));
  roots.push(root);
  fs.mkdirSync(path.join(root, "work", "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "work", "src", "note.md"), "# note\n", "utf8");
  return root;
}

function phaseB(cwd: string, source: string, output: string) {
  return spawnSync("python3", [SCRIPT, "--phase", "B", "--source", source, "--output", output], { cwd, encoding: "utf8" });
}

describe("folder_artifact_consolidator CLI path containment", () => {
  test("relative paths inside the working directory are accepted", () => {
    const root = workspace();
    const result = phaseB(path.join(root, "work"), "src", "out");
    expect(result.status, result.stderr).toBe(0);
    expect(fs.existsSync(path.join(root, "work", "out", "00_MANIFESTS", "move_map.csv"))).toBe(true);
  });

  test("an --output that escapes the working directory is refused before anything is written", () => {
    const root = workspace();
    const result = phaseB(path.join(root, "work"), "src", "../escaped");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("path escapes boundary: ../escaped");
    expect(fs.existsSync(path.join(root, "escaped"))).toBe(false);
  });

  test("an absolute --source outside the working directory is refused", () => {
    const root = workspace();
    const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "l9-consolidator-outside-")));
    roots.push(outside);
    const result = phaseB(path.join(root, "work"), outside, "out");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("path escapes boundary");
    expect(fs.existsSync(path.join(root, "work", "out"))).toBe(false);
  });

  test("phase C's default output (the manifest's grandparent) is contained too", () => {
    const root = workspace();
    const work = path.join(root, "work");
    fs.writeFileSync(path.join(work, "move_map.csv"), "source_path,content_hash,output_path\n", "utf8");
    const result = spawnSync("python3", [SCRIPT, "--phase", "C", "--from-manifest", "move_map.csv", "--source", "src"], {
      cwd: work,
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("path escapes boundary");
  });

  test("a --from-manifest outside the working directory is refused in phase C", () => {
    const root = workspace();
    const result = spawnSync(
      "python3",
      [SCRIPT, "--phase", "C", "--from-manifest", "../move_map.csv", "--source", "src"],
      { cwd: path.join(root, "work"), encoding: "utf8" },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("path escapes boundary: ../move_map.csv");
  });
});
