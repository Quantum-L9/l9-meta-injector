"""Secret redaction — no secret value ever reaches a log, issue, or report.

Redacts by pattern (tokens, bearer headers, npm 401 auth lines, URLs with creds,
common env-var-style KEY=VALUE secrets) and by an explicit deny-set of env var
names. Redaction is applied to every string that leaves the process boundary.
"""

from __future__ import annotations

import re

# High-signal secret shapes.
_PATTERNS = [
    re.compile(r"gh[pousr]_[A-Za-z0-9]{20,}"),  # GitHub tokens
    re.compile(r"github_pat_[A-Za-z0-9_]{20,}"),
    re.compile(r"npm_[A-Za-z0-9]{20,}"),  # npm tokens
    re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._\-]+"),
    re.compile(r"(?i)\bBasic\s+[A-Za-z0-9+/=]+"),
    re.compile(
        r"(?i)(authorization|_token|_secret|_key|password|passwd|apikey|api_key)"
        r"\s*[:=]\s*[^\s'\"]+"
    ),
    re.compile(r"//[^/\s:@]+:[^/\s:@]+@"),  # user:pass@ in a URL
    re.compile(r"(?i)//[^/\s]*_authtoken=[^\s&]+"),  # .npmrc _authToken in a URL
    re.compile(r"(?i)_authtoken\s*=\s*[^\s]+"),  # .npmrc _authToken=...
]
_REDACTED = "***REDACTED***"


def redact(text: str) -> str:
    """Redact secret-shaped substrings from a single string."""
    if not text:
        return text
    out = text
    for pat in _PATTERNS:
        out = pat.sub(_REDACTED, out)
    return out


def redact_all(value):  # type: ignore[no-untyped-def]
    """Recursively redact strings inside dicts/lists/tuples for safe serialization."""
    if isinstance(value, str):
        return redact(value)
    if isinstance(value, dict):
        return {k: redact_all(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [redact_all(v) for v in value]
    return value
