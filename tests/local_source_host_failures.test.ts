// local_source_host_failures.test.ts — a host failure is not a property of the archive.
//
// Everything the archive itself causes becomes a hold; everything the host causes
// is thrown. Either way the scratch root this run created is the run's only
// footprint and must not survive it.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, test } from "vitest";
import { acquireLocalSource } from "../src/local_source";
import type { OmitMatcher } from "../src/omit";
import { treeSnapshot, writeRawZip } from "./helpers/zip_fixtures";

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "l9-host-failure-"));
}

describe("local source — host failures during archive staging", () => {
  test("an exception thrown mid-extraction propagates and leaves no scratch behind", () => {
    const root = tmp();
    const scratchParent = tmp();
    writeRawZip(path.join(root, "Case.zip"), [{ name: "docs/a.md", content: "# A\n" }]);
    const before = treeSnapshot(root);
    // The omit matcher is consulted for every member while it is being staged, so
    // a matcher that fails there stands in for any host failure at that point.
    const failing: OmitMatcher = {
      patterns: [],
      shouldOmit: (relativePath: string) => {
        if (relativePath.includes("!/")) throw new Error("simulated host failure while staging a member");
        return false;
      },
    };
    expect(() => acquireLocalSource({ path: root, scratchParent, omit: failing }))
      .toThrow(/simulated host failure/);
    expect(fs.readdirSync(scratchParent)).toEqual([]);
    expect(treeSnapshot(root)).toEqual(before);
  });
});
