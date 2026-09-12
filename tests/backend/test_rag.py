from __future__ import annotations

from contextlib import ExitStack
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch


REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))
os.environ.update({
    "ZAROORI_BAAT_SKIP_ENV": "1",
    "LLM_CONTEXT_ENABLED": "false",
    "MEM0_ENABLED": "false",
    "LANGSMITH_TRACING": "false",
})
import app


class FakeEmbeddingResponse:
    def __init__(self, payload: dict):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self) -> bytes:
        return json.dumps(self.payload).encode()


def embedding_response(request, **_kwargs):
    payload = json.loads(request.data)
    text = payload["input"].lower()
    vector = [1.0, 0.0] if any(term in text for term in ("payment", "checkout", "card")) else [0.0, 1.0]
    return FakeEmbeddingResponse({"data": [{"embedding": vector}]})


class RagRetrievalTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.stack = ExitStack()
        self.stack.enter_context(patch.object(app, "DATABASE_PATH", Path(self.temp.name) / "messages.sqlite3"))
        self.stack.enter_context(patch.object(app, "RAG_ENABLED", True))
        self.stack.enter_context(patch.object(app, "RAG_API_KEY", "test-key"))
        self.stack.enter_context(patch.object(app, "RAG_BASE_URL", "https://embeddings.example/v1"))
        self.stack.enter_context(patch.object(app, "RAG_EMBEDDING_MODEL", "test-embedding-model"))
        self.stack.enter_context(patch.object(app, "RAG_MIN_SIMILARITY", 0.35))
        self.stack.enter_context(patch.object(app, "urlopen", side_effect=embedding_response))
        app.initialize_database()

    def tearDown(self):
        self.stack.close()
        self.temp.cleanup()

    def test_semantic_retrieval_finds_related_message_without_shared_terms(self):
        payment = app.create_message(
            "Payment processing latency increased after the release.",
            "Asha",
            "#payments",
            "rag-payment",
        )
        unrelated = app.create_message(
            "The design workshop is moving to Thursday.",
            "Ravi",
            "#design",
            "rag-design",
        )
        self.assertTrue(app.index_message_for_rag(payment["id"], payment["text"]))
        self.assertTrue(app.index_message_for_rag(unrelated["id"], unrelated["text"]))

        related = app.find_related_messages("Checkout is slow for card transactions.", "#payments")

        self.assertEqual(related[0]["id"], payment["id"])
        self.assertIn("RAG", related[0]["relationship"])
        self.assertNotIn(unrelated["id"], [message["id"] for message in related])

    def test_disabled_rag_preserves_lexical_fallback_without_network(self):
        with patch.object(app, "RAG_ENABLED", False), patch.object(app, "urlopen") as network:
            self.assertEqual(app.fetch_rag_embedding("Checkout latency"), None)
            self.assertFalse(app.rag_status()["active"])
            network.assert_not_called()


if __name__ == "__main__":
    unittest.main()
