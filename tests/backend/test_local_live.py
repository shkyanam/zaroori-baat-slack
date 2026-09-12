from __future__ import annotations

from contextlib import closing
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import textwrap
import unittest


REPO_ROOT = Path(__file__).resolve().parents[2]


class LocalLiveStartupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        # Import a copy so even a broken database-path fallback stays isolated.
        shutil.copy2(REPO_ROOT / "app.py", self.root / "app.py")
        # Keep only operating-system settings, never inherited team credentials.
        system_keys = {"PATH", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "TEMP", "TMP"}
        self.env = {key: value for key, value in os.environ.items() if key.upper() in system_keys}
        self.env.update({
            "LLM_CONTEXT_ENABLED": "false", "MEM0_ENABLED": "false",
            "LANGSMITH_TRACING": "false", "LANGCHAIN_TRACING": "false",
            "LANGCHAIN_TRACING_V2": "false", "LANGGRAPH_CHECKPOINTER": "sqlite",
        })

    def run_isolated(self, source):
        runner = self.root / "check_startup.py"
        runner.write_text(textwrap.dedent(source), encoding="utf-8")
        result = subprocess.run(
            [sys.executable, str(runner)], cwd=self.root, env=self.env,
            capture_output=True, text=True, timeout=30,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_live_startup_uses_custom_env_and_preserves_separate_demo_database(self):
        demo_path = self.root / "zaroori_baat_slack.sqlite3"
        with closing(sqlite3.connect(demo_path)) as database:
            database.execute("CREATE TABLE messages (id TEXT, text TEXT, decision TEXT)")
            database.execute("INSERT INTO messages VALUES ('demo-existing', 'Existing demo', 'approved')")
            database.commit()
        before = demo_path.read_bytes()
        (self.root / ".env").write_text("SLACK_BOT_TOKEN=unused-default-token\n", encoding="utf-8")
        (self.root / ".env.live").write_text(
            "ZAROORI_BAAT_DATABASE_PATH=.runtime/live/messages.sqlite3\n"
            "ZAROORI_BAAT_SEED_DEMO=false\n"
            "ZAROORI_BAAT_SLACK_PORT=8002\n"
            "LANGGRAPH_CHECKPOINT_PATH=.runtime/live/checkpoints.sqlite3\n"
            "SLACK_BOT_TOKEN=\n"
            "SLACK_CHANNEL_IDS=CUNITTEST\n",
            encoding="utf-8",
        )
        self.env["ZAROORI_BAAT_ENV_FILE"] = ".env.live"
        self.run_isolated("""
            from pathlib import Path
            from unittest.mock import patch
            import app

            assert app.DATABASE_PATH == Path(__file__).parent / '.runtime/live/messages.sqlite3'
            assert app.LANGGRAPH_CHECKPOINT_PATH == Path('.runtime/live/checkpoints.sqlite3')
            assert app.SEED_DEMO is False
            assert app.SLACK_BOT_TOKEN == ''
            with patch.object(app, 'ThreadingHTTPServer') as server, \
                 patch.object(app, 'seed_demo') as seed, \
                 patch.object(app, 'urlopen', side_effect=AssertionError('No external requests')):
                app.main()
                seed.assert_not_called()
                server.assert_called_once_with(('127.0.0.1', 8002), app.Handler)
                server.return_value.serve_forever.assert_called_once_with()
                server.return_value.server_close.assert_called_once_with()
                assert app.list_messages() == []
                status = app.system_status()
                assert status['demo'] is False
                assert status['slack']['configured'] is False
                assert status['slack']['channel_count'] == 1
                try:
                    app.sync_slack_history()
                except RuntimeError as error:
                    assert 'required' in str(error)
                else:
                    raise AssertionError('Blank token must not attempt Slack sync')
        """)
        self.assertTrue((self.root / ".runtime/live/messages.sqlite3").is_file())
        self.assertEqual(demo_path.read_bytes(), before)

    def test_default_startup_still_seeds_demo_and_uses_original_database_location(self):
        self.run_isolated("""
            from pathlib import Path
            from unittest.mock import patch
            import app

            assert app.DATABASE_PATH == Path(__file__).parent / 'zaroori_baat_slack.sqlite3'
            assert app.SEED_DEMO is True
            with patch.object(app, 'ThreadingHTTPServer'), \
                 patch.object(app, 'urlopen', side_effect=AssertionError('No external requests')):
                app.main()
                assert len(app.list_messages()) == 3
                assert app.system_status()['demo'] is True
            if app._LANGGRAPH_CHECKPOINT_CONNECTION is not None:
                app._LANGGRAPH_CHECKPOINT_CONNECTION.close()
        """)

    def test_skip_env_ignores_custom_file_and_accepts_absolute_database_path(self):
        database_path = self.root / "isolated" / "explicit.sqlite3"
        (self.root / ".env.live").write_text(
            "ZAROORI_BAAT_DATABASE_PATH=wrong.sqlite3\n"
            "ZAROORI_BAAT_SLACK_PORT=8123\n"
            "SLACK_BOT_TOKEN=unused-custom-token\n",
            encoding="utf-8",
        )
        self.env.update({
            "ZAROORI_BAAT_ENV_FILE": str(self.root / ".env.live"),
            "ZAROORI_BAAT_SKIP_ENV": "1",
            "ZAROORI_BAAT_DATABASE_PATH": str(database_path),
            "SLACK_BOT_TOKEN": "   ",
        })
        self.run_isolated("""
            from pathlib import Path
            import os
            import app

            assert app.DATABASE_PATH == Path(os.environ['ZAROORI_BAAT_DATABASE_PATH'])
            assert app.PORT == 8001
            assert app.SLACK_BOT_TOKEN == ''
            app.initialize_database()
            assert app.system_status()['slack']['configured'] is False
        """)
        self.assertTrue(database_path.is_file())
        self.assertFalse((self.root / "wrong.sqlite3").exists())

    def test_absolute_custom_env_file_preserves_explicit_environment_overrides(self):
        configuration = self.root / "config" / "live.env"
        configuration.parent.mkdir()
        configuration.write_text(
            "ZAROORI_BAAT_DATABASE_PATH=nested/live.sqlite3\n"
            "ZAROORI_BAAT_SEED_DEMO=false\n"
            "ZAROORI_BAAT_SLACK_PORT=8002\n",
            encoding="utf-8",
        )
        self.env.update({
            "ZAROORI_BAAT_ENV_FILE": str(configuration),
            "ZAROORI_BAAT_SLACK_PORT": "8012",
        })
        self.run_isolated("""
            from pathlib import Path
            import app

            assert app.DATABASE_PATH == Path(__file__).parent / 'nested/live.sqlite3'
            assert app.SEED_DEMO is False
            assert app.PORT == 8012
        """)


if __name__ == "__main__":
    unittest.main()
