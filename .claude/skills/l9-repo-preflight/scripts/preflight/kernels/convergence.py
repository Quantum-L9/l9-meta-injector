from __future__ import annotations

import hashlib
import json
from copy import deepcopy
from typing import Any, Callable

_VOLATILE_KEYS = {'generated_at', 'timestamp', 'run_id'}


def _stable(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: _stable(item) for key, item in sorted(value.items()) if key not in _VOLATILE_KEYS}
    if isinstance(value, list):
        return [_stable(item) for item in value]
    return value


def _digest(value: Any) -> str:
    raw = json.dumps(_stable(value), sort_keys=True, separators=(',', ':'), ensure_ascii=False)
    return hashlib.sha256(raw.encode('utf-8')).hexdigest()


def converge_report(
    report: dict[str, Any], normalize: Callable[[dict[str, Any]], dict[str, Any]] | None = None,
    *, threshold: float = 0.95, max_passes: int = 5,
) -> tuple[dict[str, Any], dict[str, Any]]:
    normalize = normalize or (lambda payload: payload)
    current = deepcopy(report)
    digests: list[str] = []
    converged = False
    for pass_number in range(1, max_passes + 1):
        candidate = normalize(deepcopy(current))
        digest = _digest(candidate)
        digests.append(digest)
        if len(digests) >= 2 and digests[-1] == digests[-2]:
            current = candidate
            converged = True
            break
        current = candidate
    ratio = 1.0 if converged else 0.0
    result = {
        'status': 'converged' if converged and ratio >= threshold else 'blocked',
        'threshold': threshold,
        'passes_run': len(digests),
        'fixed_point_reached': converged,
        'final_ratio': ratio,
        'digests': digests,
    }
    return current, result
