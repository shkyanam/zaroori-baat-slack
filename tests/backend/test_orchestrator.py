from __future__ import annotations

from contextlib import ExitStack
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch


REPO_ROOT = Path(__file__).resolve().parents[2]
os.environ.update(
    {
        "ZAROORI_BAAT_SKIP_ENV": "1",
        "LLM_CONTEXT_ENABLED": "false",
        "MEM0_ENABLED": "false",
        "LANGSMITH_TRACING": "false",
        "LANGSMITH_API_KEY": "",
        "LANGGRAPH_CHECKPOINTER": "sqlite",
    }
)
import sys

sys.path.insert(0, str(REPO_ROOT))
import app
from orchestrator import orchestrator


EXPECTED_KEYS = {
    "test_id",
    "signal",
    "signal_status",
    "signal_warnings",
    "context",
    "context_status",
    "action_items",
    "decisions",
    "conflict_status",
    "escalation_risk",
    "escalation_probability",
    "owner",
    "deadline",
    "suggested_response",
    "confidence",
    "workflow_status",
    "human_review",
    "autonomous_action",
    "error_stage",
    "error_class",
    "evaluation_latency_seconds",
}


class OrchestratorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.stack = ExitStack()
        self.stack.enter_context(patch.object(app, "DATABASE_PATH", self.root / "messages.sqlite3"))
        self.stack.enter_context(patch.object(app, "LANGGRAPH_CHECKPOINT_PATH", self.root / "checkpoints.sqlite3"))
        app._LANGGRAPH_GRAPH = None
        app._LANGGRAPH_CHECKPOINTER = None
        app._LANGGRAPH_CHECKPOINT_CONNECTION = None
        app.initialize_database()

    def tearDown(self):
        if app._LANGGRAPH_CHECKPOINT_CONNECTION is not None:
            app._LANGGRAPH_CHECKPOINT_CONNECTION.close()
        app._LANGGRAPH_GRAPH = None
        app._LANGGRAPH_CHECKPOINTER = None
        app._LANGGRAPH_CHECKPOINT_CONNECTION = None
        self.stack.close()
        self.temp.cleanup()

    def event(self):
        return {
            "event_type": "message",
            "message_id": "MSG-001",
            "channel": "#engineering",
            "thread_id": None,
            "timestamp": "2026-09-11T10:00:00+05:30",
            "sender": "Aarav",
            "text": "Please review the release plan by tomorrow.",
        }

    def test_success_returns_stable_contract(self):
        result = orchestrator.run(self.event(), "SMI-GD-001").model_dump(mode="json")

        self.assertEqual(set(result), EXPECTED_KEYS)
        self.assertEqual(result["test_id"], "SMI-GD-001")
        self.assertEqual(result["signal_status"], "SUCCESS")
        self.assertEqual(result["workflow_status"], "COMPLETED")
        self.assertEqual(result["autonomous_action"], "NONE")
        self.assertIsInstance(result["evaluation_latency_seconds"], float)

    def test_failure_returns_same_contract_and_fails_closed(self):
        with patch.object(app, "run_message_workflow", side_effect=RuntimeError("simulated")):
            result = orchestrator.run(self.event(), "SMI-GD-001").model_dump(mode="json")

        self.assertEqual(set(result), EXPECTED_KEYS)
        self.assertEqual(result["test_id"], "SMI-GD-001")
        self.assertEqual(result["workflow_status"], "FAILED")
        self.assertEqual(result["signal_status"], "FAILED")
        self.assertEqual(result["error_stage"], "workflow")
        self.assertEqual(result["error_class"], "RuntimeError")
        self.assertTrue(result["human_review"])
        self.assertEqual(result["autonomous_action"], "NONE")

    def test_evaluation_trace_config_contains_case_metadata(self):
        fake_graph = Mock()
        fake_graph.invoke.return_value = {
            "message": {"id": "MSG-008"},
            "priority_result": {"classification": "Question"},
            "context": {},
            "action_extraction": {},
            "decision_memory": {},
        }
        with patch.object(app, "get_message_workflow", return_value=fake_graph):
            app.run_message_workflow(
                "How is context enriched?",
                message_id="MSG-008",
                run_id="smi-eval-SMI-GD-008",
                test_id="SMI-GD-008",
            )

        config = fake_graph.invoke.call_args.args[1]
        self.assertEqual(config["run_name"], "smi-eval-SMI-GD-008")
        self.assertIn("smi-eval", config["tags"])
        self.assertEqual(
            config["metadata"],
            {
                "workflow_version": "workflow-v1",
                "message_id": "MSG-008",
                "channel": "demo",
                "test_id": "SMI-GD-008",
                "dataset_version": "v1",
                "model_provider": "Nebius",
                "model_name": "not-configured",
                "prompt_version": "signal-context-v1",
                "evaluator_version": "eval-v1",
            },
        )


if __name__ == "__main__":
    unittest.main()
