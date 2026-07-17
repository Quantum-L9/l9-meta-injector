"""Gate 11 — Design ↔ Capability Drift (fail-open)."""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from ._common import (
    AUTH_ADAPT, AUTH_BLOCKER, AUTH_TECH_DEBT,
    CONF_HIGH, CONF_LOW, CONF_MEDIUM,
    SEVERITY_HIGH, SEVERITY_LOW,
    finding, remediation,
)
from .extractors.alembic_drift import check as alembic_check
from .extractors.extract_routes import extract_declared_routes

GATE_ID = 11
GATE_NAME = "design-capability-drift"


def _load_openapi(repo: Path) -> dict | None:
    parse_errors: list[str] = []
    for pattern in (
        "openapi.yaml",
        "openapi.yml",
        "openapi.json",
        "docs/openapi.yaml",
        "api/openapi.yaml",
    ):
        path = repo / pattern
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8")
        try:
            if path.suffix == ".json":
                parsed = json.loads(text)
            else:
                try:
                    import yaml  # type: ignore[import-not-found]
                except ImportError as exc:
                    raise RuntimeError("PyYAML is required to parse OpenAPI YAML") from exc
                parsed = yaml.safe_load(text)
        except Exception as exc:
            parse_errors.append(f"{pattern}: {exc}")
            continue
        if not isinstance(parsed, dict):
            parse_errors.append(f"{pattern}: document root must be an object")
            continue
        return parsed
    if parse_errors:
        raise ValueError("; ".join(parse_errors))
    return None


def _check_openapi_drift(repo: Path) -> list[dict[str, Any]]:
    spec = _load_openapi(repo)
    if spec is None:
        return []
    routes = extract_declared_routes(repo)
    spec_ps = set((spec.get("paths") or {}).keys())
    code_ps = {r["path"] for r in routes}
    results: list[dict[str, Any]] = []
    promised_missing = sorted(spec_ps - code_ps)
    if promised_missing:
        results.append(finding(
            GATE_ID, GATE_NAME, "promised-route-missing", "capability-gap",
            SEVERITY_HIGH, CONF_MEDIUM, AUTH_BLOCKER,
            {"routes_in_spec_not_in_code": promised_missing,
             "spec_count": len(spec_ps), "code_count": len(code_ps)},
            "OpenAPI spec declares routes the code does not implement — genuine capability gap",
            remediation("human",
                        ["implement the missing routes, or remove them from the OpenAPI spec",
                         "if spec is stale: run remediate --enable-pgla-adapt to generate openapi.adapted.yaml"],
                        [], "generate_adapted_spec"),
        ))
    undeclared = sorted(code_ps - spec_ps)
    if undeclared:
        results.append(finding(
            GATE_ID, GATE_NAME, "undeclared-route", "undeclared-capability",
            SEVERITY_LOW, CONF_MEDIUM, AUTH_TECH_DEBT,
            {"routes_in_code_not_in_spec": undeclared},
            None,
            remediation("human", ["add undeclared routes to the OpenAPI spec"]),
        ))
    return results


def _check_alembic_drift(repo: Path) -> list[dict[str, Any]]:
    result = alembic_check(repo)
    if result["drift"] is None or not result["drift"]:
        return []
    return [finding(
        GATE_ID, GATE_NAME, "alembic-migration-drift", "db-schema-drift",
        SEVERITY_HIGH, CONF_HIGH, AUTH_BLOCKER,
        {"detail": result["detail"]},
        "`alembic check` failed — database migrations are out of sync with models",
        remediation("human",
                    ["run `alembic upgrade head` or generate a new migration with `alembic revision --autogenerate`"],
                    ["alembic check", "alembic upgrade head"]),
    )]


def _check_pyproject_entrypoints(repo: Path) -> list[dict[str, Any]]:
    pp = repo / "pyproject.toml"
    if not pp.exists():
        return []
    try:
        import tomllib  # type: ignore[import-not-found]
        data = tomllib.loads(pp.read_text(encoding="utf-8"))
    except ImportError:
        try:
            import tomli  # type: ignore[import-not-found]
            data = tomli.loads(pp.read_text(encoding="utf-8"))
        except ImportError:
            return []
    except Exception:
        return []
    scripts = (data.get("project", {}) or {}).get("scripts", {}) or {}
    results: list[dict[str, Any]] = []
    for cmd, ep in scripts.items():
        mod_path = ep.split(":")[0].replace(".", "/") + ".py"
        if not (repo / mod_path).exists() and not (repo / "src" / mod_path).exists():
            results.append(finding(
                GATE_ID, GATE_NAME, "missing-entrypoint-module", "capability-gap",
                SEVERITY_HIGH, CONF_MEDIUM, AUTH_BLOCKER,
                {"command": cmd, "entrypoint": ep, "expected_path": mod_path},
                "declared [project.scripts] entrypoint module does not exist on disk",
                remediation("human",
                            [f"create {mod_path} with the `{cmd}` entrypoint function",
                             "or update pyproject.toml to point to the correct module"]),
            ))
    return results


def evaluate(evidence: dict[str, Any], ctx: dict[str, Any]) -> list[dict[str, Any]]:
    repo = ctx.get("repo")
    if repo is None:
        return []
    if not isinstance(repo, Path):
        repo = Path(repo)
    findings: list[dict[str, Any]] = []
    for check_fn in (_check_openapi_drift, _check_alembic_drift, _check_pyproject_entrypoints):
        try:
            findings.extend(check_fn(repo))
        except Exception as exc:
            findings.append(finding(
                GATE_ID, GATE_NAME, f"gate11-{check_fn.__name__}-error", "internal",
                SEVERITY_LOW, CONF_LOW, None, {"error": str(exc)[:300]},
                None, remediation("human", [f"gate11 {check_fn.__name__} crashed"]),
            ))
    return findings
