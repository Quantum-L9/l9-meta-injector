# L9 Live Native D / E — execution receipt

## Execution identity

Host: `8dd98b48be50` — Linux-6.18.38+-aarch64-with-glibc2.39; architecture `aarch64`. Commands executed directly on the host; no containers, task-created VM, Python virtual environment, Conda, pipx, Poetry environment, or `uv run`.

Python: `/usr/bin/python3`; prefix and base prefix both `/usr`. Node: `/home/ubuntu/.nvm/versions/node/v22.13.0/bin/node` (v22.23.4). Topology: `/home/ubuntu/.local/bin/l9-topology`; installed Python package locations and exact command paths are recorded in `00_execution_manifest/host-environment.json`.

| Baseline repository | Exact main SHA |
|---|---|
| l9-meta-injector | `f134e8d54dea51e94f94e6c4afb820931dbc9775` |
| l9-constellation-topology | `fa4bad38709cc64f8c1b9a548f07c000ad1f28f6` |
| L9-Ops-MCP | `e372d303ee03cefc56f0179098eb6a2ebb011257` |
| l9-cognitive-runtime | `50621935a3b745c52313f443fd802212b6a5daa9` |

## Runs

### D
Evidence: `01_ops_control/`.
RMP: `packet:56193295f2339767f85903d551518ca5a26f0b9ae2b751a4d24e9ad003fa2fb7`.
Topology: `packet:2845a3768120ba9025c93468fc264b0a6318c158f0b53c1a9961e6ad0d5d2854`.
Native producer, compile, validate, inspect, input-bound validation, determinism, complete paginated claim queries, managed-predicate retrieval, generic impact, and resolution-aware impact exit statuses: all 0.

### E0
Evidence: `02_cognitive_before/`.
RMP: `packet:16d38f637a65a0a0ca31cc7ce9537cc0b402661a38dca15f59e179d52761ea37`.
Topology: `packet:18144570fa5e160c6cd8a4e759140b4585bb0b599350f7023e6d7baaa0de875a`.
Native producer, compile, validate, inspect, input-bound validation, determinism, complete paginated claim queries, managed-predicate retrieval, generic impact, and resolution-aware impact exit statuses: all 0.

### E1
Evidence: `04_cognitive_after/`.
RMP: `packet:bf51f6b06a5c61322f0340e99c94a61ef8733f55a2254a49753b71bd168e0c82`.
Topology: `packet:e5221aee239e1d3b514a84409f9353927998f1f06f3cd9c3e27c0e8431070221`.
Native producer, compile, validate, inspect, input-bound validation, determinism, complete paginated claim queries, managed-predicate retrieval, generic impact, and resolution-aware impact exit statuses: all 0.

## Header injection

Native header source files modified: **197**. Carrier strategies: `{"line-comment": 142, "yaml-frontmatter": 55}`. Metadata support files: `.l9/meta-authority.yaml` and `.l9/metadata-index.jsonl`; total PR files: **199**.
Branch: `feat/repo-wide-native-metadata-headers`.
Exact injection/E1 commit: `38ce9402d980a88db149ea78433a27fbafbe5324`.
PR: https://github.com/Quantum-L9/l9-cognitive-runtime/pull/69 — **OPEN, not merged**.

Native apply and post-injection check exited 0. Planned file hashes matched. Carrier-free body text, modes, and all non-target baseline files matched. No source changes followed E1. No canonical L9 semantic authority was admitted.

## Failed or non-zero attempts

The first native topology installation exited 1: the old host setuptools could not parse the declared license format. The native backend installation and retry exited 0. Logs are under `00_execution_manifest/`.

The injector check before its required writer declaration exited 1 (missing authority). The proposed read-only write-plan check exited 1 because metadata was not yet present; it reported zero authority conflicts. Native apply and its post-check both exited 0. Logs are under `03_header_injection/injection-plan/`.

Cognitive Runtime repository local gates: Ruff lint 0, Ruff format 0, pytest 0, mypy 2. Mypy stopped at a host-installed NumPy stub: Python 3.12 type statement while the repository target is Python 3.11. No remediation was performed. Full output is in `03_header_injection/native-local-gates/mypy.stdout.log`.

The initial mechanical body-capture adapter failed because an argument was omitted; its corrected capture exited 0. Both logs are preserved. No producer, consumer, or source code was changed for the correction. Initial PR file-count capture encountered the abbreviated gh projection; the paginated API capture preserves all 199 actual PR files.

The producer/direct CLI help probes returned their documented usage exit 2 and did not emit or mutate anything. Those raw usage outputs are preserved.

## Integrity and delivery

Archive: `L9_LIVE_NATIVE_RUN_D_E.zip`. Manifest: `05_integrity/evidence-manifest.json`. SHA-256 inventory: `00_execution_manifest/sha256sums.txt`. Every original packet, payload, native receipt, query page, impact result, command log, declaration ledger, file hash, and complete Git patch is included without truncation.

Source mutation boundary: Cognitive Runtime feature branch only—197 injector-written header files plus required writer configuration and central metadata index. Ops control, Meta Injector, and Topology source remained unchanged. No PR merge, topology publication, persistent-memory write, semantic comparison, architectural analysis, scoring, or recommendation was performed.

Context window usage: Unknown.
