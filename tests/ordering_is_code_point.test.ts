// ordering_is_code_point.test.ts — nothing on the filesystem/mutation seam sorts by locale.
//
// `localeCompare` varies with ICU data and the ambient locale, so a transaction's
// staging names, a discovery ledger, a carrier-decision list or a changed-path
// list could serialize differently on two hosts. `src/ordering.ts` is the one
// total order; this test holds the seam to it.
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, test } from "vitest";
import { compareCodePoints } from "../src/ordering";
import { discoverFiles } from "../src/retrieval";
import * as os from "node:os";

const SRC = path.join(__dirname, "..", "src");

describe("code-point ordering on the seam", () => {
  test("no source module outside ordering.ts calls localeCompare", () => {
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!entry.name.endsWith(".ts") || entry.name === "ordering.ts") continue;
        const lines = fs.readFileSync(full, "utf8").split("\n");
        lines.forEach((line, index) => {
          if (/\.localeCompare\(/.test(line) && !/^\s*(\/\/|\*)/.test(line)) offenders.push(`${path.relative(SRC, full)}:${index + 1}`);
        });
      }
    };
    walk(SRC);
    expect(offenders).toEqual([]);
  });

  test("discovery orders entries by code point, so upper case sorts before lower case", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "l9-order-"));
    // Write uppercase first so a case-insensitive volume keeps `B.md` rather than
    // collapsing the pair onto `b.md`. APFS default cannot store both.
    const intended = ["B.md", "_.md", "a.md", "b.md"];
    for (const name of intended) fs.writeFileSync(path.join(root, name), "#\n");
    const onDisk = new Set(fs.readdirSync(root));
    const expected = intended.filter((name) => onDisk.has(name)).sort(compareCodePoints);
    const files = discoverFiles(root, "**/*").files.map((f) => path.basename(f));
    expect(files).toEqual([...files].sort(compareCodePoints));
    expect(files).toEqual(expected);
    expect(files[0]).toBe("B.md");
  });
});
