from __future__ import annotations

from contextlib import ExitStack
import http.client
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from threading import Thread
import unittest
from unittest.mock import patch


REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))
os.environ.update({
    "ZAROORI_BAAT_SKIP_ENV": "1", "LLM_CONTEXT_ENABLED": "false", "MEM0_ENABLED": "false",
    "LANGSMITH_TRACING": "false", "LANGCHAIN_TRACING": "false", "LANGCHAIN_TRACING_V2": "false",
    "LANGSMITH_API_KEY": "", "LANGCHAIN_API_KEY": "", "LLM_API_KEY": "", "NEBIUS_API_KEY": "",
    "LANGGRAPH_CHECKPOINTER": "sqlite",
})
import app


class QuietHandler(app.Handler):
    def log_message(self, format_string, *args):
        pass


class ApiIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.stack = ExitStack()
        self.stack.enter_context(patch.object(app, "ROOT", self.root))
        self.stack.enter_context(patch.object(app, "DATABASE_PATH", self.root / "messages.sqlite3"))
        self.stack.enter_context(patch.object(app, "LANGGRAPH_CHECKPOINT_PATH", self.root / "checkpoints.sqlite3"))
        self.stack.enter_context(patch.object(app, "SLACK_BOT_TOKEN", ""))
        self.stack.enter_context(patch.object(app, "SLACK_CHANNEL_IDS", []))
        self.network = self.stack.enter_context(patch.object(app, "urlopen", side_effect=AssertionError("Unexpected external request")))
        app.initialize_database()
        (self.root / "index.html").write_text("legacy-screen", encoding="utf-8")
        (self.root / "styles.css").write_text("body{}", encoding="utf-8")
        (self.root / "app.js").write_text("legacy();", encoding="utf-8")
        assets = self.root / "frontend" / "dist" / "assets"
        assets.mkdir(parents=True)
        (assets.parent / "index.html").write_text("react-screen", encoding="utf-8")
        (assets.parent / "favicon.svg").write_text("<svg/>", encoding="utf-8")
        (assets / "main-abcd.js").write_text("newScreen();", encoding="utf-8")
        (assets / "main-abcd.css").write_text(".shell{}", encoding="utf-8")
        (self.root / ".env").write_text("DO_NOT_EXPOSE=this-is-private", encoding="utf-8")
        self.server = app.ThreadingHTTPServer(("127.0.0.1", 0), QuietHandler)
        self.server.daemon_threads = True
        self.thread = Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=3)
        if app._LANGGRAPH_CHECKPOINT_CONNECTION is not None:
            app._LANGGRAPH_CHECKPOINT_CONNECTION.close()
        app._LANGGRAPH_CHECKPOINT_CONNECTION = None
        app._LANGGRAPH_CHECKPOINTER = None
        app._LANGGRAPH_GRAPH = None
        self.stack.close()
        self.temp.cleanup()

    def request(self, method, path, payload=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=10)
        body = json.dumps(payload) if payload is not None else None
        connection.request(method, path, body=body, headers={"Content-Type": "application/json"})
        response = connection.getresponse()
        content = response.read()
        headers = dict(response.getheaders())
        status = response.status
        connection.close()
        return status, headers, content

    def json_request(self, method, path, payload=None):
        status, headers, content = self.request(method, path, payload)
        self.assertEqual(headers["Content-Type"], "application/json")
        return status, json.loads(content)

    def create_message(self):
        status, message = self.json_request("POST", "/api/messages", {
            "text": "Please review the inbox layout before tomorrow. Owner: Mitesh.",
        })
        self.assertEqual(status, 201)
        return message

    def test_production_assets_and_legacy_routes(self):
        for path, expected, content_type in [
            ("/", b"react-screen", "text/html"),
            ("/index.html", b"react-screen", "text/html"),
            ("/legacy", b"legacy-screen", "text/html"),
            ("/legacy/", b"legacy-screen", "text/html"),
            ("/assets/main-abcd.js", b"newScreen();", "text/javascript"),
            ("/assets/main-abcd.css?v=1", b".shell{}", "text/css"),
            ("/favicon.svg", b"<svg/>", "image/svg+xml"),
            ("/app.js", b"legacy();", "text/javascript"),
        ]:
            with self.subTest(path=path):
                status, headers, content = self.request("GET", path)
                self.assertEqual(status, 200)
                self.assertEqual(content, expected)
                self.assertTrue(headers["Content-Type"].startswith(content_type))
                self.assertEqual(headers["X-Content-Type-Options"], "nosniff")
                self.assertEqual(int(headers["Content-Length"]), len(content))

    def test_unbuilt_frontend_falls_back_to_legacy(self):
        (self.root / "frontend" / "dist" / "index.html").unlink()
        self.assertEqual(self.request("GET", "/")[2], b"legacy-screen")

    def test_assets_reject_traversal_windows_streams_and_missing_files(self):
        for path in [
            "/assets/../index.html", "/assets/%2e%2e/index.html",
            "/assets/%2e%2e%2f%2e%2e%2f%2e%2e%2f.env",
            "/assets/..%5c..%5c..%5c.env", "/assets/%2Fetc/passwd",
            "/assets/C:%5cWindows%5cwin.ini", "/assets/main-abcd.js:secret",
            "/assets/%00main.js", "/assets/missing.js", "/assets/", "/.env", "/app.py",
        ]:
            with self.subTest(path=path):
                status, result = self.json_request("GET", path)
                self.assertEqual(status, 404)
                self.assertEqual(result, {"error": "Not found"})

    def test_review_and_reopen_persist_and_refresh_preserves_outcome(self):
        message = self.create_message()
        message_path = "/api/messages/" + message["id"]
        for decision in ["approved", "dismissed", "deferred", "escalated"]:
            status, reviewed = self.json_request("POST", message_path + "/decision", {"decision": decision})
            self.assertEqual(status, 200)
            self.assertEqual(reviewed["decision"], decision)
            self.assertTrue(reviewed["decided_at"])
            self.assertEqual(self.json_request("GET", message_path)[1]["decision"], decision)
        status, refreshed = self.json_request("POST", message_path + "/context")
        self.assertEqual(status, 200)
        self.assertEqual(refreshed["decision"], "escalated")
        status, reopened = self.json_request("POST", message_path + "/decision", {"decision": "pending"})
        self.assertEqual(status, 200)
        self.assertIsNone(reopened["decision"])
        self.assertIsNone(reopened["decided_at"])
        with app.connection() as database:
            row = database.execute("SELECT decision, decided_at FROM messages WHERE id = ?", (message["id"],)).fetchone()
        self.assertEqual(tuple(row), (None, None))
        self.network.assert_not_called()

    def test_invalid_reviews_and_missing_messages(self):
        message = self.create_message()
        path = "/api/messages/" + message["id"] + "/decision"
        self.assertEqual(self.json_request("POST", path, {"decision": "unknown"})[0], 400)
        self.assertEqual(self.json_request("POST", path, ["approved"])[0], 400)
        self.assertEqual(self.json_request("POST", "/api/messages/missing/decision", {"decision": "pending"})[0], 404)
        self.assertEqual(self.json_request("GET", "/api/messages/missing")[0], 404)
        self.assertIsNone(app.get_message(message["id"])["decision"])

    def test_status_configuration_is_accurate_and_does_not_expose_secrets(self):
        status, empty = self.json_request("GET", "/api/system/status")
        self.assertEqual(status, 200)
        self.assertEqual(empty["slack"], {"configured": False, "channel_count": 0, "last_sync_at": None})
        self.assertEqual(empty["context"]["external_sources"], "mock")
        with patch.multiple(app, SLACK_BOT_TOKEN="secret-slack", SLACK_CHANNEL_IDS=["secret-channel"],
                            MEM0_API_KEY="secret-memory", MEM0_USER_ID="private-user", MEM0_ENABLED=True,
                            LLM_CONTEXT_ENABLED=True, LLM_API_KEY="secret-llm", LLM_MODEL="configured-model"):
            _, configured = self.json_request("GET", "/api/system/status")
        self.assertTrue(configured["slack"]["configured"])
        self.assertEqual(configured["slack"]["channel_count"], 1)
        self.assertTrue(configured["memory"]["active"])
        self.assertTrue(configured["context"]["enabled"])
        serialized = json.dumps(configured)
        for private_value in ["secret-", "private-user", "checkpoint_path", str(self.root), "api_key", "user_id"]:
            self.assertNotIn(private_value, serialized)

    def test_successful_sync_timestamp_is_persisted_and_failure_does_not_advance_it(self):
        with patch.multiple(app, SLACK_BOT_TOKEN="fake-token", SLACK_CHANNEL_IDS=["CDEMO"]):
            self.network.side_effect = None
            self.network.return_value.__enter__.return_value.read.return_value = b'{"ok": true, "messages": []}'
            self.assertEqual(self.json_request("POST", "/api/slack/sync")[0], 200)
            first = self.json_request("GET", "/api/system/status")[1]["slack"]["last_sync_at"]
            self.assertTrue(first)
            with app.connection() as database:
                persisted = database.execute("SELECT value FROM app_settings WHERE key='slack_last_sync_at'").fetchone()[0]
            self.assertEqual(first, persisted)
            self.network.return_value.__enter__.return_value.read.return_value = b'{"ok": false, "error": "invalid_auth"}'
            self.assertEqual(self.json_request("POST", "/api/slack/sync")[0], 503)
            self.assertEqual(first, self.json_request("GET", "/api/system/status")[1]["slack"]["last_sync_at"])

    def test_environment_file_is_skipped_in_offline_mode(self):
        with patch.object(Path, "read_text", side_effect=AssertionError("Must not read .env")):
            app.load_local_env()

    def test_memory_search_deduplicates_by_evidence_and_ignores_unrelated_envelopes(self):
        # Insert the envelope first to prove the direct source extraction is
        # preferred even when its duplicate is encountered earlier in storage.
        envelope = app.create_message("Please review the September release report.", channel="#releases")
        original = app.create_message(
            "We decided to use SQLite for the Atlas workspace because it needs fewer services.",
            channel="#engineering", thread_ts="original-thread",
        )
        item = {
            "decision": "Use SQLite", "alternatives_considered": ["PostgreSQL"],
            "participants": ["Mitesh"], "rationale": "Fewer services to maintain",
            "source_message_ids": [original["id"]], "date": "2026-09-09T10:00:00+00:00",
            "source": "#engineering / thread original-thread",
        }
        duplicate = {**item, "decision": "  USE SQLite!  ", "source": "#releases",
                     "date": "2026-09-11T10:00:00+00:00", "rationale": "Release-related context"}
        with app.connection() as database:
            for message, decision in [(envelope, duplicate), (original, item)]:
                database.execute("UPDATE messages SET decision_memory_json = ? WHERE id = ?", (
                    json.dumps({"items": [decision]}), message["id"],
                ))
        status, result = self.json_request("GET", "/api/decision-memory/search?q=SQLite")
        self.assertEqual(status, 200)
        self.assertEqual(len(result["matches"]), 1)
        match = result["matches"][0]
        self.assertEqual(match["metadata"]["source_message_id"], original["id"])
        self.assertEqual(match["metadata"]["source_message_ids"], [original["id"]])
        self.assertEqual(match["metadata"]["channel"], "#engineering")
        self.assertEqual(match["metadata"]["thread_ts"], "original-thread")
        self.assertEqual(match["created_at"], item["date"])
        self.assertIn("Fewer services to maintain", match["memory"])
        self.assertNotIn("#releases", match["memory"])
        self.assertEqual(self.json_request("GET", "/api/decision-memory/search?q=release")[1]["matches"], [])
        # The original discussion still contributes useful terms absent from
        # the compact decision record, such as the project name.
        self.assertEqual(len(self.json_request("GET", "/api/decision-memory/search?q=Atlas")[1]["matches"]), 1)
        self.network.assert_not_called()


class DemoSeedTests(unittest.TestCase):
    def test_offline_seed_is_additive_covers_categories_and_preserves_reviews(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            database = root / "demo.sqlite3"
            checkpoint = root / "checkpoint.sqlite3"
            command = [sys.executable, str(REPO_ROOT / "scripts" / "seed_demo.py"),
                       "--database", str(database), "--checkpoint", str(checkpoint)]
            inherited = dict(os.environ, LLM_CONTEXT_ENABLED="true", LLM_API_KEY="invalid-test-key",
                             LLM_MODEL="invalid-model", MEM0_ENABLED="true", MEM0_API_KEY="invalid-test-key",
                             LANGSMITH_TRACING="true", LANGSMITH_API_KEY="invalid-test-key",
                             LANGCHAIN_TRACING_V2="true", LANGGRAPH_CHECKPOINTER="postgres",
                             LANGGRAPH_POSTGRES_URI="postgresql://invalid.invalid/demo")
            first = subprocess.run(command, capture_output=True, text=True, timeout=45, env=inherited)
            self.assertEqual(first.returncode, 0, first.stdout + first.stderr)
            self.assertIn("18 messages added", first.stdout)
            with patch.object(app, "DATABASE_PATH", database):
                messages = app.list_messages()
                self.assertEqual(len(messages), 18)
                self.assertEqual({message["classification"] for message in messages}, set(app.CLASSIFICATIONS))
                self.assertEqual(sum(message["decision"] == "approved" for message in messages), 2)
                self.assertEqual(sum(message["decision"] == "deferred" for message in messages), 2)
                self.assertTrue(any(message["decision_memory"]["items"] for message in messages))
                self.assertTrue(any(message["action_extraction"]["items"] for message in messages))
                self.assertTrue(app.system_status()["demo"])
                selected = next(message for message in messages if message["decision"] is None)
                app.record_decision(selected["id"], "dismissed")
            second = subprocess.run(command, capture_output=True, text=True, timeout=45, env=inherited)
            self.assertEqual(second.returncode, 0, second.stdout + second.stderr)
            self.assertIn("0 messages added, 18 already present", second.stdout)
            with patch.object(app, "DATABASE_PATH", database):
                self.assertEqual(len(app.list_messages()), 18)
                self.assertEqual(app.get_message(selected["id"])["decision"], "dismissed")


if __name__ == "__main__":
    unittest.main()
