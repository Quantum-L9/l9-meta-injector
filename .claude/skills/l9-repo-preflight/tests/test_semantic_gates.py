from pathlib import Path

from preflight.semantic.runner import evaluate_semantic_gates


def test_semantic_runner_emits_all_six_gates(tmp_path: Path) -> None:
    (tmp_path / ".github" / "workflows").mkdir(parents=True)
    (tmp_path / ".github" / "workflows" / "ci.yml").write_text(
        "name: ci\non: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@0123456789012345678901234567890123456789\n",
        encoding="utf-8",
    )
    result = evaluate_semantic_gates(tmp_path)
    assert [gate["id"] for gate in result["gates"]] == [9, 10, 11, 12, 13, 14]
    assert isinstance(result["findings"], list)
    assert isinstance(result["blockers"], list)


def test_missing_ci_is_a_gate14_blocker(tmp_path: Path) -> None:
    result = evaluate_semantic_gates(tmp_path)
    assert any(
        finding["gate"] == 14 and finding.get("authority_action") == "blocker"
        for finding in result["blockers"]
    )
