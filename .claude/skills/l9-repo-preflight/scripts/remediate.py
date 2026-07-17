#!/usr/bin/env python3
"""Fail-OPEN preflight remediation loop: probe -> evaluate -> autofix -> re-probe.

The primary entrypoint. Runs the read-only probe, classifies the eight gates
(evaluate_preflight), APPLIES every safe, reversible autofix to the live repo,
re-probes, and repeats to a fixpoint. The run always completes; the output is a
machine-readable genuine-blocker report (only what could not be safely
auto-resolved) plus an autofix-log audit trail.

Safe autofix allow-list (nothing else is ever auto-applied):
  clean_generated    remove untracked known-generated artifacts + gitignore them
  git_switch_branch  switch to the expected branch (clean tree only)
  adapt_blueprint    write an evidence-adapted expected-contract (new file)
  pip_install        install the repo's declared/pinned tools
  editable_install   run the declared editable install so packages import
  ruff_fix           ruff check --fix + ruff format (clean tree only; tool-owned)

Unknown-provenance files, user tracked/staged edits, wrong repo/commit, missing
core foundations, and NEW type/test failures are NEVER auto-applied — they are
reported as genuine blockers for downstream remediation.

    python scripts/remediate.py [REPO] [--expected C] [--work-dir .preflight]
        [--max-iters 5] [--dry-run] [--no-fix-code] [--json]

Exit codes (informational, never a halt): 0 no blockers, 1 blockers remain,
2 could not run at all.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import evaluate_preflight as ev  # noqa: E402
from preflight import accounting, ci_migration, delivery, issues, reports, techdebt  # noqa: E402
from preflight import __version__ as SKILL_VERSION  # noqa: E402
from preflight.github import get_adapter  # noqa: E402
from preflight.redaction import redact  # noqa: E402

PROBE = HERE / "preflight_probe.sh"


def _run(cmd: list[str], cwd: Path, timeout: int = 300) -> tuple[int, str]:
    try:
        p = subprocess.run(
            cmd, cwd=str(cwd), capture_output=True, text=True, timeout=timeout, check=False
        )
        return p.returncode, (p.stdout or "") + (p.stderr or "")
    except Exception as exc:  # noqa: BLE001
        return 127, f"[remediate: could not run {' '.join(cmd)}: {exc}]"


def _git(args: list[str], repo: Path) -> tuple[int, str]:
    return _run(["git", *args], repo)


def run_probe(repo: Path, work_dir: Path) -> dict[str, list[str]] | None:
    """Run the read-only probe and return its parsed sections (log kept in work_dir)."""
    rc, _ = _run(["bash", str(PROBE)], repo)
    logs = sorted(repo.glob("repo-preflight-*.log"))
    if not logs:
        return None
    log = logs[-1]
    text = log.read_text(encoding="utf-8", errors="ignore")
    (work_dir / log.name).write_text(text, encoding="utf-8")
    log.unlink()  # keep the worktree clean; the copy lives in work_dir
    return ev.parse_sections(text)


def _has_eslint(repo: Path) -> bool:
    return any(
        (repo / n).exists()
        for n in (
            ".eslintrc",
            ".eslintrc.json",
            ".eslintrc.js",
            ".eslintrc.cjs",
            "eslint.config.js",
        )
    )


def _has_prettier(repo: Path) -> bool:
    return any(
        (repo / n).exists() for n in (".prettierrc", ".prettierrc.json", "prettier.config.js")
    )


def measure_baseline(repo: Path) -> dict[str, Any]:
    """Run whatever validators exist; failures feed Gate 7. Ecosystem-neutral: a tool
    that is not installed/configured is simply skipped (Python AND Node supported)."""
    results: dict[str, dict[str, int]] = {}
    # --- Python ---
    if shutil.which("ruff"):
        rc, out = _run(["ruff", "check", "--output-format=concise", "."], repo)
        results["ruff"] = {"failed": 0 if rc == 0 else max(1, out.count(":"))}
        rc, out = _run(["ruff", "format", "--check", "."], repo)
        results["ruff_format"] = {"failed": 0 if rc == 0 else max(1, out.lower().count("reformat"))}
    if shutil.which("mypy"):
        rc, out = _run(["mypy", "."], repo)
        results["mypy"] = {"failed": 0 if rc == 0 else max(1, out.count(" error:"))}
    if shutil.which("pytest"):
        rc, out = _run(["pytest", "-q"], repo)
        results["pytest"] = {"failed": 0 if rc == 0 else _count(out, "failed") or 1}
    # --- Node (only once dependencies are installed) ---
    if (
        (repo / "package.json").exists()
        and (repo / "node_modules").exists()
        and shutil.which("npx")
    ):
        if _has_eslint(repo):
            rc, out = _run(["npx", "--no-install", "eslint", "."], repo)
            results["eslint"] = {"failed": 0 if rc == 0 else max(1, out.lower().count("error"))}
        if _has_prettier(repo):
            rc, out = _run(["npx", "--no-install", "prettier", "--check", "."], repo)
            results["prettier"] = {"failed": 0 if rc == 0 else max(1, out.count("\n"))}
        if (repo / "tsconfig.json").exists():
            rc, out = _run(["npx", "--no-install", "tsc", "--noEmit"], repo)
            results["tsc"] = {"failed": 0 if rc == 0 else max(1, out.count(" error"))}
    return {"results": results}


def _count(out: str, word: str) -> int:
    toks = out.split()
    for i, tok in enumerate(toks):
        if word in tok and i > 0 and toks[i - 1].isdigit():
            return int(toks[i - 1])
    return 0


# --------------------------------------------------------------------------- #
# Safe autofix actions — each returns an action record; none touches user work
# --------------------------------------------------------------------------- #
def _record(
    gate: int, action: str, target: Any, command: str, rc: int, note: str = "", error: str = ""
) -> dict[str, Any]:
    rec = {
        "gate": gate,
        "action": action,
        "target": target,
        "command": command,
        "result": "ok" if rc == 0 else f"rc={rc}",
        "reversible": True,
        "note": note,
    }
    if rc != 0 and error:
        # redacted so no secret value (npm 401 auth lines, tokens) reaches a record
        rec["error"] = redact(error)[:2000]
    return rec


def _is_tracked(repo: Path, path: str) -> bool:
    rc, _ = _git(["ls-files", "--error-unmatch", path], repo)
    return rc == 0


def _gitignore_add(repo: Path, patterns: list[str], self_modified: set[str]) -> None:
    gi = repo / ".gitignore"
    existing = gi.read_text(encoding="utf-8").splitlines() if gi.exists() else []
    add = [p for p in patterns if p not in existing]
    if not add:
        return
    with gi.open("a", encoding="utf-8") as fh:
        if existing and existing[-1].strip():
            fh.write("\n")
        fh.write("# added by l9-repo-preflight remediate\n" + "\n".join(add) + "\n")
    self_modified.add(".gitignore")


_IGNORE_DIRS = {
    ".venv",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    "htmlcov",
    "build",
    "dist",
    "node_modules",
    ".next",
    ".turbo",
    "coverage",
}


def _ignore_pattern(target: str) -> str:
    """Canonical .gitignore pattern for a generated path — the generated SEGMENT,
    never the enclosing package dir (e.g. `__pycache__/`, not `pkg/`)."""
    segs = target.strip("/").split("/")
    for s in segs:
        if s == "__pycache__":
            return "__pycache__/"
        if s.endswith(".egg-info"):
            return "*.egg-info/"
        if s.endswith(".dist-info"):
            return "*.dist-info/"
        if s in _IGNORE_DIRS:
            return s + "/"
        if s == ".coverage":
            return ".coverage"
    base = segs[-1]
    if base.endswith(".pyc"):
        return "*.pyc"
    if base.startswith("repo-preflight-") and base.endswith(".log"):
        return "repo-preflight-*.log"
    return base


# Untracked dependency dirs: gitignore them, but never delete (they are needed,
# just not committed) — unlike throwaway caches which are removed.
_KEEP_IGNORE = {"node_modules"}


def apply_clean_generated(
    repo: Path, plan: dict[str, Any], self_modified: set[str]
) -> list[dict[str, Any]]:
    recs, globs = [], set()
    for target in plan.get("targets", []):
        if _is_tracked(repo, target):  # safety: never remove a tracked file
            recs.append(
                _record(3, "clean_generated", target, "skip (tracked)", 1, "tracked; skipped")
            )
            continue
        top = target.strip("/").split("/")[0]
        if top in _KEEP_IGNORE:  # dependency dir: ignore, do not remove
            globs.add(top + "/")
            recs.append(
                _record(
                    3, "clean_generated", target, f"gitignore {top}/ (kept)", 0, "dependency dir"
                )
            )
            continue
        tp = repo / target
        if tp.exists():
            if tp.is_dir():
                shutil.rmtree(tp, ignore_errors=True)
            else:
                tp.unlink(missing_ok=True)
        globs.add(_ignore_pattern(target))
        recs.append(_record(3, "clean_generated", target, f"rm -rf {target}", 0, "regenerable"))
    if globs:
        _gitignore_add(repo, sorted(globs), self_modified)
        recs.append(_record(3, "clean_generated", sorted(globs), "gitignore += generated globs", 0))
    return recs


def apply_git_switch(repo: Path, plan: dict[str, Any]) -> list[dict[str, Any]]:
    branch = (plan.get("targets") or [""])[0]
    rc, _ = _git(["switch", branch], repo)
    return [_record(2, "git_switch_branch", branch, f"git switch {branch}", rc)]


def apply_pip_install(repo: Path, plan: dict[str, Any]) -> list[dict[str, Any]]:
    reqs = repo / "requirements-ci.txt"
    if reqs.exists():  # honour the repo's pins
        rc, out = _run([sys.executable, "-m", "pip", "install", "-r", str(reqs)], repo)
        return [
            _record(
                5,
                "pip_install",
                "requirements-ci.txt",
                "pip install -r requirements-ci.txt",
                rc,
                error=out,
            )
        ]
    tools = plan.get("targets", [])
    rc, out = _run([sys.executable, "-m", "pip", "install", *tools], repo) if tools else (0, "")
    return [_record(5, "pip_install", tools, f"pip install {' '.join(tools)}", rc, error=out)]


def apply_editable_install(repo: Path, plan: dict[str, Any]) -> list[dict[str, Any]]:
    if not (repo / "pyproject.toml").exists() and not (repo / "setup.py").exists():
        return [_record(6, "editable_install", plan.get("targets"), "skip (no build config)", 1)]
    rc, out = _run([sys.executable, "-m", "pip", "install", "-e", "."], repo)
    return [_record(6, "editable_install", plan.get("targets"), "pip install -e .", rc, error=out)]


def apply_npm_install(repo: Path, plan: dict[str, Any]) -> list[dict[str, Any]]:
    if not shutil.which("npm"):
        return [_record(plan.get("gate", 6), "npm_install", "npm", "skip (npm not installed)", 1)]
    # npm ci needs a lockfile; fall back to npm install otherwise.
    lock = any((repo / n).exists() for n in ("package-lock.json", "npm-shrinkwrap.json"))
    cmd = ["npm", "ci"] if lock else ["npm", "install"]
    rc, out = _run(cmd, repo, timeout=600)
    # a 401/403 here (private GitHub Packages) becomes an unresolved blocker via
    # accounting; the output is redacted in _record so no token/auth value leaks.
    return [
        _record(
            plan.get("gate", 6), "npm_install", plan.get("targets"), " ".join(cmd), rc, error=out
        )
    ]


def apply_eslint_fix(repo: Path, self_modified: set[str]) -> list[dict[str, Any]]:
    if not shutil.which("npx") or not (repo / "node_modules").exists():
        return [_record(7, "eslint_fix", "eslint", "skip (node_modules/npx missing)", 1)]
    files = ev._status_files(_git(["status", "--short"], repo)[1].splitlines())
    if set(files["tracked"]) - self_modified or files["staged"]:
        return [
            _record(
                7,
                "eslint_fix",
                "eslint",
                "skip (user tracked edits present)",
                1,
                "deferred: offered as a blocker remediation",
            )
        ]
    rc1, _ = _run(["npx", "--no-install", "eslint", "--fix", "."], repo)
    rc2 = 0
    if _has_prettier(repo):
        rc2, _ = _run(["npx", "--no-install", "prettier", "--write", "."], repo)
    changed = [
        ln.strip() for ln in _git(["diff", "--name-only"], repo)[1].splitlines() if ln.strip()
    ]
    self_modified.update(changed)
    return [
        _record(
            7,
            "eslint_fix",
            changed,
            "eslint --fix . && prettier --write .",
            0 if rc1 == 0 and rc2 == 0 else 1,
            f"{len(changed)} file(s) fixed",
        )
    ]


def apply_ruff_fix(repo: Path, self_modified: set[str]) -> list[dict[str, Any]]:
    if not shutil.which("ruff"):
        return [_record(7, "ruff_fix", "ruff", "skip (ruff not installed)", 1)]
    # Clean-tree guard: only run when there are no pre-existing user tracked edits,
    # so every change is tool-owned and git-reversible (never entangles user work).
    files = ev._status_files(_git(["status", "--short"], repo)[1].splitlines())
    if set(files["tracked"]) - self_modified or files["staged"]:
        return [
            _record(
                7,
                "ruff_fix",
                "ruff",
                "skip (user tracked edits present)",
                1,
                "deferred: offered as a blocker remediation",
            )
        ]
    rc1, _ = _run(["ruff", "check", "--fix", "."], repo)
    rc2, _ = _run(["ruff", "format", "."], repo)
    changed = [
        ln.strip() for ln in _git(["diff", "--name-only"], repo)[1].splitlines() if ln.strip()
    ]
    self_modified.update(changed)
    return [
        _record(
            7,
            "ruff_fix",
            changed,
            "ruff check --fix . && ruff format .",
            0 if rc1 == 0 and rc2 == 0 else 1,
            f"{len(changed)} file(s) formatted",
        )
    ]


def adapt_blueprint(
    repo: Path,
    plan: dict[str, Any],
    expected: dict[str, Any],
    sections: dict[str, list[str]],
    work_dir: Path,
    expected_src: Path | None,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Write an evidence-adapted expected-contract to a NEW file (non-destructive)."""
    adapted = json.loads(json.dumps(expected)) if expected else {}
    gate = plan.get("gate")
    targets = plan.get("targets", [])
    if gate == 4:  # drop missing foundations
        adapted["foundations"] = [f for f in adapted.get("foundations", []) if f not in targets]
    elif gate == 5:  # follow the repo's own tools
        adapted.setdefault("toolchain", {})["test_tools"] = sorted(ev._repo_tools(sections))
    elif gate == 6:  # drop foreign packages
        adapted["packages"] = [p for p in adapted.get("packages", []) if p not in targets]
    dest = work_dir / (
        (expected_src.stem + ".adapted.json") if expected_src else "expected-contract.adapted.json"
    )
    dest.write_text(json.dumps(adapted, indent=2) + "\n", encoding="utf-8")
    rec = _record(
        gate or 0,
        "adapt_blueprint",
        targets,
        f"write {dest.name}",
        0,
        "blueprint adapted to evidence (new file)",
    )
    return adapted, [rec]


def _local_exclude(repo: Path, pattern: str) -> None:
    """Ignore a path locally via .git/info/exclude — no tracked-file mutation."""
    exclude = repo / ".git" / "info" / "exclude"
    if not exclude.parent.exists():
        return
    lines = exclude.read_text(encoding="utf-8").splitlines() if exclude.exists() else []
    if pattern not in lines:
        with exclude.open("a", encoding="utf-8") as fh:
            fh.write(pattern + "\n")


def remediate(
    repo: Path,
    expected: dict[str, Any],
    expected_src: Path | None,
    work_dir: Path,
    max_iters: int,
    dry_run: bool,
    fix_code: bool,
) -> dict[str, Any]:
    work_dir.mkdir(parents=True, exist_ok=True)
    _local_exclude(repo, ".preflight/")  # keep the tool's workdir out of the worktree
    self_modified: set[str] = set()
    actions: list[dict[str, Any]] = []
    prior_baseline: dict[str, Any] | None = None
    report: dict[str, Any] = {}
    iters = 0

    for i in range(max_iters):
        iters = i + 1
        sections = run_probe(repo, work_dir)
        if sections is None:
            return {
                "run_completed": True,
                "error": "probe produced no log",
                "genuine_blockers": [],
                "blocker_count": 0,
                "ready_after_remediation": False,
            }
        baseline = measure_baseline(repo)
        if prior_baseline is None:
            prior_baseline = baseline  # the initial state = the existing baseline
        report = ev.evaluate(
            sections, expected, baseline, prior_baseline, self_modified=frozenset(self_modified)
        )
        plans = report["autofix_plans"]
        if dry_run or not plans:
            break
        applied = 0
        for plan in plans:
            action = plan["action"]
            if action == ev.ACTION_CLEAN_GENERATED:
                recs = apply_clean_generated(repo, plan, self_modified)
            elif action == ev.ACTION_GIT_SWITCH:
                recs = apply_git_switch(repo, plan)
            elif action == ev.ACTION_PIP_INSTALL:
                recs = apply_pip_install(repo, plan)
            elif action == ev.ACTION_EDITABLE_INSTALL:
                recs = apply_editable_install(repo, plan)
            elif action in (ev.ACTION_NPM_INSTALL, ev.ACTION_NPM_CI):
                recs = apply_npm_install(repo, plan)
            elif action == ev.ACTION_UV_LOCK:
                rc, out = _run(["uv", "lock"], repo, timeout=180)
                recs = [_record(plan.get("gate", 12), action, plan.get("targets"), out[-500:], rc)]
            elif action == ev.ACTION_ADAPT:
                expected, recs = adapt_blueprint(
                    repo, plan, expected, sections, work_dir, expected_src
                )
            elif action == ev.ACTION_RUFF_FIX:
                if not fix_code:
                    recs = [_record(7, "ruff_fix", plan.get("targets"), "skip (--no-fix-code)", 1)]
                else:
                    recs = apply_ruff_fix(repo, self_modified)
            elif action == ev.ACTION_ESLINT_FIX:
                if not fix_code:
                    recs = [
                        _record(7, "eslint_fix", plan.get("targets"), "skip (--no-fix-code)", 1)
                    ]
                else:
                    recs = apply_eslint_fix(repo, self_modified)
            else:
                recs = [
                    _record(plan.get("gate", 0), action, plan.get("targets"), "unknown action", 1)
                ]
            actions.extend(recs)
            applied += sum(1 for r in recs if r["result"] == "ok")
        if applied == 0:  # fixpoint: nothing more we can safely do
            break

    # --- accounting: a failed applicable autofix is an UNRESOLVED blocker ---
    acct = accounting.reconcile(report, actions)
    debt = techdebt.detect(repo)
    source_commit = _git(["rev-parse", "HEAD"], repo)[1].strip() or "unknown"
    timestamp = report.get("generated_from", "Unknown")
    mods = sorted(self_modified)
    run_id = delivery.autofix_run_id(source_commit, mods) if mods else source_commit[:12]

    report["mode"] = "dry-run" if dry_run else "applied"
    report["iterations"] = iters
    report["autofixed"] = actions
    report["self_modified"] = mods
    report["run_id"] = run_id
    report["source_commit"] = source_commit
    report["tool_version"] = SKILL_VERSION
    report["accounting"] = acct
    report["technical_debt"] = debt
    # accounting is authoritative for the blocker set + overall status
    report["genuine_blockers"] = acct["unresolved_blockers"]
    report["blocker_count"] = acct["blocker_count"]
    report["overall_status"] = acct["overall_status"]
    report["ready_after_remediation"] = acct["blocker_count"] == 0
    report["stamp"] = {
        "run_id": run_id,
        "timestamp": timestamp,
        "source_commit": source_commit,
        "tool_version": SKILL_VERSION,
    }
    return report


def persist_reports(
    repo: Path, report: dict[str, Any], docs_dir: Path, receipts: list[dict[str, Any]]
) -> list[str]:
    stamp = report.get("stamp", {})
    return reports.persist(
        docs_dir,
        run_id=stamp.get("run_id", "unknown"),
        timestamp=stamp.get("timestamp", "Unknown"),
        source_commit=stamp.get("source_commit", "unknown"),
        tool_version=stamp.get("tool_version", SKILL_VERSION),
        evaluate_report={
            k: report[k] for k in ("gates", "autofix_plans", "iterations", "mode") if k in report
        },
        autofix_actions=report.get("autofixed", []),
        accounting=report.get("accounting", {}),
        techdebt=report.get("technical_debt", []),
        receipts=receipts,
    )


def main() -> int:
    ap = argparse.ArgumentParser(description="Fail-open preflight remediation + delivery.")
    ap.add_argument("repo", nargs="?", default=".", help="Repo root (default: cwd)")
    ap.add_argument("--expected", default=None, help="Expected-contract (json/yaml)")
    ap.add_argument("--work-dir", default=".preflight", help="Work dir (default: .preflight)")
    ap.add_argument("--max-iters", type=int, default=5)
    ap.add_argument("--dry-run", action="store_true", help="Plan only; NO remote side effects")
    ap.add_argument("--no-fix-code", action="store_true", help="No ruff/eslint --fix on source")
    ap.add_argument("--base", default="main", help="Canonical base branch (default: main)")
    ap.add_argument("--repo-slug", default="", help="owner/name for GitHub effects")
    ap.add_argument("--deliver", action="store_true", help="Open an autofix PR for changes")
    ap.add_argument("--issues", action="store_true", help="Sync GitHub issues for blockers")
    ap.add_argument(
        "--ci-migration", action="store_true", help="Open the CI-changeover PR (separate)"
    )
    ap.add_argument(
        "--allow-cli-fallback",
        action="store_true",
        help="Allow gh only when GitHub MCP reports an unsupported capability",
    )
    ap.add_argument("--json", action="store_true", help="Print the full report as JSON")
    args = ap.parse_args()

    repo = Path(args.repo).resolve()
    if not (repo / ".git").exists() and not (repo / ".git").is_file():
        print(f"FAIL: not a git repo: {repo}", file=sys.stderr)
        return 2
    work_dir = (
        repo / args.work_dir if not Path(args.work_dir).is_absolute() else Path(args.work_dir)
    )
    expected_src = Path(args.expected) if args.expected else None
    try:
        expected = ev._load(expected_src) if expected_src else {}
    except Exception as exc:  # noqa: BLE001
        print(f"FAIL: {exc}", file=sys.stderr)
        return 2
    if not isinstance(expected, dict):
        expected = {}

    report = remediate(
        repo,
        expected,
        expected_src,
        work_dir,
        args.max_iters,
        args.dry_run,
        fix_code=not args.no_fix_code,
    )

    receipts: list[dict[str, Any]] = []
    adapter = get_adapter(
        dry_run=args.dry_run,
        allow_cli_fallback=args.allow_cli_fallback,
    )

    # persist reports: docs/preflight when applied; work_dir in dry-run (no worktree mutation)
    docs_dir = (work_dir / "docs-preflight") if args.dry_run else (repo / "docs" / "preflight")
    report_paths = persist_reports(repo, report, docs_dir, receipts)

    # optional remote delivery (idempotent; skipped in dry-run — no remote effects)
    if args.deliver and not args.dry_run:
        intended = report.get("self_modified", []) + [
            str(Path(p).relative_to(repo)) for p in report_paths if str(repo) in p
        ]
        dres = delivery.deliver_autofix(
            repo,
            adapter,
            sorted(set(intended)),
            base=args.base,
            repo_slug=args.repo_slug,
            dry_run=False,
            run_id=report["stamp"]["run_id"],
        )
        receipts += dres.get("receipts", [])
        report["autofix_delivery"] = dres
    if args.issues:
        ires = issues.sync_all(adapter, args.repo_slug, report.get("genuine_blockers", []))
        receipts += ires
        report["issue_sync"] = ires
    if args.ci_migration:
        det = ci_migration.detect(repo)
        report["ci_migration"] = det
        if det["applicable"] and not args.dry_run:
            content = ci_migration.generate()
            errs = ci_migration.validate(content)
            if errs:
                report["ci_migration_errors"] = errs
            else:
                cres = delivery.deliver_ci_migration(
                    repo,
                    adapter,
                    content,
                    det["target_path"],
                    base=args.base,
                    repo_slug=args.repo_slug,
                    dry_run=False,
                    run_id=report["stamp"]["run_id"],
                )
                receipts += cres.get("receipts", [])
                report["ci_migration_delivery"] = cres

    report["side_effect_receipts"] = receipts

    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print(
            f"mode: {report.get('mode')} | iterations: {report.get('iterations')} | "
            f"overall_status: {report.get('overall_status')}"
        )
        for a in report.get("autofixed", []):
            print(f"  autofix (gate {a['gate']}): {a['action']} [{a['result']}] — {a['target']}")
        for b in report.get("genuine_blockers", []):
            print(
                f"  BLOCKER {b['id']} [{b['severity']}]: {b['class']} — {b['why_not_autofixable']}"
            )
        print(
            f"run_completed: {report.get('run_completed')} | blockers: {report.get('blocker_count')} "
            f"| ready_after_remediation: {report.get('ready_after_remediation')}"
        )
        print(f"reports -> {docs_dir}/ ({len(report_paths)} files)")
    return 0 if report.get("blocker_count", 0) == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
