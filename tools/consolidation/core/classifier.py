"""Shared classifier — domain hints, artifact_type, confidence. Domain-neutral core."""

DOMAIN_HINTS = {
    "constellation":   ("architecture",  "constellation",   "01_ARCHITECTURE/constellation",    0.85),
    "packet":          ("architecture",  "packet-envelope", "01_ARCHITECTURE/packet-envelope",   0.85),
    "chassis":         ("architecture",  "chassis",         "01_ARCHITECTURE/chassis",           0.85),
    "control-plane":   ("architecture",  "control-plane",   "01_ARCHITECTURE/control-plane",     0.85),
    "registration":    ("contract",      "node-contracts",  "02_NODE_CONTRACTS/registration",    0.82),
    "node_contract":   ("contract",      "node-contracts",  "02_NODE_CONTRACTS",                 0.80),
    "infrastructure":  ("infra",         "infrastructure",  "04_INFRASTRUCTURE",                 0.80),
    "template":        ("template",      "generic",         "05_TEMPLATES_AND_SKILLS/templates", 0.78),
    "skill":           ("skill",         "generic",         "05_TEMPLATES_AND_SKILLS/skills",    0.78),
}

def classify(rel_path, text_sample="", extra_hints=None):
    """
    Returns (artifact_type, domain, suggested_output_dir, confidence).
    extra_hints: dict matching DOMAIN_HINTS format for domain-specific adapters.
    """
    hints = dict(DOMAIN_HINTS)
    if extra_hints:
        hints.update(extra_hints)
    low = (rel_path + " " + text_sample).lower()
    for key, (atype, domain, dest, conf) in hints.items():
        if key in low:
            return atype, domain, dest, conf
    return "unknown", "generic", "99_CONFLICTS_AND_UNKNOWN/low-confidence", 0.40
