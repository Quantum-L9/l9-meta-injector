import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { DISCOVERY_DISPOSITIONS } from "../src/discovery_contracts";
import { discoverFiles, findFiles } from "../src/retrieval";

const roots: string[] = [];
function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "l9-discovery-"));
  roots.push(root);
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("terminal discovery ledger", () => {
  test("assigns exactly one terminal disposition to every encountered entry", () => {
    const root = tempRoot();
    fs.writeFileSync(path.join(root, ".l9metaignore"), "ignored.txt\n", "utf8");
    fs.writeFileSync(path.join(root, "eligible.md"), "# eligible\n", "utf8");
    fs.writeFileSync(path.join(root, "ignored.txt"), "ignored\n", "utf8");
    fs.writeFileSync(path.join(root, "generated.inject.log"), "generated\n", "utf8");
    fs.writeFileSync(path.join(root, "binary.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    fs.writeFileSync(path.join(root, "nul.data"), Buffer.from([0x61, 0x00, 0x62]));
    fs.writeFileSync(path.join(root, "latin.data"), Buffer.from([0xff, 0xfe, 0xfd]));
    fs.mkdirSync(path.join(root, ".github", "workflows"), { recursive: true });
    fs.writeFileSync(path.join(root, ".github", "workflows", "ci.yml"), "name: ci\n", "utf8");
    fs.mkdirSync(path.join(root, "visible"));
    fs.writeFileSync(path.join(root, "visible", "note.txt"), "note\n", "utf8");
    fs.symlinkSync("eligible.md", path.join(root, "linked.md"));

    const result = discoverFiles(root, "**/*");
    const paths = result.summary.entries.map((entry) => entry.path);
    expect(new Set(paths).size).toBe(paths.length);
    expect(result.summary.total).toBe(result.summary.entries.length);
    expect(Object.values(result.summary.byDisposition).reduce((a, b) => a + b, 0)).toBe(result.summary.total);
    for (const disposition of DISCOVERY_DISPOSITIONS) {
      expect(result.summary.byDisposition).toHaveProperty(disposition);
    }

    const byPath = new Map(result.summary.entries.map((entry) => [entry.path, entry]));
    expect(byPath.get("eligible.md")?.disposition).toBe("eligible");
    expect(byPath.get("ignored.txt")?.disposition).toBe("omitted");
    expect(byPath.get("generated.inject.log")?.disposition).toBe("generated_artifact");
    expect(byPath.get("binary.png")?.disposition).toBe("known_binary");
    expect(byPath.get("nul.data")?.disposition).toBe("binary_detected");
    expect(byPath.get("latin.data")?.disposition).toBe("unsupported_encoding");
    expect(byPath.get(".github")?.disposition).toBe("hidden_control");
    expect(byPath.get("linked.md")?.disposition).toBe("symlink");
    expect(result.summary.blocking).toBe(1);
    expect(result.files.map((file) => path.relative(root, file).split(path.sep).join("/"))).toEqual([
      "eligible.md",
      "visible/note.txt",
    ]);
    expect(paths.every((item) => !path.isAbsolute(item))).toBe(true);
  });

  test("findFiles remains a compatible file-only wrapper", () => {
    const root = tempRoot();
    fs.writeFileSync(path.join(root, "a.md"), "a", "utf8");
    fs.writeFileSync(path.join(root, "b.txt"), "b", "utf8");
    expect(findFiles(root, "**/*.md").map((file) => path.basename(file))).toEqual(["a.md"]);
  });
});
