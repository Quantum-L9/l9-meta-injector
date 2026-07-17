#!/usr/bin/env python3
"""Classify fourteen structural and semantic preflight gates — fail-OPEN.

Deterministic and non-halting: parse the probe log (+ an optional expected
contract and an optional baseline record) and emit, for every gate, a verdict and
— when the gate is fixable — the exact safe autofix plan. Nothing here stops the
run; the caller (remediate.py) applies the safe autofixes and re-probes. What
remains after the loop reaches a fixpoint is the genuine-blocker set.

Verdict vocabulary (nothing halts):
  clear       gate is satisfied
  autofixable a safe, reversible fix resolves it -> autofix_plan carries the action
  adapt       the blueprint is wrong for this repo -> non-destructive contract adapt
  blocker     cannot be safely auto-resolved -> reported in detail for downstream

Doctrine (matches references/preflight-pipeline.md):
  - the run always completes and always emits a report (fail-open).
  - verified evidence outranks the blueprint; a foreign expectation the repo does
    not meet is `adapt` (fix the plan), never a repo failure.
  - autofix is a fixed safe+reversible allow-list; unknown-provenance files,
    tracked-code edits, staged changes, and new logic/type/test failures are
    blockers, never silent mutations.
  - baseline failures: lint/format are autofixable; existing non-lint failures are
    recorded (not blockers); only NEW non-lint failures are blockers.

Exit codes (informational, never a halt): 0 no genuine blockers, 1 blockers
remain, 2 unreadable input.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

_SECTION = re.compile(r"^=====\s+(.*?)\s+=====\s*$")
_KV = re.compile(r"^([A-Z0-9_]+)=(.*)$")

# Untracked files matching these are known development artifacts, never "unknown".
_GENERATED = (
    ".venv",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    ".coverage",
    "htmlcov",
    "build/",
    "dist/",
    ".preflight/",
    "node_modules",
    ".next",
    ".turbo",
    "coverage",
)
# A path SEGMENT ending in one of these is a generated dir/file anywhere in the path
# (e.g. .github/scripts/pkg.egg-info/PKG-INFO).
_GENERATED_SEG_SUFFIX = (".egg-info", ".dist-info", ".pyc")
# The probe writes its own timestamped log; it is a known tool artifact, not unknown.
_PROBE_LOG = re.compile(r"^repo-preflight-\d{8}T\d{6}Z\.log$")
# Foundations that are genuinely required; missing one is a wrong-checkout blocker.
_CORE_FOUNDATIONS = ("pyproject.toml", "tests")
# Baseline tools whose failures a formatter/linter can auto-resolve (any ecosystem).
_LINT_TOOLS = ("ruff", "ruff_format", "eslint", "prettier", "biome")

# Autofix action ids — remediate.py dispatches on these.
ACTION_CLEAN_GENERATED = "clean_generated"
ACTION_GIT_SWITCH = "git_switch_branch"
ACTION_ADAPT = "adapt_blueprint"
ACTION_PIP_INSTALL = "pip_install"
ACTION_EDITABLE_INSTALL = "editable_install"
ACTION_NPM_INSTALL = "npm_install"
ACTION_RUFF_FIX = "ruff_fix"
ACTION_ESLINT_FIX = "eslint_fix"
ACTION_UV_LOCK = "uv_lock"
ACTION_NPM_CI = "npm_ci"


def _load(path: Path) -> Any:
    text = path.read_text(encoding="utf-8")
    try:
        return json.loads(text)
    except Exception:
        try:
            import yaml  # type: ignore[import-not-found]

            return yaml.safe_load(text)
        except Exception as exc:
            raise ValueError(f"cannot parse {path.name} as json/yaml: {exc}") from exc


def parse_sections(text: str) -> dict[str, list[str]]:
    """Split a probe log into {section_name: [lines]}."""
    sections: dict[str, list[str]] = {}
    current = "_preamble"
    sections[current] = []
    for line in text.splitlines():
        m = _SECTION.match(line)
        if m:
            current = m.group(1)
            sections.setdefault(current, [])
            continue
        sections[current].append(line)
    return sections


def _kv(lines: list[str]) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in lines:
        m = _KV.match(line.strip())
        if m:
            out[m.group(1)] = m.group(2)
    return out


def _is_generated(path: str) -> bool:
    p = path.strip().strip("/")
    segs = p.split("/")
    if _PROBE_LOG.match(segs[-1]):
        return True
    if any(seg in _GENERATED for seg in segs):
        return True
    if any(seg.endswith(_GENERATED_SEG_SUFFIX) for seg in segs):
        return True
    return p.startswith(_GENERATED)


def _untracked(status_lines: list[str]) -> list[str]:
    out: list[str] = []
    for line in status_lines:
        if line.startswith("?? "):
            out.append(line[3:].strip())
    return out


def _status_files(status_lines: list[str]) -> dict[str, list[str]]:
    """Parse `git status --short` porcelain into tracked/staged/untracked file lists."""
    tracked, staged, untracked = [], [], []
    for line in status_lines:
        if line.startswith("?? "):
            untracked.append(line[3:].strip())
        elif len(line) >= 3 and line[2] == " " and line[:2].strip():
            x, y, path = line[0], line[1], line[3:].strip()
            if x in "MADRC":
                staged.append(path)
            if y in "MD":
                tracked.append(path)
    return {"tracked": tracked, "staged": staged, "untracked": untracked}


def _present_paths(key_file_lines: list[str]) -> dict[str, bool]:
    out: dict[str, bool] = {}
    for line in key_file_lines:
        s = line.strip()
        if s.startswith("present "):
            out[s[len("present ") :].strip()] = True
        elif s.startswith("missing "):
            out[s[len("missing ") :].strip()] = False
    return out


def _gate(gid: int, name: str, question: str, verdict: str, **extra: Any) -> dict[str, Any]:
    g: dict[str, Any] = {"id": gid, "name": name, "question": question, "verdict": verdict}
    g.update(extra)
    return g


def _fix(action: str, command: str, description: str, **extra: Any) -> dict[str, Any]:
    plan = {"action": action, "command": command, "description": description, "reversible": True}
    plan.update(extra)
    return plan


def _blocker(
    gate: dict[str, Any], severity: str, why: str, remediation: dict[str, Any]
) -> dict[str, Any]:
    cls = gate.get("taxonomy", gate["name"])
    return {
        "id": f"BLK-{gate['id']}-{cls.split()[0].replace('/', '-')}",
        "gate": gate["id"],
        "gate_name": gate["name"],
        "class": cls,
        "severity": severity,
        "why_not_autofixable": why,
        "evidence": gate.get("evidence", {}),
        "remediation": remediation,
    }


# --------------------------------------------------------------------------- #
# Gate classifiers
# --------------------------------------------------------------------------- #
def gate1_probe(sections: dict[str, list[str]]) -> dict[str, Any]:
    complete = "PROBE COMPLETE" in sections
    core = ["REPOSITORY IDENTITY", "WORKTREE STATUS", "KEY FILE PRESENCE", "PYTHON TOOLCHAIN"]
    missing = [s for s in core if s not in sections]
    failures = sum(line.count("[command failed:") for lines in sections.values() for line in lines)
    if complete and not missing:
        return _gate(
            1,
            "probe-completed",
            "did the probe complete successfully?",
            "clear",
            evidence={"sections": len(sections), "command_failures": failures},
        )
    return _gate(
        1,
        "probe-completed",
        "did the probe complete successfully?",
        "blocker",
        taxonomy="broken-probe-environment",
        evidence={"complete": complete, "missing_sections": missing, "command_failures": failures},
    )


def gate2_identity(sections: dict[str, list[str]], expected: dict[str, Any]) -> dict[str, Any]:
    ident = _kv(sections.get("REPOSITORY IDENTITY", []))
    status = _kv(sections.get("WORKTREE STATUS", []))
    remotes = "\n".join(sections.get("REMOTES", []))
    branch, head, root = ident.get("BRANCH", ""), ident.get("HEAD", ""), ident.get("ROOT", "")
    clean = int(status.get("TRACKED_MODIFIED_COUNT", "0") or 0) == 0 and not _untracked(
        [ln for ln in sections.get("WORKTREE STATUS", []) if not _is_generated(ln[3:])]
    )
    ev = {"root": root, "branch": branch, "head": head[:12]}
    if not expected:
        return _gate(
            2,
            "correct-identity",
            "correct repository / branch / commit?",
            "clear",
            evidence=ev | {"note": "no expected contract; identity accepted as observed"},
        )
    want_repo, want_branch, want_commit = (
        expected.get("repo"),
        expected.get("branch"),
        expected.get("commit"),
    )
    if want_repo and str(want_repo) not in (remotes + " " + root):
        return _gate(
            2,
            "correct-identity",
            "correct repository / branch / commit?",
            "blocker",
            taxonomy="wrong-repo",
            evidence=ev | {"expected_repo": want_repo},
        )
    if want_commit and str(want_commit) not in head:
        return _gate(
            2,
            "correct-identity",
            "correct repository / branch / commit?",
            "blocker",
            taxonomy="wrong-commit",
            evidence=ev | {"expected_commit": want_commit},
        )
    if want_branch and str(want_branch) != branch:
        if clean:
            g = _gate(
                2,
                "correct-identity",
                "correct repository / branch / commit?",
                "autofixable",
                taxonomy="wrong-branch",
                evidence=ev | {"expected_branch": want_branch},
            )
            g["autofix_plan"] = _fix(
                ACTION_GIT_SWITCH,
                f"git switch {want_branch}",
                f"clean tree: switch to expected branch {want_branch}",
                targets=[want_branch],
            )
            return g
        return _gate(
            2,
            "correct-identity",
            "correct repository / branch / commit?",
            "blocker",
            taxonomy="wrong-branch-dirty-tree",
            evidence=ev | {"expected_branch": want_branch},
        )
    return _gate(
        2, "correct-identity", "correct repository / branch / commit?", "clear", evidence=ev
    )


def gate3_worktree(
    sections: dict[str, list[str]], self_modified: frozenset[str] = frozenset()
) -> dict[str, Any]:
    files = _status_files(sections.get("WORKTREE STATUS", []))
    # files this run created/modified (auto-format, tool-written .gitignore) are
    # tool-owned, not user work — excluded from tracked AND untracked classification
    tracked = sorted(set(files["tracked"]) - self_modified)
    formatted = sorted((set(files["tracked"]) | set(files["untracked"])) & self_modified)
    staged = files["staged"]
    untracked = [u for u in files["untracked"] if u not in self_modified]
    generated = sorted({u for u in untracked if _is_generated(u)})
    unknown = sorted({u for u in untracked if not _is_generated(u)})
    ev = {
        "tracked_modified": tracked,
        "staged": staged,
        "unknown": unknown,
        "generated": generated,
        "auto_formatted": formatted,
    }
    if unknown:
        return _gate(
            3, "worktree-clean", "worktree clean?", "blocker", taxonomy="unknown-files", evidence=ev
        )
    if tracked or staged:
        return _gate(
            3,
            "worktree-clean",
            "worktree clean?",
            "blocker",
            taxonomy="tracked-or-staged-changes",
            evidence=ev,
        )
    if generated:
        g = _gate(
            3,
            "worktree-clean",
            "worktree clean?",
            "autofixable",
            taxonomy="generated-files",
            evidence=ev,
        )
        g["autofix_plan"] = _fix(
            ACTION_CLEAN_GENERATED,
            "gitignore known-generated globs + remove the untracked artifacts",
            "regenerable artifacts: ignore and remove",
            targets=generated,
        )
        return g
    if formatted:  # only tool-owned formatting remains: informational, commit it
        return _gate(
            3,
            "worktree-clean",
            "worktree clean?",
            "clear",
            taxonomy="auto-formatted",
            evidence=ev,
            note="auto-formatted files are uncommitted; review and commit them",
        )
    return _gate(3, "worktree-clean", "worktree clean?", "clear", evidence=ev)


def _alt_layout_evidence(sections: dict[str, list[str]]) -> bool:
    """True if the repo clearly uses a non-src Python layout (packages found)."""
    disc = "\n".join(sections.get("PACKAGE DISCOVERY", []))
    if "NOT_IMPORTABLE" not in disc and "=" in disc and ".py" in disc:
        return True
    return any(line.strip().endswith(".py") for line in sections.get("PACKAGE DISCOVERY", []))


def gate4_foundations(sections: dict[str, list[str]], expected: dict[str, Any]) -> dict[str, Any]:
    present = _present_paths(sections.get("KEY FILE PRESENCE", []))
    tstamp = _kv(sections.get("TIMESTAMP", []))
    if expected.get("foundations"):
        wanted = list(expected["foundations"])
    else:
        wanted = (tstamp.get("PROBE_FOUNDATIONS") or "pyproject.toml tests schemas").split()
    missing = [f for f in wanted if present.get(f) is not True]
    ev = {"expected": wanted, "missing": missing}
    if not missing:
        return _gate(
            4, "foundations-present", "required foundations present?", "clear", evidence=ev
        )
    core_missing = [m for m in missing if m in _CORE_FOUNDATIONS]
    if core_missing:
        return _gate(
            4,
            "foundations-present",
            "required foundations present?",
            "blocker",
            taxonomy="missing-core-foundation",
            evidence=ev | {"core_missing": core_missing},
        )
    if _alt_layout_evidence(sections):
        g = _gate(
            4,
            "foundations-present",
            "required foundations present?",
            "adapt",
            taxonomy="missing-but-not-expected",
            evidence=ev,
        )
        g["autofix_plan"] = _fix(
            ACTION_ADAPT,
            "drop the missing non-core foundations from the expected contract",
            "repo uses a different layout: adapt the blueprint (new file, non-destructive)",
            targets=missing,
        )
        return g
    # non-core missing, layout unclear -> still not a halt: adapt and record
    g = _gate(
        4,
        "foundations-present",
        "required foundations present?",
        "adapt",
        taxonomy="missing-uncertain",
        evidence=ev,
    )
    g["autofix_plan"] = _fix(
        ACTION_ADAPT,
        "drop the missing non-core foundations from the expected contract",
        "foundations not confirmed for this repo: adapt the blueprint",
        targets=missing,
    )
    return g


def _ecosystems(sections: dict[str, list[str]]) -> list[str]:
    """Which language ecosystems the repo uses (from the probe, else file evidence)."""
    tstamp = _kv(sections.get("TIMESTAMP", []))
    declared = (tstamp.get("PROBE_ECOSYSTEM") or "").split()
    if declared:
        return declared
    present = _present_paths(sections.get("KEY FILE PRESENCE", []))
    eco = []
    if present.get("package.json"):
        eco.append("node")
    if present.get("pyproject.toml") or present.get("setup.py"):
        eco.append("python")
    if present.get("go.mod"):
        eco.append("go")
    if present.get("Cargo.toml"):
        eco.append("rust")
    return eco or ["unknown"]


# config-file -> tool it declares, per ecosystem
_NODE_TOOL_MARKERS = {
    "tsconfig.json": "tsc",
    ".eslintrc": "eslint",
    ".eslintrc.json": "eslint",
    ".eslintrc.js": "eslint",
    ".eslintrc.cjs": "eslint",
    "eslint.config.js": "eslint",
    ".prettierrc": "prettier",
    ".prettierrc.json": "prettier",
    "prettier.config.js": "prettier",
    "jest.config.js": "jest",
    "vitest.config.ts": "vitest",
}


def _repo_tools(sections: dict[str, list[str]]) -> set[str]:
    tools: set[str] = set()
    present = _present_paths(sections.get("KEY FILE PRESENCE", []))
    meta = "\n".join(sections.get("PROJECT METADATA", []))
    # python
    if present.get("ruff.toml") or "ruff" in meta:
        tools.add("ruff")
    if present.get("mypy.ini") or "mypy" in meta:
        tools.add("mypy")
    if present.get("tests") or "pytest" in meta:
        tools.add("pytest")
    # node (declared via config files)
    for marker, tool in _NODE_TOOL_MARKERS.items():
        if present.get(marker):
            tools.add(tool)
    if present.get("package.json"):
        tools.add("npm")
    for line in sections.get("VALIDATION TOOL AVAILABILITY", []):
        parts = line.split()
        if len(parts) >= 2 and parts[1] != "MISSING":
            tools.add(parts[0])
    return tools


def _runtime_ok(sections: dict[str, list[str]], eco: list[str]) -> tuple[bool, list[str]]:
    """Is each ecosystem's runtime available? python -> a py interpreter; node -> node."""
    installed = _installed_tools(sections)
    py_ok = any("_PATH=" in line for line in sections.get("PYTHON TOOLCHAIN", []))
    missing = []
    if "python" in eco and not py_ok:
        missing.append("python")
    if "node" in eco and "node" not in installed:
        missing.append("node")
    return (not missing), missing


def _installed_tools(sections: dict[str, list[str]]) -> set[str]:
    out: set[str] = set()
    for line in sections.get("VALIDATION TOOL AVAILABILITY", []):
        parts = line.split()
        if len(parts) >= 2 and parts[1] != "MISSING":
            out.add(parts[0])
    return out


_NODE_TOOLS = {"eslint", "prettier", "biome", "tsc", "jest", "vitest", "npm", "node"}


def gate5_toolchain(sections: dict[str, list[str]], expected: dict[str, Any]) -> dict[str, Any]:
    eco = _ecosystems(sections)
    repo_tools = _repo_tools(sections)
    installed = _installed_tools(sections)
    rt_ok, missing_rt = _runtime_ok(sections, eco)
    contract = expected.get("toolchain", {}) if expected else {}
    want_tools = set(contract.get("test_tools", []) or [])
    ev = {
        "ecosystems": eco,
        "repo_tools": sorted(repo_tools),
        "installed": sorted(installed),
        "wanted": sorted(want_tools),
    }
    if not rt_ok:
        return _gate(
            5,
            "toolchain-matches",
            "toolchain matches execution contract?",
            "blocker",
            taxonomy="missing-runtime",
            evidence=ev | {"missing_runtime": missing_rt},
        )
    if not expected:
        return _gate(
            5,
            "toolchain-matches",
            "toolchain matches execution contract?",
            "clear",
            evidence=ev | {"note": "no contract; repo tools accepted as the toolchain"},
        )
    unmet = want_tools - repo_tools
    # tools the repo declares but that are just not installed yet -> install them
    installable = sorted((want_tools & repo_tools) - installed)
    if not unmet and not installable:
        return _gate(
            5, "toolchain-matches", "toolchain matches execution contract?", "clear", evidence=ev
        )
    if installable:
        node_side = [t for t in installable if t in _NODE_TOOLS]
        if node_side and "node" in eco:
            action, cmd, desc = (
                ACTION_NPM_INSTALL,
                "npm ci",
                "install node dev dependencies (eslint/tsc/… via npm)",
            )
        else:
            action, cmd, desc = (
                ACTION_PIP_INSTALL,
                "pip install the repo's pinned/declared tools",
                "install declared-but-missing tools (honours repo pins)",
            )
        g = _gate(
            5,
            "toolchain-matches",
            "toolchain matches execution contract?",
            "autofixable",
            taxonomy="tool-declared-not-installed",
            evidence=ev | {"install": installable},
        )
        g["autofix_plan"] = _fix(action, cmd, desc, targets=installable)
        return g
    # contract wants tools the repo does not define -> follow the repo, adapt the plan
    g = _gate(
        5,
        "toolchain-matches",
        "toolchain matches execution contract?",
        "adapt",
        taxonomy="repo-defines-tooling",
        evidence=ev | {"unmet": sorted(unmet)},
    )
    g["autofix_plan"] = _fix(
        ACTION_ADAPT,
        "set the contract test_tools to the repo's own tools",
        "follow the repository; never replace its tooling",
        targets=sorted(unmet),
    )
    return g


def gate6_install(sections: dict[str, list[str]], expected: dict[str, Any]) -> dict[str, Any]:
    eco = _ecosystems(sections)
    present = _present_paths(sections.get("KEY FILE PRESENCE", []))
    # Node: package.json but no node_modules -> install; present -> clear.
    if "node" in eco and present.get("package.json"):
        if present.get("node_modules") is not True:
            g = _gate(
                6,
                "install-succeeded",
                "installation succeeded?",
                "autofixable",
                taxonomy="node-modules-missing",
                evidence={"ecosystems": eco},
            )
            g["autofix_plan"] = _fix(
                ACTION_NPM_INSTALL,
                "npm ci",
                "install node dependencies so the project builds",
                targets=["node_modules"],
            )
            return g
        if "python" not in eco:
            return _gate(
                6,
                "install-succeeded",
                "installation succeeded?",
                "clear",
                evidence={"ecosystems": eco, "note": "node_modules present"},
            )
    disc_lines = sections.get("PACKAGE DISCOVERY", [])
    imports = {}
    for line in disc_lines:
        m = re.match(r"^([A-Za-z0-9_]+)=(.+)$", line.strip())
        if m:
            imports[m.group(1)] = m.group(2)
    not_importable = [k for k, v in imports.items() if v == "NOT_IMPORTABLE"]
    ev = {"packages": imports}
    if imports and not not_importable:
        return _gate(6, "install-succeeded", "installation succeeded?", "clear", evidence=ev)
    if not imports:
        return _gate(
            6,
            "install-succeeded",
            "installation succeeded?",
            "clear",
            evidence=ev | {"note": "no packages declared to import"},
        )
    disc_text = "\n".join(disc_lines)
    in_repo = [p for p in not_importable if f"/{p}/" in disc_text or f"/{p}." in disc_text]
    foreign = [p for p in not_importable if p not in in_repo]
    if foreign and not in_repo:
        g = _gate(
            6,
            "install-succeeded",
            "installation succeeded?",
            "adapt",
            taxonomy="foreign-package",
            evidence=ev | {"foreign": foreign},
        )
        g["autofix_plan"] = _fix(
            ACTION_ADAPT,
            "drop the foreign packages from the expected contract",
            "packages not part of this repo: adapt the blueprint",
            targets=foreign,
        )
        return g
    g = _gate(
        6,
        "install-succeeded",
        "installation succeeded?",
        "autofixable",
        taxonomy="repo-package-not-installed",
        evidence=ev | {"not_importable": in_repo},
    )
    g["autofix_plan"] = _fix(
        ACTION_EDITABLE_INSTALL,
        "pip install -e . (or the declared install)",
        "run the declared editable install so repo packages import",
        targets=in_repo,
    )
    return g


_NODE_LINTERS = {"eslint", "prettier", "biome"}


def gate7_baseline(baseline: dict[str, Any] | None, prior: dict[str, Any] | None) -> dict[str, Any]:
    if baseline is None:
        return _gate(
            7,
            "baseline-reproduces",
            "baseline validation reproduces?",
            "clear",
            evidence={"note": "baseline not yet measured; remediate will run it"},
        )
    results = baseline.get("results", baseline)
    ev = {"results": results}
    lint_fail = [t for t in _LINT_TOOLS if int((results.get(t) or {}).get("failed", 0)) > 0]
    if lint_fail:
        node_lint = [t for t in lint_fail if t in _NODE_LINTERS]
        if node_lint:
            action, cmd, desc = (
                ACTION_ESLINT_FIX,
                "eslint --fix . && prettier --write .",
                "auto-resolve JS/TS lint + format failures",
            )
        else:
            action, cmd, desc = (
                ACTION_RUFF_FIX,
                "ruff check --fix . && ruff format .",
                "auto-resolve lint/format failures",
            )
        g = _gate(
            7,
            "baseline-reproduces",
            "baseline validation reproduces?",
            "autofixable",
            taxonomy="lint-format-failures",
            evidence=ev | {"lint_failing": lint_fail},
        )
        g["autofix_plan"] = _fix(action, cmd, desc, targets=lint_fail)
        return g
    # non-lint failures: existing = recorded (clear); new vs prior = blocker
    prior_results = (prior or {}).get("results", prior or {})
    new: list[str] = []
    for tool, cur in results.items():
        if tool in _LINT_TOOLS:
            continue
        cur_f = int(cur.get("failed", 0)) if isinstance(cur, dict) else 0
        old_f = int((prior_results.get(tool) or {}).get("failed", 0)) if prior_results else 0
        if prior is not None and cur_f > old_f:
            new.append(f"{tool}: {old_f} -> {cur_f}")
    if new:
        return _gate(
            7,
            "baseline-reproduces",
            "baseline validation reproduces?",
            "blocker",
            taxonomy="new-nonlint-failures",
            evidence=ev | {"new_failures": new},
        )
    return _gate(
        7,
        "baseline-reproduces",
        "baseline validation reproduces?",
        "clear",
        evidence=ev | {"note": "failures (if any) are the existing baseline"},
    )


# --------------------------------------------------------------------------- #
# Blocker detailing
# --------------------------------------------------------------------------- #
def _detail_blocker(g: dict[str, Any]) -> dict[str, Any]:
    tax = g.get("taxonomy", "")
    ev = g.get("evidence", {})
    if tax == "unknown-files":
        return _blocker(
            g,
            "high",
            "unknown provenance: unsafe to delete, ignore, or commit automatically",
            {
                "owner": "human",
                "steps": [
                    "inspect each file (contents, timestamps, recent commands)",
                    "if intended: git add / update the plan; if not: remove or revert",
                ],
                "commands": [f"ls -la {p}" for p in ev.get("unknown", [])[:5]],
                "auto_option": "quarantine to .preflight/quarantine/ (reversible)",
            },
        )
    if tax == "tracked-or-staged-changes":
        return _blocker(
            g,
            "medium",
            "tracked/staged edits may be intended work; auto-reverting is destructive",
            {
                "owner": "human",
                "steps": ["review the diff; commit, or stash if unrelated to this task"],
                "commands": ["git diff", "git diff --cached"],
                "auto_option": "git stash --include-untracked (reversible)",
            },
        )
    if tax == "missing-core-foundation":
        return _blocker(
            g,
            "critical",
            "a core foundation is absent: likely a wrong or partial checkout",
            {
                "owner": "human",
                "steps": ["verify the branch/commit; re-clone if the clone is partial"],
                "commands": ["git rev-parse --abbrev-ref HEAD", "git status"],
                "auto_option": None,
            },
        )
    if tax in ("wrong-repo", "wrong-commit", "wrong-branch-dirty-tree"):
        return _blocker(
            g,
            "critical",
            "identity mismatch with a dirty tree or no safe automatic resolution",
            {
                "owner": "human",
                "steps": ["confirm the intended repo/branch/commit; clean the tree, then switch"],
                "commands": ["git remote -v", "git status --short"],
                "auto_option": None,
            },
        )
    if tax == "new-nonlint-failures":
        return _blocker(
            g,
            "high",
            "new type/test/logic failures are not auto-resolvable",
            {
                "owner": "downstream-agent",
                "steps": ["fix the specific failing test/type error before implementation"],
                "commands": ["pytest -q", "mypy ."],
                "auto_option": None,
            },
        )
    if tax == "missing-runtime":
        missing = g.get("evidence", {}).get("missing_runtime", [])
        return _blocker(
            g,
            "high",
            f"required runtime(s) not available in this environment: {', '.join(missing) or 'unknown'}",
            {
                "owner": "human",
                "steps": [f"install {m} and re-run" for m in missing] or ["install the runtime"],
                "commands": [f"{m} --version" for m in missing],
                "auto_option": None,
            },
        )
    if tax == "broken-probe-environment":
        return _blocker(
            g,
            "critical",
            "the probe could not complete (not a git repo / broken shell)",
            {
                "owner": "human",
                "steps": ["run inside the repo worktree with git available"],
                "commands": ["git rev-parse --is-inside-work-tree"],
                "auto_option": None,
            },
        )
    return _blocker(
        g,
        "medium",
        "not safely auto-resolvable",
        {"owner": "human", "steps": ["resolve manually"], "commands": [], "auto_option": None},
    )


def evaluate(
    sections: dict[str, list[str]],
    expected: dict[str, Any],
    baseline: dict[str, Any] | None = None,
    prior: dict[str, Any] | None = None,
    self_modified: frozenset[str] = frozenset(),
) -> dict[str, Any]:
    gates = [
        gate1_probe(sections),
        gate2_identity(sections, expected),
        gate3_worktree(sections, self_modified),
        gate4_foundations(sections, expected),
        gate5_toolchain(sections, expected),
        gate6_install(sections, expected),
        gate7_baseline(baseline, prior),
    ]
    genuine_blockers = [_detail_blocker(g) for g in gates if g["verdict"] == "blocker"]
    autofix_plans = [
        {"gate": g["id"], "gate_name": g["name"], **g["autofix_plan"]}
        for g in gates
        if g.get("autofix_plan")
    ]
    ident = _kv(sections.get("REPOSITORY IDENTITY", []))
    repo_root = Path(ident.get("ROOT", "."))
    semantic = {"gates": [], "findings": [], "blockers": [], "autofix_plans": []}
    if repo_root.is_dir():
        try:
            from preflight.semantic.runner import evaluate_semantic_gates
            semantic = evaluate_semantic_gates(repo_root, {"sections": sections})
        except Exception as exc:
            semantic = {
                "gates": [],
                "findings": [{
                    "id": "BLK-SEMANTIC-RUNNER",
                    "gate": 9,
                    "gate_name": "semantic-runner",
                    "class": "internal",
                    "severity": "high",
                    "confidence": "high",
                    "authority_action": "blocker",
                    "why_not_autofixable": "semantic gate orchestration failed",
                    "evidence": {"error": str(exc)[:500]},
                    "remediation": {"owner": "human", "steps": ["repair semantic gate imports and rerun"], "commands": []},
                }],
                "blockers": [],
                "autofix_plans": [],
            }
            semantic["blockers"] = list(semantic["findings"])

    for finding in semantic["blockers"]:
        genuine_blockers.append({
            "id": finding.get("id", "BLK-SEMANTIC"),
            "gate": finding.get("gate", 9),
            "gate_name": finding.get("gate_name", "semantic"),
            "class": finding.get("class", "semantic-finding"),
            "severity": finding.get("severity", "medium"),
            "why_not_autofixable": finding.get("why_not_autofixable") or "semantic blocker requires resolution",
            "evidence": finding.get("evidence", {}),
            "remediation": finding.get("remediation", {"owner": "human", "steps": ["resolve finding"], "commands": []}),
        })
    for plan in semantic["autofix_plans"]:
        autofix_plans.append({
            "gate": plan.get("gate", 9),
            "gate_name": f"semantic-gate-{plan.get('gate', 9)}",
            **plan,
        })

    ready = not genuine_blockers
    gates.append(
        _gate(
            8,
            "implementation-ready",
            "implementation ready after structural and semantic remediation?",
            "clear" if ready else "blocker",
            evidence={
                "genuine_blockers": len(genuine_blockers),
                "pending_autofixes": len(autofix_plans),
                "semantic_findings": len(semantic["findings"]),
            },
        )
    )
    gates.extend(semantic["gates"])
    gates.sort(key=lambda gate: gate["id"])
    tstamp = _kv(sections.get("TIMESTAMP", []))
    return {
        "generated_from": tstamp.get("UTC", "Unknown"),
        "repo": {
            "root": ident.get("ROOT", "Unknown"),
            "branch": ident.get("BRANCH", "Unknown"),
            "head": ident.get("HEAD", "Unknown")[:12],
        },
        "run_completed": True,
        "gates": gates,
        "autofix_plans": autofix_plans,
        "genuine_blockers": genuine_blockers,
        "semantic_findings": semantic["findings"],
        "blocker_count": len(genuine_blockers),
        "ready_after_remediation": ready,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Classify fourteen structural and semantic preflight gates (fail-open).")
    parser.add_argument("log", help="Path to a probe log")
    parser.add_argument("--expected", default=None, help="Optional expected-contract (json/yaml)")
    parser.add_argument("--baseline", default=None, help="Optional baseline results record")
    parser.add_argument("--prior", default=None, help="Optional prior baseline to diff against")
    parser.add_argument("--json", action="store_true", help="Emit the full report as JSON")
    args = parser.parse_args()

    log_path = Path(args.log)
    if not log_path.is_file():
        print(f"FAIL: not a file: {log_path}", file=sys.stderr)
        return 2
    try:
        sections = parse_sections(log_path.read_text(encoding="utf-8"))
        expected = _load(Path(args.expected)) if args.expected else {}
        baseline = _load(Path(args.baseline)) if args.baseline else None
        prior = _load(Path(args.prior)) if args.prior else None
    except Exception as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 2
    if not isinstance(expected, dict):
        expected = {}

    report = evaluate(sections, expected, baseline, prior)

    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print(
            f"repo: {report['repo']['root']} @ {report['repo']['branch']} ({report['repo']['head']})"
        )
        for g in report["gates"]:
            tax = f" — {g['taxonomy']}" if g.get("taxonomy") else ""
            print(f"  gate {g['id']} {g['name']:22} [{g['verdict']}]{tax}")
        for p in report["autofix_plans"]:
            print(f"  autofix (gate {p['gate']}): {p['action']} — {p['description']}")
        for b in report["genuine_blockers"]:
            print(
                f"  BLOCKER {b['id']} [{b['severity']}]: {b['class']} — {b['why_not_autofixable']}"
            )
        print(
            f"run_completed: {report['run_completed']} | blockers: {report['blocker_count']} | "
            f"ready_after_remediation: {report['ready_after_remediation']}"
        )
    return 0 if report["blocker_count"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
