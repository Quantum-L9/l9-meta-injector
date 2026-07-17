from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Literal

EvidenceClass = Literal['observed', 'inferred', 'heuristic']
ResolutionStatus = Literal['resolved', 'candidate', 'dynamic', 'unresolved', 'contradictory']


@dataclass(frozen=True)
class RepositorySnapshot:
    repository_snapshot_id: str
    parent_snapshot_id: str | None
    source_revision: str
    source_digest: str
    index_schema_version: str
    extractor_bundle_version: str
    created_at: str

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class CoverageLedger:
    eligible_files: int
    parsed_files: int
    unsupported_files: int
    failed_files: int
    generated_files_excluded: int
    coverage_by_language: dict[str, dict[str, int]] = field(default_factory=dict)
    known_blind_spots: tuple[str, ...] = ()

    @property
    def complete(self) -> bool:
        return self.failed_files == 0 and self.unsupported_files == 0

    def as_dict(self) -> dict[str, Any]:
        result = asdict(self)
        result['known_blind_spots'] = list(self.known_blind_spots)
        result['complete'] = self.complete
        return result


@dataclass(frozen=True)
class ResolutionEdge:
    edge_id: str
    source_fact_id: str
    target_id: str | None
    relation: str
    resolution_status: ResolutionStatus
    confidence: float
    resolution_method: str
    candidate_count: int
    limitations: tuple[str, ...] = ()

    def as_dict(self) -> dict[str, Any]:
        result = asdict(self)
        result['limitations'] = list(self.limitations)
        return result
