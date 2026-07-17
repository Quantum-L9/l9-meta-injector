"""Unit/integration: technical-debt dedup + report persistence determinism."""

from __future__ import annotations

from pathlib import Path

from preflight import reports, techdebt


def test_technical_debt_is_deduplicated(tmp_path: Path):
    (tmp_path / "a.py").write_text("x = 1  # TODO fix\n# TODO fix\n")
    findings = techdebt.detect(tmp_path)
    todos = [f for f in findings if f["category"] == "TODO_FIXME_HACK_markers"]
    # two distinct lines -> two findings, but identical (path,line,evidence) never duplicated
    keys = {(f["path"], f.get("line"), f["evidence"]) for f in todos}
    assert len(keys) == len(todos)


def test_technical_debt_has_evidence_and_path(tmp_path: Path):
    (tmp_path / "b.py").write_text("y = 2  # FIXME later\n")
    findings = techdebt.detect(tmp_path)
    f = next(f for f in findings if f["category"] == "TODO_FIXME_HACK_markers")
    assert f["path"] == "b.py" and f["line"] == 1 and f["evidence"]


def test_missing_validation_is_blocking(tmp_path: Path):
    (tmp_path / "x.py").write_text("z = 3\n")
    findings = techdebt.detect(tmp_path)
    mv = [f for f in findings if f["category"] == "missing_validation"]
    assert mv and mv[0]["blocking"] is True


def _persist(tmp_path, blockers):
    acct = {
        "unresolved_blockers": blockers,
        "resolved": [],
        "not_applicable": [],
        "blocker_count": len(blockers),
        "overall_status": "blocked" if blockers else "ready",
    }
    return reports.persist(
        tmp_path / "docs" / "preflight",
        run_id="rid",
        timestamp="T",
        source_commit="sha",
        tool_version="2.1.0",
        evaluate_report={"gates": [], "autofix_plans": []},
        autofix_actions=[],
        accounting=acct,
        techdebt=[],
    ), acct


def test_reports_written_to_docs_preflight(tmp_path: Path):
    paths, _ = _persist(tmp_path, [])
    names = {Path(p).name for p in paths}
    assert names == set(reports.REQUIRED)
    for p in paths:
        assert Path(p).is_file()
        assert "docs/preflight" in p.replace("\\", "/")


def test_report_ordering_is_deterministic(tmp_path: Path):
    blockers = [{"id": "BLK-b"}, {"id": "BLK-a"}, {"id": "BLK-c"}]
    _persist(tmp_path, blockers)
    text = (tmp_path / "docs" / "preflight" / "blockers.yaml").read_text()
    assert text.index("BLK-a") < text.index("BLK-b") < text.index("BLK-c")


def test_secrets_are_redacted_in_reports(tmp_path: Path):
    blk = [{"id": "BLK-x", "evidence": {"error": "token=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345"}}]
    _persist(tmp_path, blk)
    text = (tmp_path / "docs" / "preflight" / "blockers.yaml").read_text()
    assert "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345" not in text
    assert "REDACTED" in text
