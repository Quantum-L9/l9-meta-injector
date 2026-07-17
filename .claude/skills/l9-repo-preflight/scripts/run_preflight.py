#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from preflight.v42 import run


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Portable L9 repository preflight v4.2")
    parser.add_argument("repo", nargs="?", default=".")
    parser.add_argument("--mode", choices=("filesystem", "connector"), default="filesystem")
    parser.add_argument(
        "--audit-mode",
        choices=("auto", "host_agent", "external_provider", "static_only", "disabled", "pr"),
        default="auto",
    )
    parser.add_argument("--autonomous", action="store_true", help="Force autonomous workflow behavior; Gate 20B falls back to static unless an external provider is configured.")
    parser.add_argument("--reasoning-response", help="Path to a Gate 20B reasoning response JSON for the second pass.")
    parser.add_argument("--repository")
    parser.add_argument("--pr-number", type=int)
    parser.add_argument("--output")
    parser.add_argument("--artifact-dir")
    parser.add_argument("--allow-remediation", action="store_true")
    parser.add_argument("--package-requested", action="store_true")
    parser.add_argument("--environment-output")
    parser.add_argument("--advertised-capabilities")
    arguments = parser.parse_args()

    advertised = (
        json.loads(Path(arguments.advertised_capabilities).read_text(encoding="utf-8"))
        if arguments.advertised_capabilities
        else None
    )
    reasoning_response = (
        json.loads(Path(arguments.reasoning_response).read_text(encoding="utf-8"))
        if arguments.reasoning_response
        else None
    )
    report = run(
        Path(arguments.repo).resolve(),
        mode=arguments.mode,
        audit_mode=arguments.audit_mode,
        repository=arguments.repository,
        pr_number=arguments.pr_number,
        advertised_capabilities=advertised,
        remediation_allowed=arguments.allow_remediation,
        packaging_requested=arguments.package_requested,
        reasoning_response=reasoning_response,
        autonomous=arguments.autonomous,
    )
    serialized = json.dumps(report, indent=2, sort_keys=True)
    if arguments.output:
        _write_json(Path(arguments.output), report)
    else:
        print(serialized)

    environment_output = (
        Path(arguments.environment_output)
        if arguments.environment_output
        else Path(arguments.output).with_name("environment-capability-report.json")
        if arguments.output
        else None
    )
    if environment_output:
        _write_json(environment_output, report["environment_capability_report"])

    if arguments.artifact_dir:
        artifact_dir = Path(arguments.artifact_dir)
        snapshot = report.get('semantic_snapshot', {})
        _write_json(artifact_dir / 'semantic-snapshot.json', snapshot)
        _write_json(artifact_dir / 'semantic-coverage.json', snapshot.get('coverage_ledger', {}))
        _write_json(artifact_dir / 'semantic-resolution-graph.json', report.get('semantic_resolution_graph', {}))
        _write_json(artifact_dir / 'semantic-delta.json', report.get('semantic_delta', {}))
        with (artifact_dir / 'semantic-evidence.jsonl').open('w', encoding='utf-8') as stream:
            for fact in snapshot.get('facts', []):
                stream.write(json.dumps(fact, sort_keys=True) + '\n')
        _write_json(artifact_dir / "gate20-static.json", report["forensic_audit"]["static"])
        request = report["forensic_audit"]["reasoning"].get("request_artifact")
        if request is not None:
            _write_json(artifact_dir / "gate20-reasoning-request.json", request)
        response = report["forensic_audit"]["reasoning"].get("response")
        if response is not None:
            _write_json(artifact_dir / "gate20-reasoning-response.json", response)
        _write_json(artifact_dir / "gate20-forensic-audit.json", report["forensic_audit"])

    return 1 if any(finding.get("status") == "blocker" for finding in report.get("findings", [])) else 0


if __name__ == "__main__":
    raise SystemExit(main())
