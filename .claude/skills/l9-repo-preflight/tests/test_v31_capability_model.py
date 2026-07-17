from pathlib import Path
from preflight.v31 import run
from preflight.remediation.registry import can_claim_autofix

DEFAULT_WF = """name: x
on:
  workflow_call:
jobs: {}
"""

def wf(repo: Path, text: str = DEFAULT_WF):
    p = repo / ".github/workflows/x.yml"
    p.parent.mkdir(parents=True)
    p.write_text(text, encoding="utf-8")
    (repo / "README.md").write_text("Reusable GitHub Actions workflows", encoding="utf-8")

def test_reusable_workflow_repo_without_python_packaging_is_valid(tmp_path):
    wf(tmp_path)
    r = run(tmp_path)
    assert "reusable-workflows" in r["repository_profile"]["active_archetypes"]
    assert next(g for g in r["gates"] if g["id"] == "A-PY-01")["status"] == "not_applicable"

def test_python_package_requires_packaging_metadata(tmp_path):
    (tmp_path / "pkg.py").write_text("x=1", encoding="utf-8")
    (tmp_path / "README.md").write_text("Python package", encoding="utf-8")
    r = run(tmp_path)
    assert next(c for c in r["capability_model"]["capabilities"] if c["name"] == "installable_python_package")["status"] == "contradicted"

def test_hybrid_repo_supports_multiple_archetypes(tmp_path):
    wf(tmp_path)
    (tmp_path / "pyproject.toml").write_text('[project]\nname="x"\nversion="1"', encoding="utf-8")
    r = run(tmp_path)
    assert {"reusable-workflows", "python-package"} <= set(r["repository_profile"]["active_archetypes"])

def test_low_confidence_classification_does_not_block(tmp_path):
    (tmp_path / "README.md").write_text("misc", encoding="utf-8")
    r = run(tmp_path)
    assert all(g["status"] != "blocker" for g in r["gates"])

def test_missing_execution_capability_returns_not_observed(tmp_path):
    (tmp_path / "README.md").write_text("docs", encoding="utf-8")
    r = run(tmp_path, mode="connector")
    assert any(g["status"] == "not_observed" for g in r["gates"])
    assert r["full_preflight"] is False

def test_validation_suppression_blocks(tmp_path):
    wf(tmp_path, "name: x\non: push\njobs:\n  t:\n    steps:\n      - run: pytest || true\n")
    r = run(tmp_path)
    assert r["semantic_analysis"]["suppressions"][0]["status"] == "blocker"

def test_cleanup_suppression_is_informational(tmp_path):
    wf(tmp_path, "name: x\non: push\njobs:\n  t:\n    steps:\n      - run: pip uninstall -y x || true\n")
    r = run(tmp_path)
    assert r["semantic_analysis"]["suppressions"][0]["status"] == "warning"

def test_advisory_tool_with_enforcing_equivalent_is_acceptable(tmp_path):
    wf(tmp_path, "name: x\non: push\njobs:\n  t:\n    steps:\n      - run: ruff check .\n      - run: echo ok\n        env:\n          DISABLE_ERRORS: true\n")
    assert run(tmp_path)["semantic_analysis"]["enforcement_coverage"]["status"] == "clear"

def test_advisory_tool_without_coverage_warns(tmp_path):
    wf(tmp_path, "name: x\non: push\njobs:\n  t:\n    steps:\n      - run: echo ok\n        env:\n          DISABLE_ERRORS: true\n")
    assert run(tmp_path)["semantic_analysis"]["enforcement_coverage"]["status"] == "warning"

def test_dynamic_action_reference_is_not_autofixable(tmp_path):
    wf(tmp_path, "name: x\non: push\njobs:\n t:\n  steps:\n   - uses: org/${{ steps.x.outputs.flavor }}@v1\n")
    a = run(tmp_path)["semantic_analysis"]["action_references"][0]
    assert a["dynamic_path"] and not a["autofixable"]

def test_unregistered_remediation_cannot_claim_autofix():
    assert not can_claim_autofix("missing", {}, True)

def test_contradiction_between_docs_and_workflow_is_reported(tmp_path):
    wf(tmp_path, "name: x\non: push\njobs:\n t:\n  steps:\n   - run: pip install -e .\n")
    assert run(tmp_path)["contradictions"]

def test_findings_include_confidence_and_provenance(tmp_path):
    wf(tmp_path, "name: x\non: push\njobs:\n t:\n  steps:\n   - run: pip install .\n")
    c = run(tmp_path)["contradictions"][0]
    assert "confidence" in c and "provenance" in c
