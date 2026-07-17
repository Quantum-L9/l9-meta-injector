from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any


@dataclass(frozen=True)
class ExecutionMode:
    requested_mode: str
    resolved_mode: str
    evidence_source: str
    interactive: bool
    autonomous: bool
    remediation_allowed: bool
    packaging_requested: bool
    audit_mode: str
    reasons: tuple[str, ...]

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def route_mode(
    *, requested_mode: str, audit_mode: str, advertised: dict[str, Any] | None,
    remediation_allowed: bool = False, packaging_requested: bool = False,
) -> ExecutionMode:
    if requested_mode not in {'filesystem', 'connector'}:
        raise ValueError(f'unsupported execution mode: {requested_mode}')
    advertised = advertised or {}
    host = advertised.get('host_agent', {}) if isinstance(advertised, dict) else {}
    interactive = bool(host.get('available') or host.get('reasoning_available'))
    autonomous = bool(advertised.get('autonomous_workflow', False)) or not interactive
    resolved_audit = audit_mode
    reasons: list[str] = []
    if audit_mode == 'auto':
        resolved_audit = 'host_agent' if interactive else 'static_only'
        reasons.append('auto audit mode resolved from advertised host capability')
    if requested_mode == 'connector' and not advertised.get('mcp_bridge', {}).get('available', False):
        reasons.append('connector mode requested without direct MCP bridge; structured action requests may be required')
    return ExecutionMode(
        requested_mode=requested_mode,
        resolved_mode=requested_mode,
        evidence_source='connector' if requested_mode == 'connector' else 'filesystem',
        interactive=interactive,
        autonomous=autonomous,
        remediation_allowed=bool(remediation_allowed),
        packaging_requested=bool(packaging_requested),
        audit_mode=resolved_audit,
        reasons=tuple(reasons),
    )
