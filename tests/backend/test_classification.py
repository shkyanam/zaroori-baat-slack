from __future__ import annotations

import os
from pathlib import Path
import sys
import unittest


REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))
os.environ.update({
    "ZAROORI_BAAT_SKIP_ENV": "1",
    "LLM_CONTEXT_ENABLED": "false",
    "MEM0_ENABLED": "false",
    "LANGSMITH_TRACING": "false",
})
import app


class ClassificationRegressionTests(unittest.TestCase):
    def test_production_scale_decision_is_not_an_incident(self):
        message = (
            "Decision: use hybrid RAG with local SQLite embeddings rather than Pinecone. "
            "Revisit Pinecone for larger production-scale or multi-workspace usage."
        )
        result = app.prioritize_message(message)
        self.assertEqual(result.classification, "Decision Needed")
        self.assertEqual(result.priority, "medium")

    def test_real_production_failure_remains_an_incident(self):
        result = app.prioritize_message("Production checkout is failing after the deployment.")
        self.assertEqual(result.classification, "Incident")
        self.assertEqual(result.priority, "high")


if __name__ == "__main__":
    unittest.main()
