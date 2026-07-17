from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from preflight.forensic.gate20 import evaluate
from preflight.providers.reasoning import canonical_digest
from preflight.v42 import run


def _environment(host: bool = True) -> dict:
    return {
        "execution_environment": {
            "reasoning_provider": {
                "host_agent_session": host,
                "external_provider_configured": False,
                "credentials_available": False,
            }
        }
    }


def _response(digest: str, ids: list[str]) -> dict:
    return {
        "schema_version": "1.0",
        "evidence_digest": digest,
        "conclusions": [{"summary": "All findings synthesized.", "supported_by": ids}],
        "prioritized_actions": [{"priority": 1, "action": "Fix surfaced findings.", "addresses": ids, "rationale": "Complete synthesis."}],
        "challenged_findings": [],
        "unresolved_questions": [],
        "confidence": 0.9,
        "references_to_known_finding_ids": ids,
    }


def test_gate20_reasoning_can_cite_semantic_and_synthesis_findings(tmp_path: Path) -> None:
    semantic = {"id": "SEM-ACT-1", "gate_id": 14, "status": "warning", "remediation_id_or_recommended_change": "pin"}
    extended = {"id": "G16-HEALTH", "gate_id": 16, "status": "blocker", "remediation_id_or_recommended_change": "health"}
    first = evaluate(tmp_path, {}, [{"gate_id": 16, "findings": [extended]}], {"complete_tree": True}, mode="host_agent", environment=_environment(), all_findings=[semantic, extended])
    ids = first["reasoning"]["request_artifact"]["finding_ids"]
    assert "SEM-ACT-1" in ids
    assert "G16-HEALTH" in ids
    assert "G20-SYNTHESIS" in ids
    response = _response(first["evidence_digest"], ids)
    second = evaluate(tmp_path, {}, [{"gate_id": 16, "findings": [extended]}], {"complete_tree": True}, mode="host_agent", environment=_environment(), reasoning_response=response, all_findings=[semantic, extended])
    assert second["reasoning"]["executed"] is True
    assert second["reasoning"]["response_validation"] == {"valid": True, "errors": []}


def test_reasoning_receipt_is_completed_after_valid_response(tmp_path: Path) -> None:
    finding = {"id": "G16-HEALTH", "gate_id": 16, "status": "blocker", "remediation_id_or_recommended_change": "health"}
    first = evaluate(tmp_path, {}, [{"gate_id": 16, "findings": [finding]}], {"complete_tree": True}, mode="host_agent", environment=_environment(), all_findings=[finding])
    response = _response(first["evidence_digest"], first["reasoning"]["request_artifact"]["finding_ids"])
    second = evaluate(tmp_path, {}, [{"gate_id": 16, "findings": [finding]}], {"complete_tree": True}, mode="host_agent", environment=_environment(), reasoning_response=response, all_findings=[finding])
    receipt = second["reasoning"]["receipt"]
    assert receipt["validation_status"] == "validated"
    assert receipt["action"] == "llm_audit_completed"
    assert receipt["response_digest"] == canonical_digest(response)
    assert receipt["model_identity"] == "active_host_agent"


def test_interactive_default_enables_host_agent_and_autonomous_defaults_static(tmp_path: Path) -> None:
    (tmp_path / "README.md").write_text("# test\n", encoding="utf-8")
    interactive = run(tmp_path, autonomous=False)
    assert interactive["forensic_audit"]["provider_resolution"]["resolved_mode"] == "host_agent"
    assert interactive["forensic_audit"]["reasoning"]["reason"] == "host_action_required"
    autonomous = run(tmp_path, autonomous=True)
    assert autonomous["forensic_audit"]["provider_resolution"]["resolved_mode"] == "static_only"


def test_semantic_action_findings_have_gate_14(tmp_path: Path) -> None:
    workflow = tmp_path / ".github" / "workflows" / "ci.yml"
    workflow.parent.mkdir(parents=True)
    workflow.write_text("jobs:\n  lint:\n    steps:\n      - uses: actions/checkout@v4\n", encoding="utf-8")
    report = run(tmp_path, autonomous=True)
    findings = [f for f in report["findings"] if f["id"].startswith("SEM-ACT-")]
    assert findings
    assert all(f["gate_id"] == 14 and f["gate_name"] == "ci-integrity" for f in findings)


def test_cli_accepts_reasoning_response_argument() -> None:
    result = subprocess.run([sys.executable, "scripts/run_preflight.py", "--help"], capture_output=True, text=True, check=False)
    assert result.returncode == 0
    assert "--reasoning-response" in result.stdout
    assert "--autonomous" in result.stdout
