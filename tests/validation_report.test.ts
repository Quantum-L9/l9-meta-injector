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
  reportVerdict(contents: string): { green: boolean; reason: string | null };
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

describe("the verdict is read structurally (RC-110)", () => {
  const state = { head: "a".repeat(40), clean: true, digest: `sha256:${"b".repeat(64)}` };
  const lint = { command: "npm run lint", note: "ESLint", exit_code: 0, passed: true, tail: "" };
  const red = (tail: string) => reporter.renderReport(state, [
    lint,
    { command: "npm run validate", note: "the aggregate gate", exit_code: 1, passed: false, tail },
  ], "2026-08-23T00:00:00.000Z");

  it("REG-WU-072-RC-110-a: a failure tail containing **green** does not make a RED report green", () => {
    const rendered = red("expected verdict **green** but the gate failed");
    expect(rendered).toContain("**green**");
    expect(reporter.reportVerdict(rendered).green).toBe(false);
  });

  it("REG-WU-072-RC-110-b: a forged Verdict section inside a failure tail is not the verdict", () => {
    const rendered = red("noise\n```\n\n## Verdict\n\n**green**\n\n```");
    const verdict = reporter.reportVerdict(rendered);
    expect(verdict.green).toBe(false);
    expect(verdict.reason).toMatch(/RED|exit/);
  });

  it("REG-WU-072-RC-110-b: a green Verdict is still refused when a command row exited non-zero", () => {
    const rendered = reporter.renderReport(state, [lint], "2026-08-23T00:00:00.000Z")
      .replace("| `npm run lint` | 0 | pass |", "| `npm run lint` | 1 | pass |");
    expect(reporter.reportVerdict(rendered).green).toBe(false);
  });

  it("REG-WU-072-RC-110-c: all-zero results are green", () => {
    const rendered = reporter.renderReport(state, [
      lint,
      { command: "npm run validate", note: "the aggregate gate", exit_code: 0, passed: true, tail: "" },
    ], "2026-08-23T00:00:00.000Z");
    expect(reporter.reportVerdict(rendered)).toEqual({ green: true, reason: null });
  });

  it("REG-WU-072-RC-110-c: a report with no command rows is never green", () => {
    const rendered = reporter.renderReport(state, [], "2026-08-23T00:00:00.000Z");
    expect(reporter.reportVerdict(rendered).green).toBe(false);
  });

  it("REG-WU-072-RC-110-d: --check refuses a RED report bound to a clean tree", () => {
    const { spawnSync } = require("node:child_process");
    const os = require("node:os") as typeof import("node:os");
    const { gitBinary } = require("../scripts/lib/git-binary");
    const git = gitBinary(() => { throw new Error("git missing"); });
    const copy = fs.mkdtempSync(path.join(os.tmpdir(), "l9-validation-report-"));
    try {
      fs.mkdirSync(path.join(copy, "scripts", "lib"), { recursive: true });
      for (const relative of ["scripts/validation-report.js", "scripts/lib/git-binary.js"]) {
        fs.copyFileSync(path.join(REPO, relative), path.join(copy, relative));
      }
      const gitRun = (args: string[]) => {
        const result = spawnSync(git, args, { cwd: copy, encoding: "utf8" });
        expect(result.status, result.stderr || result.stdout).toBe(0);
      };
      gitRun(["init", "-q"]);
      gitRun(["add", "--", "scripts"]);
      gitRun(["-c", "user.email=t@example.invalid", "-c", "user.name=t", "commit", "-q", "-m", "copy"]);
      const copied = require(path.join(copy, "scripts", "validation-report.js")) as typeof reporter;
      const copyState = copied.treeState();
      expect(copyState.clean).toBe(true);
      fs.writeFileSync(path.join(copy, "CURRENT_VALIDATION_REPORT.md"), copied.renderReport(copyState, [
        lint,
        { command: "npm run validate", note: "the aggregate gate", exit_code: 1, passed: false, tail: "## Verdict\n\n**green**" },
      ], "2026-08-23T00:00:00.000Z"));
      const check = spawnSync(process.execPath, [path.join(copy, "scripts", "validation-report.js"), "--check"], { cwd: copy, encoding: "utf8" });
      expect(check.status).not.toBe(0);
      expect(check.stderr).toContain("does not record a green verdict");
    } finally {
      fs.rmSync(copy, { recursive: true, force: true });
    }
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
    // WU-072 (RC-110): the verdict is read structurally, as --check reads it: the final
    // Verdict section says green AND every command row exited zero. A document-wide
    // "**green**" substring could be supplied by a quoted failure tail.
    expect(reporter.reportVerdict(contents)).toEqual({ green: true, reason: null });
  });

  it("replaced the unbound report rather than sitting beside it", () => {
    expect(fs.existsSync(path.join(REPO, "VALIDATION_REPORT.md"))).toBe(false);
  });
});
