from __future__ import annotations

import json
from pathlib import Path

import pytest

from preflight.github import GitHubAdapter
from preflight.semantic.gate11_drift import _load_openapi
from preflight.v32 import run


def test_base_github_adapter_is_abstract() -> None:
    with pytest.raises(TypeError):
        GitHubAdapter()


def test_invalid_openapi_is_not_silently_ignored(tmp_path: Path) -> None:
    (tmp_path / "openapi.json").write_text("{not-json", encoding="utf-8")
    with pytest.raises(ValueError, match="openapi.json"):
        _load_openapi(tmp_path)


def test_v32_compatibility_entrypoint_reports_current_identity(tmp_path: Path) -> None:
    (tmp_path / "README.md").write_text("Documentation repository", encoding="utf-8")
    report = run(tmp_path)
    assert report["version"] == "3.5"
    assert report["versions"]["evaluator"] == "3.5"


def test_legacy_v32_schema_remains_version_locked() -> None:
    schema = json.loads(
        (Path(__file__).parents[1] / "schemas" / "preflight-v3.2-report.schema.json").read_text()
    )
    assert schema["properties"]["version"]["const"] == "3.2"
