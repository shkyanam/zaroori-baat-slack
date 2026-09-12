from __future__ import annotations

from contextlib import ExitStack
from io import BytesIO
import json
import os
from pathlib import Path
import sys
import tempfile
from threading import Event
import time
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlparse


REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))
os.environ.update({
    "ZAROORI_BAAT_SKIP_ENV": "1", "LLM_CONTEXT_ENABLED": "false", "MEM0_ENABLED": "false",
    "LANGSMITH_TRACING": "false", "LANGCHAIN_TRACING": "false", "LANGCHAIN_TRACING_V2": "false",
})
import app


class SlackIdentityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.stack = ExitStack()
        self.stack.enter_context(patch.object(app, "DATABASE_PATH", Path(self.temp.name) / "messages.sqlite3"))
        self.stack.enter_context(patch.object(app, "SLACK_BOT_TOKEN", "test-only-token"))
        self.stack.enter_context(patch.object(app, "MEM0_ENABLED", False))
        self.stack.enter_context(patch.object(app, "LLM_CONTEXT_ENABLED", False))
        self.stack.enter_context(patch.object(app, "_SLACK_IDENTITY_BACKOFF", {}))
        self.stack.enter_context(patch.object(app, "_SLACK_IDENTITY_PENDING", set()))
        self.stack.enter_context(patch.object(app, "_SLACK_IDENTITY_EXECUTOR", None))
        self.network = self.stack.enter_context(patch.object(app, "urlopen", side_effect=self.slack_response))
        app.initialize_database()

    def tearDown(self):
        self.drain()
        self.stack.close()
        self.temp.cleanup()

    def drain(self):
        if app._SLACK_IDENTITY_EXECUTOR is not None:
            app._SLACK_IDENTITY_EXECUTOR.shutdown(wait=True)
            app._SLACK_IDENTITY_EXECUTOR = None
        self.assertFalse(app._SLACK_IDENTITY_PENDING)

    def slack_response(self, request, timeout):
        self.assertEqual(timeout, 3)
        parsed = urlparse(request.full_url)
        values = parse_qs(parsed.query)
        if parsed.path.endswith("users.info"):
            user_id = values["user"][0]
            payload = {"ok": True, "user": {
                "id": user_id, "name": "old-handle", "real_name": "Full Name",
                "profile": {"display_name": "Mitesh" if user_id.startswith("U") else "Asha", "real_name": "Profile Name"},
            }}
        else:
            payload = {"ok": True, "channel": {"name": "project-team" if values["channel"][0].startswith("C") else "planning"}}
        return BytesIO(json.dumps(payload).encode())

    def store_message(self):
        context = {"related_messages": [
            {"id": "related-1", "sender": "W87654321", "channel": "G87654321", "text": "Related context"},
            {"id": "related-2", "sender": "U12345678", "channel": "C12345678", "text": "Repeated identity"},
        ]}
        memory = {"items": [{"decision": "Use Python", "source_message_ids": ["identity-1"]}]}
        with app.connection() as database:
            database.execute(
                "INSERT INTO messages (id, external_id, channel, sender, text, priority, classification, "
                "context_json, score, summary, reason, suggested_action, decision, created_at, decision_memory_json) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                ("identity-1", "history-existing", "C12345678", "U12345678", "Production needs review", "high", "Incident",
                 json.dumps(context), 85, "Summary", "Reason", "Review", "deferred", "2026-09-12T00:00:00Z", json.dumps(memory)),
            )
        return context

    def test_existing_messages_related_context_and_other_apis_use_cached_names_without_changing_ids(self):
        context = self.store_message()
        with app.connection() as database:
            before = tuple(database.execute("SELECT * FROM messages").fetchone())
        cold = app.list_messages()[0]
        self.assertEqual(cold["sender_name"], "U12345678")
        self.drain()
        message = app.get_message("identity-1")
        self.assertEqual(message["sender_name"], "Mitesh")
        self.assertEqual(message["channel_name"], "project-team")
        self.assertEqual(message["sender"], "U12345678")
        self.assertEqual(message["channel"], "C12345678")
        self.assertEqual((message["priority"], message["classification"], message["decision"]), ("high", "Incident", "deferred"))
        related = message["context"]["related_messages"][0]
        self.assertEqual((related["sender_name"], related["channel_name"]), ("Asha", "planning"))
        self.assertEqual(related["sender"], context["related_messages"][0]["sender"])
        self.assertEqual(self.network.call_count, 4)
        # An executor restart still reads persistent names, with no repeated Slack calls.
        self.assertEqual(app.list_messages()[0]["sender_name"], "Mitesh")
        app.record_workflow_start("run-1", "identity-1", "C12345678")
        self.assertEqual(app.observability_summary()["recent_runs"][0]["channel_name"], "project-team")
        self.assertEqual(app.search_decision_memories("Python")["matches"][0]["metadata"]["channel_name"], "project-team")
        self.assertEqual(self.network.call_count, 4)
        with app.connection() as database:
            after = tuple(database.execute("SELECT * FROM messages").fetchone())
        self.assertEqual(before, after)
        self.assertNotIn("test-only-token", json.dumps(message))

    def test_cold_reads_do_not_wait_for_slack_and_deduplicate_concurrent_requests(self):
        entered, release = Event(), Event()

        def slow_response(request, timeout):
            entered.set()
            self.assertTrue(release.wait(timeout=5))
            return self.slack_response(request, timeout)

        self.network.side_effect = slow_response
        payload = [{"sender": "U12345678"}] * 10
        try:
            started = time.monotonic()
            result = app.with_slack_identity_names(payload)
            self.assertLess(time.monotonic() - started, 1)
            self.assertTrue(entered.wait(timeout=2))
            self.assertEqual(result[0]["sender_name"], "U12345678")
            app.with_slack_identity_names(payload)
            self.assertEqual(self.network.call_count, 1)
        finally:
            release.set()
            self.drain()
        self.assertEqual(app.with_slack_identity_names(payload)[0]["sender_name"], "Mitesh")

    def test_missing_scope_falls_back_and_restart_recovers_without_waiting_an_hour(self):
        self.network.side_effect = lambda *args, **kwargs: BytesIO(b'{"ok": false, "error": "missing_scope"}')
        payload = {"sender": "U12345678"}
        app.with_slack_identity_names(payload)
        self.drain()
        self.assertEqual(app.with_slack_identity_names(payload)["sender_name"], "U12345678")
        app.with_slack_identity_names({"sender": "U87654321"})
        self.drain()
        self.assertEqual(self.network.call_count, 1)
        app._SLACK_IDENTITY_BACKOFF.clear()  # Process restart after changing Slack permissions.
        self.network.side_effect = self.slack_response
        app.with_slack_identity_names(payload)
        self.drain()
        self.assertEqual(app.with_slack_identity_names(payload)["sender_name"], "Mitesh")
        self.assertEqual(self.network.call_count, 2)

    def test_transient_failure_preserves_stale_success_and_backs_off(self):
        payload = {"sender": "U12345678"}
        app.with_slack_identity_names(payload)
        self.drain()
        with app.connection() as database:
            database.execute("UPDATE slack_identity_cache SET expires_at = 0")
        self.network.side_effect = TimeoutError("Unavailable")
        self.assertEqual(app.with_slack_identity_names(payload)["sender_name"], "Mitesh")
        self.drain()
        self.assertEqual(app.with_slack_identity_names(payload)["sender_name"], "Mitesh")
        self.drain()
        self.assertEqual(self.network.call_count, 2)
        with app.connection() as database:
            row = database.execute("SELECT display_name, expires_at FROM slack_identity_cache").fetchone()
        self.assertEqual(row[0], "Mitesh")
        self.assertGreater(row[1], time.time() + 290)

    def test_rate_limit_respects_retry_after_and_method_wide_backoff(self):
        self.network.side_effect = HTTPError("https://slack.com/api/users.info", 429, "rate limited", {"Retry-After": "720"}, None)
        app.with_slack_identity_names({"sender": "U12345678"})
        self.drain()
        app.with_slack_identity_names({"sender": "U87654321"})
        self.drain()
        self.assertEqual(self.network.call_count, 1)
        with app.connection() as database:
            expiry = database.execute("SELECT expires_at FROM slack_identity_cache").fetchone()[0]
        self.assertGreater(expiry, time.time() + 710)

    def test_name_fallbacks_and_token_namespaces(self):
        payload = {"sender": "U12345678"}
        for index, (profile, identity, expected) in enumerate([
            ({"display_name": "  ", "real_name": "Profile Name"}, {"real_name": "Full Name", "name": "handle"}, "Profile Name"),
            ({}, {"real_name": "Full Name", "name": "handle"}, "Full Name"),
            ({}, {"name": "handle"}, "handle"),
        ]):
            with self.subTest(expected=expected), patch.object(app, "SLACK_BOT_TOKEN", f"test-token-{index}"):
                self.network.side_effect = lambda *args, **kwargs: BytesIO(json.dumps({"ok": True, "user": {**identity, "profile": profile}}).encode())
                self.assertEqual(app.with_slack_identity_names(payload)["sender_name"], "U12345678")
                self.drain()
                self.assertEqual(app.with_slack_identity_names(payload)["sender_name"], expected)

    def test_demo_names_and_blank_token_never_trigger_slack_requests(self):
        result = app.with_slack_identity_names({"sender": "Mitesh", "channel": "#platform"})
        self.assertEqual((result["sender_name"], result["channel_name"]), ("Mitesh", "#platform"))
        app.with_slack_identity_names({"external_id": "demo-fixture", "sender": "U12345678", "channel": "C12345678"})
        with patch.object(app, "SLACK_BOT_TOKEN", ""):
            app.with_slack_identity_names({"sender": "U12345678", "channel": "C12345678"})
        self.drain()
        self.network.assert_not_called()


if __name__ == "__main__":
    unittest.main()
