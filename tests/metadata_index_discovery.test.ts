import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { discoverFiles } from "../src/retrieval";

describe(".l9 discovery isolation", () => {
  test("normal discovery records .l9 once and never descends into it", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "l9-discovery-"));
    fs.mkdirSync(path.join(root, ".l9"), { recursive: true });
    fs.writeFileSync(path.join(root, ".l9", "metadata-index.jsonl"), "{}\n");
    fs.writeFileSync(path.join(root, ".l9", "meta-authority.yaml"), "schema: l9.meta-authority/v1\n");
    fs.mkdirSync(path.join(root, "src"));
    fs.writeFileSync(path.join(root, "src", "a.ts"), "export const a = 1;\n");

    const result = discoverFiles(root, "**/*", { protectSkillMd: false });
    expect(result.files.map((item) => path.relative(root, item).replace(/\\/g, "/"))).toEqual(["src/a.ts"]);
    const l9 = result.summary.entries.filter((entry) => entry.path === ".l9");
    expect(l9).toEqual([expect.objectContaining({ disposition: "generated_artifact", kind: "directory" })]);
    expect(result.summary.entries.some((entry) => entry.path.startsWith(".l9/"))).toBe(false);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
