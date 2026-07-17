"""Gate 13 — Launch Blocker Aggregation & Severity Ranking (fail-open)."""
from __future__ import annotations

from typing import Any

GATE_ID = 13
GATE_NAME = "launch-blocker-aggregation"

_SEV_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3}


def _key(f: dict) -> str:
    return f.get("id") or f"{f.get('gate')}:{f.get('class')}:{str(f.get('evidence', {}))[:64]}"


def aggregate(all_findings: list[dict[str, Any]], sections: dict[str, Any]) -> list[dict[str, Any]]:
    """De-duplicate and rank all findings; emit a single Gate 13 summary finding."""
    seen: dict[str, dict] = {}
    for f in all_findings:
        k = _key(f)
        if k not in seen:
            seen[k] = f

    deduped = sorted(seen.values(), key=lambda f: (_SEV_ORDER.get(f.get("severity", "low"), 3),
                                                    f.get("gate", 99)))
    critical = [f for f in deduped if f.get("severity") == "critical"
                and f.get("authority_action") == "blocker"]
    high = [f for f in deduped if f.get("severity") == "high"
            and f.get("authority_action") == "blocker"]
    medium = [f for f in deduped if f.get("severity") == "medium"
              and f.get("authority_action") == "blocker"]

    # Go-live verdict: only CRITICAL blockers prevent launch.
    # High/medium are important but non-blocking (require human sign-off if present).
    ready = len(critical) == 0
    total = len(deduped)

    top_5 = [
        {
            "id": f.get("id"), "gate": f.get("gate"), "severity": f.get("severity"),
            "class": f.get("class"),
            "remediation": ((f.get("remediation") or {}).get("steps") or ["see blocker details"])[0][:120],
        }
        for f in (critical + high)[:5]
    ]

    return [{
        "id": f"BLK-{GATE_ID}-{GATE_NAME.split()[0].replace('/', '-')}",
        "gate": GATE_ID,
        "gate_name": GATE_NAME,
        "class": "launch-readiness-summary",
        "subclass": "aggregation",
        "severity": "critical" if critical else ("high" if high else "low"),
        "confidence": "high",
        "authority_action": None,  # Gate 13 is informational — not itself a blocker
        "why_not_autofixable": None,
        "evidence": {
            "ready_for_go_live": ready,
            "critical_blockers": len(critical),
            "high_count": len(high),
            "medium_count": len(medium),
            "total_findings": total,
            "top_blockers": top_5,
        },
        "remediation": {"owner": "human",
                        "steps": ["resolve critical blockers before go-live"],
                        "commands": [], "auto_option": None},
        "autofix_applied": False,
        "autofix_plan": None,
        "adapted_artifact_path": None,
    }]
