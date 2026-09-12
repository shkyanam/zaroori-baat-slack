from __future__ import annotations

from types import SimpleNamespace
import unittest

from evaluators import (
    evaluate_action_extraction,
    evaluate_context_enrichment,
    evaluate_escalation_prediction,
    evaluate_latency,
    evaluate_signal_detection,
    evaluate_workflow_and_safety,
)


def example(outputs: dict, metadata: dict | None = None, inputs: dict | None = None):
    return SimpleNamespace(
        outputs=outputs,
        metadata=metadata or {"Applicable_Metric_IDs": "EVAL-001|EVAL-002|EVAL-003|EVAL-005|EVAL-006"},
        inputs=inputs or {"User_Input": {"timestamp": "2026-09-11T10:00:00+05:30"}},
    )


def run(outputs: dict):
    return SimpleNamespace(outputs=outputs)


class EvaluatorTests(unittest.TestCase):
    def test_signal_detection_scores_exact_fields(self):
        expected = {
            "primary_type": "QUESTION",
            "priority": "MEDIUM",
            "owner": None,
            "deadline": None,
            "action_required": True,
        }
        result = evaluate_signal_detection(
            run({"signal": expected}),
            example({"Expected_Signal_JSON": expected}),
        )
        self.assertEqual(result["score"], 1.0)

    def test_context_enrichment_reports_related_precision_recall_and_fact_coverage(self):
        expected = {
            "related_message_ids": ["MSG-008A", "MSG-008B"],
            "key_facts": ["ADO task 63414893 is ready for validation"],
        }
        actual = {
            "related_message_ids": ["MSG-008A", "MSG-008B"],
            "key_facts": ["ADO task 63414893 is ready for validation"],
            "briefing": "Task 63414893 is ready for validation.",
        }
        result = evaluate_context_enrichment(
            run({"context": actual}),
            example({"Expected_Context_JSON": expected}),
        )
        self.assertEqual(result["score"], 1.0)
        self.assertEqual(result["value"]["related_message_precision"], 1.0)
        self.assertEqual(result["value"]["related_message_recall"], 1.0)

    def test_action_extraction_uses_task_owner_deadline_tuples(self):
        expected = [{"task": "Validate the report", "owner": "Sneha", "deadline": "2026-09-10"}]
        actual = [{"task": "Validate the report", "owner": "Sneha", "deadline": "10-09-2026"}]
        result = evaluate_action_extraction(
            run({"action_items": actual}),
            example({"Expected_Action_Items_JSON": expected}),
        )
        self.assertEqual(result["score"], 1.0)

    def test_workflow_and_safety_checks_all_three_fields(self):
        result = evaluate_workflow_and_safety(
            run(
                {
                    "workflow_status": "COMPLETED",
                    "human_review": False,
                    "autonomous_action": "NONE",
                }
            ),
            example(
                {
                    "Expected_Workflow_Status": "COMPLETED",
                    "Expected_Human_Review": "No",
                    "Expected_Autonomous_Action": "NONE",
                }
            ),
        )
        self.assertEqual(result["score"], 1.0)

    def test_escalation_probability_uses_configured_tolerance(self):
        result = evaluate_escalation_prediction(
            run({"escalation_risk": "LOW", "escalation_probability": 0.15}),
            example(
                {
                    "Expected_Escalation_Risk": "LOW",
                    "Expected_Escalation_Probability": 0.10,
                }
            ),
        )
        self.assertEqual(result["score"], 1.0)

    def test_latency_checks_slo(self):
        result = evaluate_latency(
            run({"evaluation_latency_seconds": 1.2}),
            example({}, metadata={"Applicable_Metric_IDs": "EVAL-008"}),
        )
        self.assertEqual(result["score"], 1.0)
        self.assertTrue(result["value"]["within_slo"])

    def test_non_applicable_metric_is_explicitly_skipped(self):
        result = evaluate_latency(
            run({"evaluation_latency_seconds": 999}),
            example({}, metadata={"Applicable_Metric_IDs": "EVAL-001"}),
        )
        self.assertEqual(result["value"], "NOT_APPLICABLE")
        self.assertIn("not listed", result["comment"])

    def test_duplicate_webhook_has_case_specific_idempotency_check(self):
        result = evaluate_workflow_and_safety(
            run(
                {
                    "workflow_status": "IGNORED_DUPLICATE",
                    "human_review": False,
                    "autonomous_action": "IGNORE_DUPLICATE",
                }
            ),
            example(
                {
                    "Expected_Workflow_Status": "IGNORED_DUPLICATE",
                    "Expected_Human_Review": "No",
                    "Expected_Autonomous_Action": "IGNORE_DUPLICATE",
                },
                metadata={"Applicable_Metric_IDs": "EVAL-005", "Test_Id": "SMI-GD-043"},
                inputs={"Test_Id": "SMI-GD-043", "User_Input": {"timestamp": "2026-09-11T10:00:00+05:30"}},
            ),
        )
        self.assertEqual(result["score"], 1.0)
        self.assertTrue(result["value"]["duplicate_webhook_idempotency"])


if __name__ == "__main__":
    unittest.main()
