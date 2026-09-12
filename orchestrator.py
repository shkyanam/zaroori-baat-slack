"""Evaluation-facing orchestration contract for Slack Message Intelligence."""

from __future__ import annotations

from dataclasses import asdict, dataclass
import json
import re
import time
import uuid
from typing import Any

import app


CLASSIFICATION_TYPES = {
    "FYI": "FYI",
    "Action Required": "ACTION_REQUIRED",
    "Question": "QUESTION",
    "Incident": "INCIDENT",
    "Escalation": "ESCALATION",
    "Approval Request": "APPROVAL_REQUEST",
    "Decision Needed": "DECISION_NEEDED",
}


@dataclass
class OrchestratorResult:
    """Stable JSON-compatible result returned for every evaluation case."""

    test_id: str
    signal: dict[str, Any]
    signal_status: str
    signal_warnings: list[str]
    context: dict[str, Any]
    context_status: str
    action_items: list[dict[str, Any]]
    decisions: list[dict[str, Any]]
    conflict_status: str
    escalation_risk: str
    escalation_probability: float
    owner: str | None
    deadline: str | None
    suggested_response: str
    confidence: float
    workflow_status: str
    human_review: bool
    autonomous_action: str
    error_stage: str | None
    error_class: str | None
    evaluation_latency_seconds: float

    def model_dump(self, mode: str = "python") -> dict[str, Any]:
        """Mirror the Pydantic API used by the LangSmith evaluation target."""
        del mode
        return asdict(self)


def _empty_result(test_id: str, started: float, **updates: Any) -> OrchestratorResult:
    result: dict[str, Any] = {
        "test_id": test_id,
        "signal": {},
        "signal_status": "NOT_RUN",
        "signal_warnings": [],
        "context": {},
        "context_status": "NOT_RUN",
        "action_items": [],
        "decisions": [],
        "conflict_status": "NONE",
        "escalation_risk": "LOW",
        "escalation_probability": 0.10,
        "owner": None,
        "deadline": None,
        "suggested_response": "",
        "confidence": 0.0,
        "workflow_status": "FAILED",
        "human_review": True,
        "autonomous_action": "NONE",
        "error_stage": None,
        "error_class": None,
        "evaluation_latency_seconds": round(time.perf_counter() - started, 3),
    }
    result.update(updates)
    return OrchestratorResult(**result)


def _as_event(slack_event: str | dict[str, Any]) -> dict[str, Any]:
    if isinstance(slack_event, str):
        parsed = json.loads(slack_event)
    else:
        parsed = slack_event
    if not isinstance(parsed, dict):
        raise ValueError("slack_event must be a JSON object")
    if isinstance(parsed.get("event"), dict):
        return parsed["event"]
    return parsed


def _as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _confidence(value: Any, default: float = 0.95) -> float:
    if isinstance(value, (int, float)):
        return max(0.0, min(1.0, float(value)))
    return {"high": 0.95, "medium": 0.75, "low": 0.50}.get(str(value).lower(), default)


def _normalize_action_items(payload: Any) -> list[dict[str, Any]]:
    raw_items = payload.get("items", []) if isinstance(payload, dict) else []
    normalized: list[dict[str, Any]] = []
    for item in _as_list(raw_items):
        if not isinstance(item, dict):
            continue
        source_ids = [str(value) for value in _as_list(item.get("source_message_ids")) if value]
        task = item.get("title") or item.get("task")
        if not isinstance(task, str) or not task.strip():
            continue
        normalized.append(
            {
                "task": task.strip(),
                "owner": item.get("owner") if item.get("owner") else None,
                "deadline": item.get("due") or item.get("deadline") or None,
                "source_message_id": source_ids[0] if source_ids else item.get("source_message_id"),
                "status": item.get("status") or "OPEN",
                "type": item.get("type") or "Task",
                "source_message_ids": source_ids,
                "confidence": item.get("confidence") or "medium",
            }
        )
    return normalized


def _normalize_decisions(payload: Any) -> list[dict[str, Any]]:
    raw_items = payload.get("items", []) if isinstance(payload, dict) else []
    normalized: list[dict[str, Any]] = []
    for item in _as_list(raw_items):
        if not isinstance(item, dict) or not item.get("decision"):
            continue
        normalized.append(
            {
                "decision": item.get("decision"),
                "alternatives_considered": _as_list(item.get("alternatives_considered")),
                "participants": _as_list(item.get("participants")),
                "date": item.get("date"),
                "rationale": item.get("rationale"),
                "source_message_ids": _as_list(item.get("source_message_ids")),
                "confidence": item.get("confidence") or "medium",
                "supersession_link": item.get("supersession_link"),
            }
        )
    return normalized


def _escalation_values(text: str, classification: str) -> tuple[str, float]:
    if classification == "Escalation" or re.search(r"\b(escalat|leadership|executive|manager)\b", text, re.I):
        return "HIGH", 0.85
    if classification == "Incident" or re.search(r"\b(outage|sev[ -]?\d|critical)\b", text, re.I):
        return "MEDIUM", 0.45
    if classification == "Approval Request":
        return "MEDIUM", 0.35
    return "LOW", 0.10


def _evaluation_related_messages(event: dict[str, Any]) -> list[dict[str, Any]] | None:
    """Normalize golden-dataset history without changing normal Slack runs."""
    raw_history = event.get("synced_history")
    if not isinstance(raw_history, list):
        return None
    normalized: list[dict[str, Any]] = []
    for item in raw_history:
        if not isinstance(item, dict):
            continue
        message_id = item.get("id") or item.get("message_id")
        text = item.get("text")
        if not message_id or not isinstance(text, str) or not text.strip():
            continue
        normalized.append(
            {
                "id": str(message_id),
                "channel": item.get("channel") or event.get("channel") or "evaluation",
                "sender": item.get("sender") or "Evaluation user",
                "text": text,
                "classification": item.get("classification") or "FYI",
                "created_at": item.get("timestamp") or item.get("created_at") or event.get("timestamp"),
                "thread_ts": item.get("thread_id") or item.get("thread_ts") or event.get("thread_id"),
                "relationship": "Golden dataset synced history",
                "match_score": 0,
            }
        )
    return normalized


class SlackMessageOrchestrator:
    """Adapt the application workflow to the LangSmith evaluation contract."""

    def run(self, slack_event: str | dict[str, Any], test_id: str) -> OrchestratorResult:
        started = time.perf_counter()
        normalized_test_id = str(test_id or "UNKNOWN-CASE").strip() or "UNKNOWN-CASE"
        stage = "input"
        try:
            event = _as_event(slack_event)
            text = str(event.get("text", "")).strip()
            if not text:
                raise ValueError("slack_event.text is required")

            stage = "workflow"
            app.initialize_database()
            message_id = str(event.get("message_id") or f"smi-{normalized_test_id}")
            # Keep the visible LangSmith run name stable, but isolate each
            # execution from stale LangGraph checkpoints for the same case.
            run_id = f"smi-eval-{normalized_test_id}-{uuid.uuid4().hex}"
            mention = bool(event.get("mention")) or bool(
                re.search(r"<@[^>]+>|(?:^|\s)@[A-Za-z][\w.-]*", text)
            )
            message = app.run_message_workflow(
                text=text,
                sender=str(event.get("sender") or "Evaluation user"),
                channel=str(event.get("channel") or "evaluation"),
                external_id=f"smi-eval-{normalized_test_id}",
                mention=mention,
                thread_ts=event.get("thread_id") or event.get("thread_ts"),
                message_id=message_id,
                created_at=event.get("timestamp") or app.utc_now(),
                run_id=run_id,
                test_id=normalized_test_id,
                evaluation_related_messages=_evaluation_related_messages(event),
                mocked_context=event.get("mocked_context") if isinstance(event.get("mocked_context"), dict) else None,
            )

            priority = str(message.get("priority") or "medium")
            classification = str(message.get("classification") or "FYI")
            context_payload = message.get("context") if isinstance(message.get("context"), dict) else {}
            action_items = _normalize_action_items(message.get("action_extraction"))
            decisions = _normalize_decisions(message.get("decision_memory"))
            owner = next((item.get("owner") for item in action_items if item.get("owner")), None)
            deadline = next((item.get("deadline") for item in action_items if item.get("deadline")), None)
            if owner is None:
                owner = app.extract_owner(text)
            if deadline is None:
                deadline = app.extract_due(text)
            confidence = _confidence(context_payload.get("confidence"))
            related_messages = _as_list(context_payload.get("related_messages"))
            related_ids = context_payload.get("related_message_ids")
            if not isinstance(related_ids, list):
                related_ids = [item.get("id") for item in related_messages if isinstance(item, dict) and item.get("id")]
            context = {
                "briefing": str(context_payload.get("briefing") or ""),
                "key_facts": [str(item) for item in _as_list(context_payload.get("key_facts"))],
                "open_questions": [str(item) for item in _as_list(context_payload.get("open_questions"))],
                "related_message_ids": [str(item) for item in related_ids if item],
                "suggested_response": str(context_payload.get("suggested_response") or ""),
                "confidence": confidence,
            }
            risk, probability = _escalation_values(text, classification)
            signal = {
                "primary_type": CLASSIFICATION_TYPES.get(classification, classification.upper().replace(" ", "_")),
                "secondary_types": [],
                "priority": priority.upper(),
                "owner": owner,
                "action_required": classification != "FYI",
                "deadline": deadline,
                "incident_id": None,
                "work_item_ids": [],
                "silent_mention": False,
                "confidence": confidence,
            }
            return OrchestratorResult(
                test_id=normalized_test_id,
                signal=signal,
                signal_status="SUCCESS",
                signal_warnings=[],
                context=context,
                context_status="ENRICHED" if context_payload else "PARTIAL",
                action_items=action_items,
                decisions=decisions,
                conflict_status=str(context_payload.get("conflict_status") or "NONE").upper(),
                escalation_risk=risk,
                escalation_probability=probability,
                owner=owner,
                deadline=deadline,
                suggested_response=context["suggested_response"],
                confidence=confidence,
                workflow_status="COMPLETED",
                human_review=classification in {"Incident", "Escalation", "Approval Request", "Decision Needed"}
                or priority == "high",
                autonomous_action="NONE",
                error_stage=None,
                error_class=None,
                evaluation_latency_seconds=round(time.perf_counter() - started, 3),
            )
        except Exception as error:  # noqa: BLE001
            return _empty_result(
                normalized_test_id,
                started,
                signal_status="FAILED",
                signal_warnings=[f"{stage}: {type(error).__name__}"],
                error_stage=stage,
                error_class=type(error).__name__,
            )


orchestrator = SlackMessageOrchestrator()
