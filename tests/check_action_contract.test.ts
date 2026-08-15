import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, test } from "vitest";

const action = fs.readFileSync(path.resolve(__dirname, "..", "action.yml"), "utf8");

describe("composite Action check contract", () => {
  test("routes check through the exhaustive operation dispatcher", () => {
    expect(action).toContain("L9_INPUT_MODE: ${{ inputs.mode }}");
    expect(action).toContain("run: node scripts/operation-cli.js --action-env");
  });

  test("uses RUNNER_TEMP through an environment boundary", () => {
    expect(action).toContain("RUNNER_TEMP: ${{ runner.temp }}");
    expect(action).toContain("artifact_path");
  });

  test("has no mode fallback branch in shell", () => {
    expect(action).not.toContain("elif [");
    expect(action).not.toContain("else\n          DRY_RUN");
  });
});
