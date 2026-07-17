from __future__ import annotations

import json
from pathlib import Path

from preflight.remediation.registry import ranked_remediations
from preflight.semantic.action_reference_analyzer import analyze
from preflight.semantic.shell_command_classifier import classify
from preflight.v35 import VERSIONS, run

ROOT = Path(__file__).parents[1]
FIXTURE = ROOT / "tests" / "fixtures" / "l9-ci-core-mcp-evidence"


def gate(report: dict, gate_id: str) -> dict:
    return next(item for item in report["gates"] if item["id"] == gate_id)


def test_explicit_version_identity() -> None:
    report = run(FIXTURE, mode="connector")
    assert report["version"] == "3.5"
    assert report["versions"] == VERSIONS
    schema = json.loads((ROOT / "schemas" / "preflight-v3.5-report.schema.json").read_text())
    assert schema["properties"]["version"]["const"] == "3.5"
    assert schema["properties"]["versions"]["properties"]["provider"]["const"] == "3.3"


def test_l9_ci_core_mcp_fixture_is_repo_type_agnostic_and_honest() -> None:
    report = run(FIXTURE, mode="connector")
    assert "reusable-workflows" in report["repository_profile"]["active_archetypes"]
    assert gate(report, "A-PY-01")["status"] == "not_applicable"
    assert report["full_preflight"] is False
    assert report["contradictions"]


def test_semantic_results_drive_u07_and_u08() -> None:
    report = run(FIXTURE, mode="connector")
    assert gate(report, "U07")["status"] == "clear"
    assert gate(report, "U08")["status"] == "warning"
    assert gate(report, "U08")["evidence"]["mutable_action_references"]


def test_validation_suppression_drives_u07_blocker(tmp_path: Path) -> None:
    workflow = tmp_path / ".github" / "workflows" / "ci.yml"
    workflow.parent.mkdir(parents=True)
    workflow.write_text("name: ci\non: push\njobs:\n t:\n  steps:\n   - run: pytest || true\n")
    (tmp_path / "README.md").write_text("workflow repository")
    assert gate(run(tmp_path), "U07")["status"] == "blocker"


def test_python_module_wrapper_is_normalized_before_classification() -> None:
    item = classify("- run: python -m pip uninstall -y l9-ci || true")
    assert item["normalized_command"] == "pip uninstall -y l9-ci"
    assert item["kind"] == "cleanup"


def test_complete_dynamic_uses_expression_is_preserved() -> None:
    workflows = [{
        "path": ".github/workflows/ci.yml",
        "text": "- uses: oxsecurity/megalinter/flavors/${{ inputs.megalinter-flavor }}@v8 # mutable\n",
    }]
    item = analyze(workflows)[0]
    assert item["action_ref"] == "oxsecurity/megalinter/flavors/${{ inputs.megalinter-flavor }}@v8"
    assert item["dynamic_path"] is True


def test_structural_remediation_precedes_exception() -> None:
    assert ranked_remediations([
        "governed_action_pin_exception",
        "redesign_dynamic_action_reference",
    ]) == ["redesign_dynamic_action_reference", "governed_action_pin_exception"]
    item = run(FIXTURE, mode="connector")["semantic_analysis"]["action_references"][0]
    assert item["remediation_id"] == "redesign_dynamic_action_reference"
    assert "governed exception" in item["recommended_changes"][-1]
