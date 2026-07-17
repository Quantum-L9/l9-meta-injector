"""Persist preflight reports under docs/preflight/ — deterministic + redacted.

Writes the six required outputs with stable, machine-readable schemas, sorted
deterministically, secrets redacted, and each stamped with run_id, timestamp,
source_commit, and tool_version. JSON is emitted as valid YAML for the *.yaml
outputs (portable, no PyYAML dependency, sort_keys for determinism).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .redaction import redact_all

REQUIRED = [
    "preflight-report.md",
    "preflight-report.json",
    "autofix-log.json",
    "blockers.yaml",
    "technical-debt.yaml",
    "machine-summary.json",
]


def _json(obj: Any) -> str:
    return json.dumps(redact_all(obj), indent=2, sort_keys=True) + "\n"


def _yaml(obj: Any, header: str) -> str:
    # json is valid yaml; sort_keys gives deterministic ordering.
    return f"# {header}\n" + json.dumps(redact_all(obj), indent=2, sort_keys=True) + "\n"


def _stamp(run_id: str, timestamp: str, source_commit: str, tool_version: str) -> dict[str, str]:
    return {
        "run_id": run_id,
        "timestamp": timestamp,
        "source_commit": source_commit,
        "tool_version": tool_version,
    }


def build_machine_summary(
    stamp: dict[str, str],
    accounting: dict[str, Any],
    techdebt: list[dict[str, Any]],
    receipts: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
        **stamp,
        "overall_status": accounting.get("overall_status", "unknown"),
        "blocker_count": accounting.get("blocker_count", 0),
        "resolved_count": len(accounting.get("resolved", [])),
        "not_applicable_count": len(accounting.get("not_applicable", [])),
        "technical_debt_count": len(techdebt),
        "reports": REQUIRED,
        "side_effect_receipts": redact_all(receipts),
    }


def _markdown(
    stamp: dict[str, str],
    accounting: dict[str, Any],
    actions: list[dict[str, Any]],
    techdebt: list[dict[str, Any]],
) -> str:
    blockers = accounting.get("unresolved_blockers", [])
    lines = [
        "# Preflight Report",
        "",
        f"- run_id: `{stamp['run_id']}`",
        f"- timestamp: {stamp['timestamp']}",
        f"- source_commit: `{stamp['source_commit']}`",
        f"- tool_version: {stamp['tool_version']}",
        f"- overall_status: **{accounting.get('overall_status')}**",
        f"- blocker_count: **{accounting.get('blocker_count', 0)}**",
        "",
        "## Genuine blockers",
        "",
    ]
    if blockers:
        for b in sorted(blockers, key=lambda x: str(x.get("id"))):
            lines.append(
                f"- **{b.get('id')}** [{b.get('severity')}] {b.get('class')} — "
                f"{b.get('why_not_autofixable')}"
            )
    else:
        lines.append("- (none)")
    lines += ["", "## Autofixes applied", ""]
    ok = [a for a in actions if a.get("result") == "ok"]
    lines += [f"- gate {a['gate']}: {a['action']} — {a.get('command')}" for a in ok] or ["- (none)"]
    lines += ["", "## Technical debt", ""]
    lines += [
        f"- {d['category']}: `{d['path']}`" + (f":{d['line']}" if d.get("line") else "")
        for d in techdebt
    ] or ["- (none)"]
    return "\n".join(lines) + "\n"


def persist(
    docs_dir: Path,
    *,
    run_id: str,
    timestamp: str,
    source_commit: str,
    tool_version: str,
    evaluate_report: dict[str, Any],
    autofix_actions: list[dict[str, Any]],
    accounting: dict[str, Any],
    techdebt: list[dict[str, Any]],
    receipts: list[dict[str, Any]] | None = None,
) -> list[str]:
    """Write all six reports; return the repo-relative-ish paths written (sorted)."""
    docs_dir.mkdir(parents=True, exist_ok=True)
    receipts = receipts or []
    stamp = _stamp(run_id, timestamp, source_commit, tool_version)
    blockers_sorted = sorted(
        accounting.get("unresolved_blockers", []), key=lambda b: str(b.get("id"))
    )

    (docs_dir / "preflight-report.json").write_text(
        _json({**stamp, **evaluate_report, "accounting": accounting}), encoding="utf-8"
    )
    (docs_dir / "autofix-log.json").write_text(
        _json(
            {
                **stamp,
                "iterations": evaluate_report.get("iterations", 0),
                "actions": autofix_actions,
            }
        ),
        encoding="utf-8",
    )
    (docs_dir / "blockers.yaml").write_text(
        _yaml(
            {**stamp, "blocker_count": len(blockers_sorted), "blockers": blockers_sorted},
            "preflight blockers (json is valid yaml)",
        ),
        encoding="utf-8",
    )
    (docs_dir / "technical-debt.yaml").write_text(
        _yaml(
            {**stamp, "count": len(techdebt), "findings": techdebt},
            "technical debt (json is valid yaml)",
        ),
        encoding="utf-8",
    )
    (docs_dir / "machine-summary.json").write_text(
        _json(build_machine_summary(stamp, accounting, techdebt, receipts)), encoding="utf-8"
    )
    (docs_dir / "preflight-report.md").write_text(
        _markdown(stamp, accounting, autofix_actions, techdebt), encoding="utf-8"
    )

    return sorted(str(docs_dir / n) for n in REQUIRED)
