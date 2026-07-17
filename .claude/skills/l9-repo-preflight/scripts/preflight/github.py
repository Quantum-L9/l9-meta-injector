"""MCP-first GitHub provider adapters with explicit, governed CLI fallback.

Remote GitHub effects MUST prefer an injected MCP executor. Standalone execution
without an executor emits evidence-bearing MCP action requests rather than
pretending an operation occurred. The ``gh`` CLI may fill only a declared MCP
capability gap and only when fallback is explicitly enabled.

Fallback is forbidden for authentication, authorization, policy, validation,
rate-limit, or transient provider failures. Every receipt records the provider
path and any fallback reason.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from abc import ABC, abstractmethod
from collections.abc import Callable, Iterable
from typing import Any

McpExecutor = Callable[[str, dict[str, Any]], dict[str, Any]]

OPERATIONS = frozenset(
    {
        "ensure_labels",
        "open_pr",
        "find_pr",
        "search_issues",
        "create_issue",
        "update_issue",
        "pr_status",
    }
)

# Only these statuses prove a connector capability gap. Everything else must
# remain visible and must not be bypassed with CLI.
MCP_FALLBACK_STATUSES = frozenset({"unsupported_capability", "connector_unavailable"})


class GitHubAdapter(ABC):
    """Typed provider contract for remote GitHub operations."""

    dry_run = True
    name = "base"

    def capability(self, operation: str) -> bool:
        return operation in OPERATIONS

    @abstractmethod
    def ensure_labels(self, repo: str, labels: list[str]) -> dict[str, Any]:
        """Ensure labels or return an evidence-bearing request/receipt."""

    @abstractmethod
    def open_pr(self, repo: str, head: str, base: str, title: str, body: str) -> dict[str, Any]:
        """Open a pull request or return an evidence-bearing request/receipt."""

    @abstractmethod
    def find_pr(self, repo: str, head: str) -> dict[str, Any] | None:
        """Find an existing pull request."""

    @abstractmethod
    def search_issues(self, repo: str, dedupe_key: str) -> list[dict[str, Any]]:
        """Search issues by stable dedupe key."""

    @abstractmethod
    def create_issue(self, repo: str, title: str, body: str, labels: list[str]) -> dict[str, Any]:
        """Create an issue or return an evidence-bearing request/receipt."""

    @abstractmethod
    def update_issue(self, repo: str, number: int, body: str, reopen: bool) -> dict[str, Any]:
        """Update an issue or return an evidence-bearing request/receipt."""

    @abstractmethod
    def pr_status(self, repo: str, number: int) -> dict[str, Any]:
        """Read pull-request checks and review state."""


class DryRunAdapter(GitHubAdapter):
    """Perform no remote effect and record deterministic intents."""

    dry_run = True
    name = "dry-run"

    def __init__(self, state: dict[str, Any] | None = None) -> None:
        self.state = state or {}
        self.intents: list[dict[str, Any]] = []

    def _record(self, effect: str, **kw: Any) -> dict[str, Any]:
        receipt = {
            "ok": True,
            "effect": effect,
            "dry_run": True,
            "provider": self.name,
            "provider_path": [self.name],
            **kw,
        }
        self.intents.append(receipt)
        return receipt

    def ensure_labels(self, repo: str, labels: list[str]) -> dict[str, Any]:
        return self._record("ensure_labels", repo=repo, labels=labels)

    def open_pr(self, repo: str, head: str, base: str, title: str, body: str) -> dict[str, Any]:
        return self._record("open_pr", repo=repo, head=head, base=base, title=title)

    def find_pr(self, repo: str, head: str) -> dict[str, Any] | None:
        return self.state.get("prs", {}).get(head)

    def search_issues(self, repo: str, dedupe_key: str) -> list[dict[str, Any]]:
        return [i for i in self.state.get("issues", []) if i.get("dedupe_key") == dedupe_key]

    def create_issue(self, repo: str, title: str, body: str, labels: list[str]) -> dict[str, Any]:
        return self._record("create_issue", repo=repo, title=title, labels=labels)

    def update_issue(self, repo: str, number: int, body: str, reopen: bool) -> dict[str, Any]:
        return self._record("update_issue", repo=repo, number=number, reopen=reopen)

    def pr_status(self, repo: str, number: int) -> dict[str, Any]:
        return self.state.get("pr_status", {"checks": "unknown", "reviews": []})


class GitHubMcpAdapter(GitHubAdapter):
    """Use a host-injected GitHub MCP executor.

    When no executor is available, return a structured ``mcp_action_required``
    request. This is an honest handoff to the ChatGPT agent/tool host, not a
    claimed remote effect.
    """

    dry_run = False
    name = "github-mcp"

    def __init__(
        self,
        executor: McpExecutor | None = None,
        capabilities: Iterable[str] | None = None,
    ) -> None:
        self.executor = executor
        self.capabilities = frozenset(capabilities or OPERATIONS)
        unknown = self.capabilities - OPERATIONS
        if unknown:
            raise ValueError(f"unknown MCP capabilities: {sorted(unknown)}")

    def capability(self, operation: str) -> bool:
        return operation in self.capabilities

    def _invoke(self, operation: str, payload: dict[str, Any]) -> dict[str, Any]:
        if operation not in self.capabilities:
            return {
                "ok": False,
                "effect": operation,
                "status": "unsupported_capability",
                "provider": self.name,
                "provider_path": [self.name],
                "dry_run": False,
                "payload": payload,
            }
        if self.executor is None:
            return {
                "ok": False,
                "effect": operation,
                "status": "mcp_action_required",
                "provider": self.name,
                "provider_path": [self.name],
                "dry_run": False,
                "mcp_request": {"operation": operation, "arguments": payload},
            }
        result = self.executor(operation, payload)
        if not isinstance(result, dict):
            raise TypeError("MCP executor must return a receipt mapping")
        return {
            "effect": operation,
            "provider": self.name,
            "provider_path": [self.name],
            "dry_run": False,
            **result,
        }

    def ensure_labels(self, repo: str, labels: list[str]) -> dict[str, Any]:
        return self._invoke("ensure_labels", {"repo": repo, "labels": labels})

    def open_pr(self, repo: str, head: str, base: str, title: str, body: str) -> dict[str, Any]:
        return self._invoke(
            "open_pr",
            {"repo": repo, "head": head, "base": base, "title": title, "body": body},
        )

    def find_pr(self, repo: str, head: str) -> dict[str, Any] | None:
        result = self._invoke("find_pr", {"repo": repo, "head": head})
        return result.get("item") if result.get("ok") else result

    def search_issues(self, repo: str, dedupe_key: str) -> list[dict[str, Any]]:
        result = self._invoke("search_issues", {"repo": repo, "dedupe_key": dedupe_key})
        if result.get("ok"):
            return list(result.get("items", []))
        return [result]

    def create_issue(self, repo: str, title: str, body: str, labels: list[str]) -> dict[str, Any]:
        return self._invoke(
            "create_issue", {"repo": repo, "title": title, "body": body, "labels": labels}
        )

    def update_issue(self, repo: str, number: int, body: str, reopen: bool) -> dict[str, Any]:
        return self._invoke(
            "update_issue", {"repo": repo, "number": number, "body": body, "reopen": reopen}
        )

    def pr_status(self, repo: str, number: int) -> dict[str, Any]:
        return self._invoke("pr_status", {"repo": repo, "number": number})


class GhCliAdapter(GitHubAdapter):
    """Gap-only fallback through ``gh``. Never select as the primary provider."""

    dry_run = False
    name = "gh-cli-fallback"

    @staticmethod
    def available() -> bool:
        return shutil.which("gh") is not None

    def _gh(self, args: list[str]) -> tuple[int, str]:
        process = subprocess.run(["gh", *args], capture_output=True, text=True, check=False)
        return process.returncode, (process.stdout or "") + (process.stderr or "")

    @staticmethod
    def _receipt(operation: str, rc: int, output: str, **extra: Any) -> dict[str, Any]:
        return {
            "ok": rc == 0,
            "effect": operation,
            "provider": GhCliAdapter.name,
            "provider_path": [GhCliAdapter.name],
            "dry_run": False,
            "output": output,
            **extra,
        }

    def ensure_labels(self, repo: str, labels: list[str]) -> dict[str, Any]:
        outputs = []
        ok = True
        for label in labels:
            rc, out = self._gh(["label", "create", label, "--repo", repo, "--force"])
            ok = ok and rc == 0
            outputs.append(out)
        return self._receipt("ensure_labels", 0 if ok else 1, "".join(outputs), labels=labels)

    def open_pr(self, repo: str, head: str, base: str, title: str, body: str) -> dict[str, Any]:
        rc, out = self._gh(
            ["pr", "create", "--repo", repo, "--head", head, "--base", base, "--title", title, "--body", body]
        )
        return self._receipt("open_pr", rc, out, head=head)

    def find_pr(self, repo: str, head: str) -> dict[str, Any] | None:
        rc, out = self._gh(["pr", "list", "--repo", repo, "--head", head, "--state", "all", "--json", "number,url,state"])
        if rc != 0 or not out.strip():
            return None
        try:
            items = json.loads(out)
        except json.JSONDecodeError:
            return None
        return items[0] if items else None

    def search_issues(self, repo: str, dedupe_key: str) -> list[dict[str, Any]]:
        rc, out = self._gh(["issue", "list", "--repo", repo, "--state", "all", "--search", dedupe_key, "--json", "number,title,state,body"])
        if rc != 0 or not out.strip():
            return []
        try:
            return list(json.loads(out))
        except json.JSONDecodeError:
            return []

    def create_issue(self, repo: str, title: str, body: str, labels: list[str]) -> dict[str, Any]:
        args = ["issue", "create", "--repo", repo, "--title", title, "--body", body]
        for label in labels:
            args += ["--label", label]
        rc, out = self._gh(args)
        return self._receipt("create_issue", rc, out)

    def update_issue(self, repo: str, number: int, body: str, reopen: bool) -> dict[str, Any]:
        rc, out = self._gh(["issue", "comment", str(number), "--repo", repo, "--body", body])
        if reopen and rc == 0:
            reopen_rc, reopen_out = self._gh(["issue", "reopen", str(number), "--repo", repo])
            rc = reopen_rc
            out += reopen_out
        return self._receipt("update_issue", rc, out, number=number)

    def pr_status(self, repo: str, number: int) -> dict[str, Any]:
        rc, out = self._gh(["pr", "view", str(number), "--repo", repo, "--json", "statusCheckRollup,reviewDecision,reviews"])
        if rc != 0:
            return self._receipt("pr_status", rc, out)
        try:
            data = json.loads(out)
        except json.JSONDecodeError:
            return self._receipt("pr_status", 1, out, status="invalid_provider_response")
        return {"ok": True, "provider": self.name, "provider_path": [self.name], **data}


class McpFirstAdapter(GitHubAdapter):
    """Route to MCP first and use CLI only for proven connector gaps."""

    dry_run = False
    name = "mcp-first"

    def __init__(
        self,
        mcp: GitHubMcpAdapter,
        cli: GhCliAdapter | None = None,
        *,
        allow_cli_fallback: bool = False,
    ) -> None:
        self.mcp = mcp
        self.cli = cli
        self.allow_cli_fallback = allow_cli_fallback

    def capability(self, operation: str) -> bool:
        return self.mcp.capability(operation) or bool(self.cli and self.cli.capability(operation))

    def _route(self, operation: str, mcp_call: Callable[[], Any], cli_call: Callable[[], Any]) -> Any:
        result = mcp_call()
        status = result.get("status") if isinstance(result, dict) else None
        if status not in MCP_FALLBACK_STATUSES:
            return result
        if not self.allow_cli_fallback:
            return result
        if self.cli is None or not self.cli.available() or not self.cli.capability(operation):
            return result
        fallback = cli_call()
        if isinstance(fallback, dict):
            fallback["provider_path"] = [self.mcp.name, self.cli.name]
            fallback["fallback_reason"] = status
            fallback["mcp_receipt"] = result
        return fallback

    def ensure_labels(self, repo: str, labels: list[str]) -> dict[str, Any]:
        return self._route("ensure_labels", lambda: self.mcp.ensure_labels(repo, labels), lambda: self.cli.ensure_labels(repo, labels))

    def open_pr(self, repo: str, head: str, base: str, title: str, body: str) -> dict[str, Any]:
        return self._route("open_pr", lambda: self.mcp.open_pr(repo, head, base, title, body), lambda: self.cli.open_pr(repo, head, base, title, body))

    def find_pr(self, repo: str, head: str) -> dict[str, Any] | None:
        return self._route("find_pr", lambda: self.mcp.find_pr(repo, head), lambda: self.cli.find_pr(repo, head))

    def search_issues(self, repo: str, dedupe_key: str) -> list[dict[str, Any]]:
        result = self.mcp.search_issues(repo, dedupe_key)
        gap = len(result) == 1 and result[0].get("status") in MCP_FALLBACK_STATUSES
        if gap and self.allow_cli_fallback and self.cli is not None and self.cli.available():
            return self.cli.search_issues(repo, dedupe_key)
        return result

    def create_issue(self, repo: str, title: str, body: str, labels: list[str]) -> dict[str, Any]:
        return self._route("create_issue", lambda: self.mcp.create_issue(repo, title, body, labels), lambda: self.cli.create_issue(repo, title, body, labels))

    def update_issue(self, repo: str, number: int, body: str, reopen: bool) -> dict[str, Any]:
        return self._route("update_issue", lambda: self.mcp.update_issue(repo, number, body, reopen), lambda: self.cli.update_issue(repo, number, body, reopen))

    def pr_status(self, repo: str, number: int) -> dict[str, Any]:
        return self._route("pr_status", lambda: self.mcp.pr_status(repo, number), lambda: self.cli.pr_status(repo, number))


def get_adapter(
    *,
    dry_run: bool,
    mcp_executor: McpExecutor | None = None,
    mcp_capabilities: Iterable[str] | None = None,
    allow_cli_fallback: bool = False,
) -> GitHubAdapter:
    """Select dry-run or MCP-first operation.

    CLI is never primary. It is constructed only when explicit fallback is
    allowed; the composite adapter still calls MCP first for every operation.
    """
    if dry_run:
        return DryRunAdapter()
    mcp = GitHubMcpAdapter(mcp_executor, mcp_capabilities)
    cli = GhCliAdapter() if allow_cli_fallback else None
    return McpFirstAdapter(mcp, cli, allow_cli_fallback=allow_cli_fallback)
