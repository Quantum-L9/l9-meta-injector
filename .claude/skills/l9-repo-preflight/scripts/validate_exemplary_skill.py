#!/usr/bin/env python3
"""Validate exemplary-skill claims fail-closed.

This validator checks a compiled skill folder for the SMART exemplary artifacts
that prove the compiler extracted expertise instead of only summarizing docs.
It intentionally uses conservative gates: missing, unmeasured, or Unknown gates
block tier: exemplary.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

REQUIRED_EXPERTISE_FIELDS = [
    "experts",
    "doctrine",
    "invariants",
    "authority_hierarchy",
    "activation_signals",
    "reject_signals",
    "adapters",
    "failure_modes",
    "leverage_points",
]

REQUIRED_REPORT_FIELDS = [
    "activation_model",
    "authority_model",
    "expert_heuristics",
    "doctrine",
    "invariants",
    "adapter_map",
    "failure_modes",
    "leverage_points",
    "evidence_hierarchy",
    "exemplary_gate_results",
    "tier_decision",
]

REQUIRED_GATES = [
    "activation_precision",
    "adapter_architecture",
    "evidence_hierarchy",
    "doctrine_extraction",
    "expert_heuristics",
    "failure_modes",
    "leverage_model",
    "self_improvement_hook",
    "compiler_enforcement_gates",
    "skill_intelligence_report",
]

MAX_COUNTS = {
    "experts": 5,
    "doctrine": 10,
    "invariants": 10,
    "authority_hierarchy": 5,
    "activation_signals": 5,
    "reject_signals": 5,
    "adapters": 3,
    "failure_modes": 5,
    "leverage_points": 5,
}


def _load_yaml_or_json(path: Path) -> dict[str, Any]:
    text = path.read_text(encoding="utf-8")
    try:
        import yaml  # type: ignore[import-not-found]

        data = yaml.safe_load(text)
    except Exception:
        try:
            data = json.loads(text)
        except Exception as exc:
            raise ValueError(f"cannot parse {path.name} as yaml/json: {exc}") from exc
    if not isinstance(data, dict):
        raise ValueError(f"{path.name} root must be a mapping")
    return data


def _unwrap(data: dict[str, Any], key: str) -> dict[str, Any]:
    node = data.get(key, data)
    if not isinstance(node, dict):
        raise ValueError(f"{key} must be a mapping")
    return node


def _list_errors(node: dict[str, Any], field: str, required: bool = True) -> list[str]:
    errors: list[str] = []
    value = node.get(field)
    if value is None:
        if required:
            errors.append(f"missing required field: {field}")
        return errors
    if not isinstance(value, list):
        errors.append(f"{field} must be a list")
        return errors
    if required and not value and field != "adapters":
        errors.append(f"{field} must not be empty")
    max_count = MAX_COUNTS.get(field)
    if max_count is not None and len(value) > max_count:
        errors.append(f"{field} exceeds max {max_count}: {len(value)}")
    return errors


def _validate_expertise_model(path: Path) -> list[str]:
    errors: list[str] = []
    data = _unwrap(_load_yaml_or_json(path), "expertise_model")
    for field in REQUIRED_EXPERTISE_FIELDS:
        errors.extend(_list_errors(data, field, required=True))
    return [f"expertise_model: {error}" for error in errors]


def _gate_status(value: Any) -> str:
    if isinstance(value, str):
        return value.lower()
    if isinstance(value, dict):
        for key in ("status", "result", "gate", "decision"):
            raw = value.get(key)
            if isinstance(raw, str):
                return raw.lower()
        if value.get("pass") is True or value.get("passed") is True:
            return "pass"
        if value.get("pass") is False or value.get("passed") is False:
            return "fail"
    if value is True:
        return "pass"
    if value is False:
        return "fail"
    return "unknown"


def _validate_report(path: Path) -> list[str]:
    errors: list[str] = []
    data = _unwrap(_load_yaml_or_json(path), "skill_intelligence_report")
    for field in REQUIRED_REPORT_FIELDS:
        if field not in data:
            errors.append(f"skill_intelligence_report: missing required field: {field}")
    activation = data.get("activation_model", {})
    if isinstance(activation, dict):
        if not activation.get("reject_signals"):
            errors.append("skill_intelligence_report: activation_model.reject_signals required")
        if activation.get("specificity_score") in (None, "Unknown", "unknown"):
            errors.append("skill_intelligence_report: specificity_score must be measured")
        if activation.get("false_positive_risk_score") in (None, "Unknown", "unknown"):
            errors.append("skill_intelligence_report: false_positive_risk_score must be measured")
    else:
        errors.append("skill_intelligence_report: activation_model must be mapping")

    gates = data.get("exemplary_gate_results", {})
    if not isinstance(gates, dict):
        errors.append("skill_intelligence_report: exemplary_gate_results must be mapping")
        gates = {}
    for gate in REQUIRED_GATES:
        if gate not in gates:
            errors.append(f"skill_intelligence_report: missing exemplary gate: {gate}")
            continue
        status = _gate_status(gates[gate])
        if status != "pass":
            errors.append(f"skill_intelligence_report: gate {gate} is {status}, not pass")

    tier = data.get("tier_decision")
    if isinstance(tier, dict):
        tier = tier.get("tier") or tier.get("decision")
    if tier == "exemplary" and errors:
        errors.append("skill_intelligence_report: tier exemplary claimed despite failing gates")
    if tier != "exemplary":
        errors.append("skill_intelligence_report: tier_decision is not exemplary")
    return errors


def _scan_skill_md(path: Path) -> list[str]:
    errors: list[str] = []
    skill_md = path / "SKILL.md"
    if not skill_md.exists():
        return ["missing SKILL.md"]
    text = skill_md.read_text(encoding="utf-8")
    required_terms = [
        "extract_expertise",
        "compress_expertise",
        "skill_intelligence_report",
        "exemplary_gate",
    ]
    for term in required_terms:
        if term not in text:
            errors.append(f"SKILL.md missing required exemplary term: {term}")
    if (
        re.search(r"tier\s*:\s*exemplary", text, re.IGNORECASE)
        and "validate_exemplary_skill.py" not in text
    ):
        errors.append("SKILL.md claims exemplary without validator reference")
    # Enforcement gates check: SKILL.md must reference enforcement-gates
    if "enforcement-gates" not in text:
        errors.append("SKILL.md missing enforcement-gates reference (required for exemplary tier)")
    # Check that enforcement-gates.md actually exists in references/
    enforcement_gates_path = path / "references" / "enforcement-gates.md"
    if not enforcement_gates_path.exists():
        errors.append("missing references/enforcement-gates.md (required enforcement layer)")
    return errors


def validate(skill_folder: Path) -> list[str]:
    errors: list[str] = []
    errors.extend(_scan_skill_md(skill_folder))
    expertise_candidates = [
        skill_folder / "expertise_model.yaml",
        skill_folder / "references" / "expertise_model.yaml",
        skill_folder / "assets" / "expertise_model.yaml",
    ]
    report_candidates = [
        skill_folder / "skill_intelligence_report.yaml",
        skill_folder / "references" / "skill_intelligence_report.yaml",
        skill_folder / "assets" / "skill_intelligence_report.yaml",
    ]
    expertise_path = next((p for p in expertise_candidates if p.exists()), None)
    report_path = next((p for p in report_candidates if p.exists()), None)
    if expertise_path is None:
        errors.append("missing expertise_model.yaml")
    else:
        errors.extend(_validate_expertise_model(expertise_path))
    if report_path is None:
        errors.append("missing skill_intelligence_report.yaml")
    else:
        errors.extend(_validate_report(report_path))
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Validate a compiled skill's exemplary-tier evidence."
    )
    parser.add_argument("skill_folder", help="Path to compiled skill folder")
    args = parser.parse_args()
    folder = Path(args.skill_folder)
    if not folder.exists() or not folder.is_dir():
        print(f"FAIL: not a directory: {folder}", file=sys.stderr)
        return 2
    try:
        errors = validate(folder)
    except Exception as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 2
    if errors:
        for error in errors:
            print(f"FAIL: {error}", file=sys.stderr)
        return 1
    print("PASS: exemplary skill validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
