// validation_report.test.ts — a validation report that cannot outlive its tree.
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const REPO = path.resolve(__dirname, "..");
const REPORT = path.join(REPO, "CURRENT_VALIDATION_REPORT.md");

const reporter = require("../scripts/validation-report.js") as {
  treeState(): { head: string; clean: boolean; digest: string };
  renderReport(
    state: { head: string; clean: boolean; digest: string },
    results: {
      command: string; note: string; exit_code: number; passed: boolean; tail: string;
    }[],
    generatedAt: string,
  ): string;
};

describe("the tree the report is bound to", () => {
  it("is a deterministic digest of tree content, not a commit id", () => {
    const state = reporter.treeState();
    expect(state.head).toMatch(/^[0-9a-f]{40}$/);
    expect(state.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(reporter.treeState().digest).toBe(state.digest);
  });

  it("does not move when the report itself changes", () => {
    const before = reporter.treeState().digest;
    const existed = fs.existsSync(REPORT);
    const original = existed ? fs.readFileSync(REPORT, "utf8") : null;
    try {
      fs.writeFileSync(REPORT, "# rewritten by a test\n", "utf8");
      expect(reporter.treeState().digest).toBe(before);
    } finally {
      if (original === null) fs.rmSync(REPORT, { force: true });
      else fs.writeFileSync(REPORT, original, "utf8");
    }
  });

  it("moves when an untracked file appears", () => {
    const before = reporter.treeState().digest;
    const probe = path.join(REPO, "src", ".validation-report-probe.ts");
    try {
      fs.writeFileSync(probe, "export const probe = 1;\n", "utf8");
      expect(reporter.treeState().digest).not.toBe(before);
    } finally {
      fs.rmSync(probe, { force: true });
    }
    expect(reporter.treeState().digest).toBe(before);
  });

  it("does not move when tracked status changes without bytes changing", () => {
    const { spawnSync } = require("node:child_process");
    const { gitBinary } = require("../scripts/lib/git-binary");
    const git = gitBinary(() => {});
    const before = reporter.treeState().digest;
    const probe = path.join(REPO, "src", ".validation-report-probe.ts");
    try {
      fs.writeFileSync(probe, "export const probe = 3;\n", "utf8");
      const untracked = reporter.treeState().digest;
      expect(untracked).not.toBe(before);
      const add = spawnSync(git, ["add", "--", "src/.validation-report-probe.ts"], {
        cwd: REPO,
        encoding: "utf8",
      });
      expect(add.status, add.stderr || add.stdout).toBe(0);
      expect(reporter.treeState().digest).toBe(untracked);
      const unstage = spawnSync(
        git,
        ["rm", "--cached", "--quiet", "--", "src/.validation-report-probe.ts"],
        { cwd: REPO, encoding: "utf8" },
      );
      expect(unstage.status, unstage.stderr || unstage.stdout).toBe(0);
    } finally {
      fs.rmSync(probe, { force: true });
    }
    expect(reporter.treeState().digest).toBe(before);
  });

  it("moves on a second edit of an already-dirty file", () => {
    const before = reporter.treeState().digest;
    const probe = path.join(REPO, "src", ".validation-report-probe.ts");
    try {
      fs.writeFileSync(probe, "export const probe = 1;\n", "utf8");
      const first = reporter.treeState().digest;
      expect(first).not.toBe(before);
      fs.writeFileSync(probe, "export const probe = 2;\n", "utf8");
      expect(reporter.treeState().digest).not.toBe(first);
    } finally {
      fs.rmSync(probe, { force: true });
    }
    expect(reporter.treeState().digest).toBe(before);
  });

  it("binds a filename containing a newline without Git display quoting", () => {
    const before = reporter.treeState().digest;
    const probe = path.join(REPO, "src", ".validation\nreport-probe.ts");
    try {
      fs.writeFileSync(probe, "export const probe = 1;\n", "utf8");
      const first = reporter.treeState().digest;
      expect(first).not.toBe(before);
      fs.writeFileSync(probe, "export const probe = 2;\n", "utf8");
      expect(reporter.treeState().digest).not.toBe(first);
    } finally {
      fs.rmSync(probe, { force: true });
    }
    expect(reporter.treeState().digest).toBe(before);
  });

  it.skipIf(process.platform === "win32")("moves when an executable bit changes", () => {
    const before = reporter.treeState().digest;
    const probe = path.join(REPO, "src", ".validation-mode-probe.sh");
    try {
      fs.writeFileSync(probe, "#!/bin/sh\nexit 0\n", { encoding: "utf8", mode: 0o644 });
      const nonExecutable = reporter.treeState().digest;
      expect(nonExecutable).not.toBe(before);
      fs.chmodSync(probe, 0o755);
      expect(reporter.treeState().digest).not.toBe(nonExecutable);
    } finally {
      fs.rmSync(probe, { force: true });
    }
    expect(reporter.treeState().digest).toBe(before);
  });
});

describe("what the report says", () => {
  const state = { head: "a".repeat(40), clean: true, digest: `sha256:${"b".repeat(64)}` };

  it("records a failure as a failure, with the output that caused it", () => {
    const rendered = reporter.renderReport(state, [
      { command: "npm run lint", note: "ESLint", exit_code: 0, passed: true, tail: "" },
      {
        command: "npm run validate",
        note: "the aggregate gate",
        exit_code: 1,
        passed: false,
        tail: "Tests  3 failed | 1180 passed",
      },
    ], "2026-08-23T00:00:00.000Z");

    expect(rendered).toContain("**RED**");
    expect(rendered).toContain("**FAIL**");
    expect(rendered).toContain("3 failed | 1180 passed");
    expect(rendered).toContain("this tree is not green");
    expect(rendered).not.toContain("**green**");
  });

  it("says green only when every exit code was zero", () => {
    const rendered = reporter.renderReport(state, [
      { command: "npm run lint", note: "ESLint", exit_code: 0, passed: true, tail: "" },
      { command: "npm run validate", note: "the aggregate gate", exit_code: 0, passed: true, tail: "" },
    ], "2026-08-23T00:00:00.000Z");

    expect(rendered).toContain("**green**");
    expect(rendered).not.toContain("**FAIL**");
    expect(rendered).toContain(`\`${state.head}\``);
    expect(rendered).toContain(`\`${state.digest}\``);
    expect(rendered).toContain("not a publication authorization");
    expect(rendered).toContain("not a statement about any other tree");
  });
});

const generating = process.env.L9_VALIDATION_REPORT_RUN === "1";

describe.skipIf(generating)("the report in this repository", () => {
  it("exists, is bound to this tree, and records a green verdict", () => {
    expect(fs.existsSync(REPORT), "CURRENT_VALIDATION_REPORT.md is missing").toBe(true);
    const contents = fs.readFileSync(REPORT, "utf8");
    const digest = /\*\*Bound to tree:\*\* `(sha256:[0-9a-f]{64})`/.exec(contents);
    expect(digest, "the report does not name a tree digest").not.toBeNull();
    const state = reporter.treeState();
    expect(state.clean, "the report cannot validate a dirty non-report tree").toBe(true);
    expect(digest?.[1], "the report describes a different tree; re-run npm run validate:report")
      .toBe(state.digest);
    expect(contents).toContain("**green**");
  });

  it("replaced the unbound report rather than sitting beside it", () => {
    expect(fs.existsSync(path.join(REPO, "VALIDATION_REPORT.md"))).toBe(false);
  });
});
