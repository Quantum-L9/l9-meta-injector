"""Shared path planner — maps each file to proposed output_path."""
import os

def plan(rel_path, suggested_dir, threshold, conf, filename):
    """Return output_path; route to unknown bucket if below threshold."""
    if conf < threshold:
        suggested_dir = "99_CONFLICTS_AND_UNKNOWN/low-confidence"
    return os.path.join(suggested_dir, filename)
