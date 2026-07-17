from preflight.github import GitHubMcpAdapter, McpFirstAdapter, get_adapter


class FakeCli:
    name = "fake-cli"
    dry_run = False

    @staticmethod
    def available():
        return True

    @staticmethod
    def capability(operation):
        return True

    def open_pr(self, repo, head, base, title, body):
        return {"ok": True, "effect": "open_pr", "provider": self.name}

    def ensure_labels(self, repo, labels):
        return {"ok": True, "effect": "ensure_labels", "provider": self.name}

    def find_pr(self, repo, head):
        return {"number": 1}

    def search_issues(self, repo, dedupe_key):
        return [{"number": 2}]

    def create_issue(self, repo, title, body, labels):
        return {"ok": True, "effect": "create_issue", "provider": self.name}

    def update_issue(self, repo, number, body, reopen):
        return {"ok": True, "effect": "update_issue", "provider": self.name}

    def pr_status(self, repo, number):
        return {"ok": True, "status": "green", "provider": self.name}


def test_mcp_is_primary_when_supported():
    calls = []

    def executor(operation, payload):
        calls.append(operation)
        return {"ok": True, "number": 7}

    adapter = McpFirstAdapter(GitHubMcpAdapter(executor), FakeCli(), allow_cli_fallback=True)
    result = adapter.open_pr("o/r", "h", "main", "t", "b")
    assert result["provider"] == "github-mcp"
    assert calls == ["open_pr"]


def test_cli_fills_only_unsupported_capability_gap():
    mcp = GitHubMcpAdapter(lambda op, payload: {"ok": False, "status": "unsupported_capability"})
    adapter = McpFirstAdapter(mcp, FakeCli(), allow_cli_fallback=True)
    result = adapter.open_pr("o/r", "h", "main", "t", "b")
    assert result["provider"] == "fake-cli"
    assert result["provider_path"] == ["github-mcp", "fake-cli"]
    assert result["fallback_reason"] == "unsupported_capability"


def test_cli_does_not_bypass_permission_or_auth_failure():
    for status in ("permission_denied", "authentication_failed", "policy_blocked", "rate_limited"):
        mcp = GitHubMcpAdapter(lambda op, payload, s=status: {"ok": False, "status": s})
        adapter = McpFirstAdapter(mcp, FakeCli(), allow_cli_fallback=True)
        result = adapter.open_pr("o/r", "h", "main", "t", "b")
        assert result["provider"] == "github-mcp"
        assert result["status"] == status


def test_missing_host_executor_emits_mcp_action_request_not_fake_success():
    adapter = get_adapter(dry_run=False)
    result = adapter.open_pr("o/r", "h", "main", "t", "b")
    assert result["ok"] is False
    assert result["status"] == "mcp_action_required"
    assert result["mcp_request"]["operation"] == "open_pr"
    assert "provider_path" in result


def test_dry_run_never_invokes_remote_provider():
    adapter = get_adapter(dry_run=True, allow_cli_fallback=True)
    result = adapter.create_issue("o/r", "t", "b", ["preflight"])
    assert result["dry_run"] is True
    assert result["provider"] == "dry-run"
