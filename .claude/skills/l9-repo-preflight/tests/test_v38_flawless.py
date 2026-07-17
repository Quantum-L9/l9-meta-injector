from __future__ import annotations

import json
from pathlib import Path

from preflight.environment.detector import detect_environment
from preflight.v38 import run


def advertised_host() -> dict:
    return {
        "reasoning_provider": {
            "host_agent_session": True,
            "external_provider_configured": False,
            "credentials_available": False,
        },
        "mcp_bridge": {
            "state": "direct_host_tool_execution",
            "python_subprocess_access": False,
            "supported_operations": ["read_repository"],
        },
    }


def test_v38_identity_and_environment_fingerprint(tmp_path: Path) -> None:
    report = run(tmp_path, audit_mode="static_only")
    assert report["version"] == "3.8"
    assert report["versions"]["environment"] == "1.1"
    assert len(report["environment_capability_report"]["environment_fingerprint"]) == 64


def test_tool_detection_is_reused_by_environment(tmp_path: Path, monkeypatch) -> None:
    import preflight.v38 as control

    calls = 0

    def fake_discover() -> dict:
        nonlocal calls
        calls += 1
        return {
            "semgrep": {
                "tool": "semgrep",
                "capability": "multi_language_sast",
                "provider_type": "local_cli",
                "availability": "unavailable",
                "reason": "executable_not_found",
                "version": "UNKNOWN",
                "execution_supported": False,
                "supported_version_range": "UNKNOWN",
                "absence_behavior": "not_observed",
                "equivalent_evidence_allowed": True,
                "path": None,
                "version_probe_error": None,
            }
        }

    monkeypatch.setattr(control, "discover_tools", fake_discover)
    report = control.run(tmp_path, audit_mode="static_only")
    assert calls == 1
    assert report["environment_capability_report"]["execution_environment"]["python"]["optional_dependencies"] is report["tool_capabilities"]


def test_full_mode_without_advertised_provider_falls_back_static(tmp_path: Path) -> None:
    report = run(tmp_path, audit_mode="full")
    audit = report["forensic_audit"]
    assert audit["provider_resolution"]["resolved_mode"] == "static_only"
    assert audit["provider_resolution"]["invocation_attempted"] is False
    assert audit["audit_depth"] == "deterministic"


def test_host_agent_mode_emits_structured_request_without_credentials(tmp_path: Path) -> None:
    report = run(tmp_path, audit_mode="auto", advertised_capabilities=advertised_host())
    audit = report["forensic_audit"]
    assert audit["provider_resolution"]["resolved_mode"] == "host_agent"
    assert audit["reasoning"]["request_artifact"]["evidence_digest"] == audit["evidence_digest"]
    assert audit["reasoning"]["receipt"]["credentials_required"] is False


def test_write_observable_is_not_write_authorized(tmp_path: Path) -> None:
    environment = detect_environment(tmp_path)
    filesystem = environment["execution_environment"]["filesystem"]
    assert filesystem["write_observable"] is True
    assert filesystem["write_authorized"] is False


def test_runtime_dependency_uses_distribution_and_import_names(tmp_path: Path) -> None:
    environment = detect_environment(tmp_path)
    dependencies = environment["execution_environment"]["python"]["runtime_dependencies"]
    assert "PyYAML" in dependencies
    assert dependencies["PyYAML"].get("import_name") in ("yaml", None)
    assert dependencies["yaml"] == dependencies["PyYAML"]


def test_invalid_reasoning_response_missing_fields_is_rejected(tmp_path: Path) -> None:
    report = run(
        tmp_path,
        audit_mode="auto",
        advertised_capabilities=advertised_host(),
        reasoning_response={"schema_version": "1.0", "evidence_digest": "wrong"},
    )
    errors = report["forensic_audit"]["reasoning"]["response_validation"]["errors"]
    assert any(error.startswith("missing_required_fields:") for error in errors)
    assert "evidence_digest_mismatch" in errors


def test_gate_crash_emits_canonical_finding(tmp_path: Path, monkeypatch) -> None:
    import preflight.gate_registry as registry

    (tmp_path / "pyproject.toml").write_text("[project]\nname='x'\n", encoding="utf-8")
    monkeypatch.setattr(
        registry.MODULES[15],
        "evaluate",
        lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("boom")),
    )
    report = run(tmp_path, audit_mode="static_only")
    gate = next(item for item in report["extended_gate_results"] if item["gate_id"] == 15)
    assert gate["status"] == "requires_human_review"
    finding = gate["findings"][0]
    assert finding["id"] == "G15-INTERNAL-ERROR"
    assert finding["inference_type"] == "runtime_exception"


def test_v38_schema_accepts_generated_report(tmp_path: Path) -> None:
    import jsonschema

    root = Path(__file__).parents[1]
    report = run(tmp_path, audit_mode="static_only")
    schema = json.loads((root / "schemas" / "preflight-v3.8-report.schema.json").read_text())
    environment_schema = json.loads((root / "config" / "environment-capabilities.schema.json").read_text())
    schema["properties"]["environment_capability_report"] = environment_schema
    jsonschema.validate(report, schema)
