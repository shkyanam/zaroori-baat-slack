from __future__ import annotations

import hashlib
import hmac
import json
import mimetypes
import os
import re
import sqlite3
import time
import uuid
from contextlib import ExitStack, contextmanager
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import RLock
from typing import Any, Iterator, TypedDict
from urllib.parse import parse_qs, unquote, urlparse
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from langsmith import traceable
from langgraph.graph import END, START, StateGraph

ROOT = Path(__file__).parent


def load_local_env() -> None:
    if os.environ.get("ZAROORI_BAAT_SKIP_ENV") == "1":
        return
    env_path = Path(os.environ.get("ZAROORI_BAAT_ENV_FILE", ".env"))
    if not env_path.is_absolute():
        env_path = ROOT / env_path
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_local_env()
DATABASE_PATH = Path(os.environ.get("ZAROORI_BAAT_DATABASE_PATH", "zaroori_baat_slack.sqlite3"))
if not DATABASE_PATH.is_absolute():
    DATABASE_PATH = ROOT / DATABASE_PATH
SEED_DEMO = os.environ.get("ZAROORI_BAAT_SEED_DEMO", "true").lower() in {"1", "true", "yes", "on"}
HOST = os.environ.get("ZAROORI_BAAT_SLACK_HOST", "127.0.0.1")
PORT = int(os.environ.get("ZAROORI_BAAT_SLACK_PORT", "8001"))
SLACK_SIGNING_SECRET = os.environ.get("SLACK_SIGNING_SECRET", "")
SLACK_BOT_TOKEN = os.environ.get("SLACK_BOT_TOKEN", "").strip()
SLACK_CHANNEL_ID = os.environ.get("SLACK_CHANNEL_ID", "")
SLACK_CHANNEL_IDS = [
    channel_id.strip()
    for channel_id in os.environ.get("SLACK_CHANNEL_IDS", SLACK_CHANNEL_ID).split(",")
    if channel_id.strip()
]
LLM_API_KEY = os.environ.get("LLM_API_KEY") or os.environ.get("NEBIUS_API_KEY", "")
LLM_BASE_URL = (
    os.environ.get("LLM_BASE_URL")
    or os.environ.get("NEBIUS_BASE_URL")
    or "https://api.tokenfactory.nebius.com/v1"
)
LLM_MODEL = os.environ.get("LLM_MODEL") or os.environ.get("NEBIUS_MODEL", "")
LLM_CONTEXT_ENABLED = (
    os.environ.get("LLM_CONTEXT_ENABLED") or os.environ.get("NEBIUS_CONTEXT_ENABLED", "false")
).lower() in {"1", "true", "yes", "on"}
LLM_CONTEXT_MAX_RELATED = int(os.environ.get("LLM_CONTEXT_MAX_RELATED", "6"))
LLM_REQUEST_TIMEOUT_SECONDS = int(os.environ.get("LLM_REQUEST_TIMEOUT_SECONDS", "60"))
ACTION_TYPES = ("Task", "Follow-up", "Risk", "Decision")
MEM0_API_KEY = os.environ.get("MEM0_API_KEY", "")
MEM0_BASE_URL = os.environ.get("MEM0_BASE_URL", "https://api.mem0.ai")
MEM0_USER_ID = os.environ.get("MEM0_USER_ID", "zaroori-baat-workspace")
MEM0_ENABLED = os.environ.get("MEM0_ENABLED", "false").lower() in {"1", "true", "yes", "on"}
MEM0_MAX_RESULTS = int(os.environ.get("MEM0_MAX_RESULTS", "8"))
LANGGRAPH_CHECKPOINTER = os.environ.get("LANGGRAPH_CHECKPOINTER", "sqlite").lower()
LANGGRAPH_CHECKPOINT_PATH = Path(
    os.environ.get("LANGGRAPH_CHECKPOINT_PATH", str(ROOT / "zaroori_baat_langgraph_checkpoints.sqlite3"))
)
LANGGRAPH_POSTGRES_URI = os.environ.get("LANGGRAPH_POSTGRES_URI", "")
LANGSMITH_TRACING = os.environ.get("LANGSMITH_TRACING", "false").lower() in {"1", "true", "yes", "on"}
LANGSMITH_API_KEY = os.environ.get("LANGSMITH_API_KEY", "")
LANGSMITH_PROJECT = os.environ.get("LANGSMITH_PROJECT", "zaroori-baat-slack")
LANGSMITH_ENDPOINT = os.environ.get("LANGSMITH_ENDPOINT", "https://api.smith.langchain.com")
LANGSMITH_CAPTURE_CONTENT = os.environ.get("LANGSMITH_CAPTURE_CONTENT", "false").lower() in {
    "1", "true", "yes", "on"
}
if not LANGSMITH_CAPTURE_CONTENT:
    os.environ.setdefault("LANGSMITH_HIDE_INPUTS", "true")
    os.environ.setdefault("LANGSMITH_HIDE_OUTPUTS", "true")


@dataclass
class PriorityResult:
    priority: str
    classification: str
    score: int
    summary: str
    reason: str
    suggested_action: str


class MessageWorkflowState(TypedDict, total=False):
    """Serializable state carried through the Slack processing graph."""

    message_id: str
    run_id: str
    external_id: str | None
    sender: str
    text: str
    channel: str
    thread_ts: str | None
    mention: bool
    created_at: str
    priority_result: dict[str, Any]
    related_messages: list[dict[str, Any]]
    context: dict[str, Any]
    action_extraction: dict[str, Any]
    decision_memory: dict[str, Any]
    message: dict[str, Any]


def langsmith_status() -> dict[str, Any]:
    """Return safe LangSmith configuration without exposing the API key."""
    return {
        "provider": "langsmith",
        "enabled": LANGSMITH_TRACING,
        "configured": bool(LANGSMITH_API_KEY),
        "active": bool(LANGSMITH_TRACING and LANGSMITH_API_KEY),
        "project": LANGSMITH_PROJECT,
        "endpoint": LANGSMITH_ENDPOINT,
        "capture_content": LANGSMITH_CAPTURE_CONTENT,
    }


def trace_state_inputs(inputs: dict[str, Any]) -> dict[str, Any]:
    state = inputs.get("state", inputs)
    if not isinstance(state, dict):
        return {"input_type": type(state).__name__}
    summary: dict[str, Any] = {
        "message_id": state.get("message_id"),
        "channel": state.get("channel"),
        "thread_ts": state.get("thread_ts"),
        "classification": state.get("priority_result", {}).get("classification"),
    }
    text_value = state.get("text")
    if LANGSMITH_CAPTURE_CONTENT:
        summary["text"] = text_value
    elif isinstance(text_value, str):
        summary["text_length"] = len(text_value)
    return summary


def trace_node_outputs(output: Any) -> dict[str, Any]:
    if LANGSMITH_CAPTURE_CONTENT:
        return output if isinstance(output, dict) else {"output": output}
    if not isinstance(output, dict):
        return {"output_type": type(output).__name__}
    summary: dict[str, Any] = {}
    for key, value in output.items():
        if key == "message" and isinstance(value, dict):
            summary[key] = {
                field: value.get(field)
                for field in ("id", "priority", "classification", "score")
                if field in value
            }
        elif key in {"message_id", "priority_result", "context", "action_extraction", "decision_memory"}:
            if key == "priority_result" and isinstance(value, dict):
                summary[key] = {
                    field: value.get(field)
                    for field in ("priority", "classification", "score")
                    if field in value
                }
            elif isinstance(value, dict):
                summary[key] = {
                    field: value.get(field)
                    for field in ("agent", "status", "confidence")
                    if field in value
                }
                for collection in ("items", "sources", "related_messages"):
                    if isinstance(value.get(collection), list):
                        summary[key][f"{collection}_count"] = len(value[collection])
        elif isinstance(value, list):
            summary[f"{key}_count"] = len(value)
        elif key not in {"text", "briefing", "suggested_response", "memory", "title", "decision"}:
            summary[key] = value
    return summary


def trace_llm_inputs(inputs: dict[str, Any]) -> dict[str, Any]:
    evidence = inputs.get("evidence")
    summary = {
        "agent": inputs.get("agent_name"),
        "model": LLM_MODEL,
        "max_tokens": inputs.get("max_tokens"),
        "evidence_keys": sorted(evidence.keys()) if isinstance(evidence, dict) else [],
    }
    if LANGSMITH_CAPTURE_CONTENT:
        summary["instructions"] = inputs.get("instructions")
        summary["evidence"] = evidence
    return summary


def trace_llm_outputs(output: Any) -> dict[str, Any]:
    if LANGSMITH_CAPTURE_CONTENT:
        return output if isinstance(output, dict) else {"output": output}
    return {
        "result_type": type(output).__name__,
        "result_keys": sorted(output.keys()) if isinstance(output, dict) else [],
        "has_result": output is not None,
    }


def trace_mem0_inputs(inputs: dict[str, Any]) -> dict[str, Any]:
    payload = inputs.get("payload")
    summary = {
        "path": inputs.get("path"),
        "payload_keys": sorted(payload.keys()) if isinstance(payload, dict) else [],
    }
    if LANGSMITH_CAPTURE_CONTENT:
        summary["payload"] = payload
    return summary


ACTION_TERMS = re.compile(r"\b(please|need|needs|review|approve|confirm|respond|reply|send|fix|blocker|follow up|follow-up|assign|action)\b", re.I)
URGENCY_TERMS = re.compile(r"\b(urgent|asap|today|tonight|eod|deadline|blocked|blocking|critical|production|incident|by \d)\b", re.I)
LOW_VALUE_TERMS = re.compile(r"\b(fyi|lunch|happy birthday|welcome|random|newsletter|announcement)\b", re.I)
CLASSIFICATIONS = (
    "FYI",
    "Action Required",
    "Question",
    "Incident",
    "Escalation",
    "Approval Request",
    "Decision Needed",
)
APPROVAL_TERMS = re.compile(r"\b(approve|approved|approval|sign[- ]?off|authorize|authorise|permission)\b", re.I)
ESCALATION_TERMS = re.compile(r"\b(escalate|escalation|raise this|leadership|manager|executive)\b", re.I)
INCIDENT_TERMS = re.compile(
    r"\b(incident|outage|downtime|sev[ -]?[0-9]|production|prod|blocked|blocking|broken|failure|failed|failing|bug|error|degraded|rollback|hotfix)\b",
    re.I,
)
DECISION_TERMS = re.compile(r"\b(decision|decide|choose|choice|select|pick|recommendation|vote)\b", re.I)
DECISION_MADE_LANGUAGE = re.compile(
    r"\b(?:let(?:'s| us)\s+(?:use|go with|choose|select)|go with|we\s+(?:decided|agreed)|"
    r"decision\s*(?:is|:)|(?:use|choose|select|picked|selected|chose)\b.+?\b(?:instead of|rather than|over)\b|"
    r"(?:we\s+)?(?:picked|selected|chose)\s+)",
    re.I,
)
OPEN_DECISION_LANGUAGE = re.compile(
    r"^(?:should|could|can|would|maybe|perhaps|do we|are we|is it|we\s+(?:should|could|can)|"
    r"i\s+(?:suggest|recommend)|(?:let's|let us)\s+consider)\b",
    re.I,
)
QUESTION_TERMS = re.compile(r"^(what|why|how|when|where|who|which|can|could|would|is|are|do|does)\b", re.I)
REPORT_TERMS = re.compile(r"\b(report|reporting|dashboard|analytics)\b", re.I)
BUILD_TERMS = re.compile(r"\b(build|pipeline|deploy|deployment|release|ci/cd)\b", re.I)
WORK_ITEM_REFERENCE = re.compile(r"\b(?:task|work item|ticket|ado item|ado)[\s#:-]*(\d{5,})\b", re.I)
PR_REFERENCE = re.compile(r"\b(?:pr|pull request)[\s#:-]*(\d+)\b", re.I)
INCIDENT_REFERENCE = re.compile(r"\b(?:inc|incident)[\s#:-]*([A-Z]?\d{3,})\b", re.I)
STOP_WORDS = {
    "about", "after", "again", "also", "been", "before", "being", "could", "from", "have", "into",
    "just", "more", "need", "needs", "please", "that", "the", "their", "there", "this", "with", "would",
}


def classify_message(text: str) -> str:
    """Assign one of the desk's human-readable message classifications."""
    normalized = " ".join(text.split())
    question_text = re.sub(r"^(?:<@[^>]+>|<!channel>|<!here>)\s*", "", normalized)
    if APPROVAL_TERMS.search(normalized):
        return "Approval Request"
    if ESCALATION_TERMS.search(normalized):
        return "Escalation"
    if INCIDENT_TERMS.search(normalized):
        return "Incident"
    if DECISION_TERMS.search(normalized) or DECISION_MADE_LANGUAGE.search(normalized):
        return "Decision Needed"
    if "?" in normalized or QUESTION_TERMS.search(question_text):
        return "Question"
    if ACTION_TERMS.search(normalized) or URGENCY_TERMS.search(normalized):
        return "Action Required"
    return "FYI"


def build_mock_context(text: str, classification: str, related_messages: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """Return deterministic fallback findings when external context services are unavailable."""
    normalized = " ".join(text.split())
    related_messages = related_messages or []
    has_report = bool(REPORT_TERMS.search(normalized))
    has_build = bool(BUILD_TERMS.search(normalized))
    has_explicit_active_incident = bool(re.search(r"\b(active incident|ongoing incident|outage|sev[ -]?[0-9])\b", normalized, re.I))

    if has_report:
        work_item = "The report rollout task 63414893 appears related."
        latest_update = "The report was enabled."
        related_pr = "PR #8421 includes the report rollout change."
        previous_discussion = "Previous discussion in #analytics mentions rollout readiness."
    elif has_build:
        work_item = "The pipeline delivery task 63414902 appears related."
        latest_update = "The latest build completed in the mocked build history."
        related_pr = "PR #8424 contains the latest pipeline change."
        previous_discussion = "Previous discussion in #platform mentions the delivery work."
    elif classification in {"Action Required", "Approval Request", "Decision Needed"}:
        work_item = "No matching ADO work item found in the mocked search."
        latest_update = "No newer update found in the mocked systems."
        related_pr = "No related PRs found in the mocked repository."
        previous_discussion = "No previous discussion found in the mocked Slack history."
    else:
        work_item = "No matching ADO work item found in the mocked search."
        latest_update = "No newer update found in the mocked systems."
        related_pr = "No related PRs found in the mocked repository."
        previous_discussion = "No previous discussion found in the mocked Slack history."

    active_incidents = (
        "Mock incident INC-2401 is active and assigned to the Platform team."
        if has_explicit_active_incident and classification == "Incident"
        else "No active incidents found."
    )
    briefing = f"{work_item} Latest update: {latest_update} {active_incidents}"
    if classification == "Question":
        suggested_response = briefing if has_report else "I found no newer update in the mocked systems."
    elif classification == "Approval Request":
        suggested_response = "The related context is ready. Please review the latest update and approve if the acceptance criteria are met."
    elif classification == "Decision Needed":
        suggested_response = "The related context is ready. Please confirm which option should move forward."
    elif classification == "Incident":
        suggested_response = "I found the related incident context and will share the latest status with the owner."
    else:
        suggested_response = "I found related context and can follow up with the owner."

    return {
        "agent": "mock",
        "status": "complete",
        "summary": "Context enriched from mocked ADO, build history, incident system, related PRs, and previous discussions.",
        "briefing": briefing,
        "sources": [
            {"name": "ADO", "detail": work_item},
            {"name": "Build history", "detail": latest_update if has_report or has_build else "No matching build found in the mocked history."},
            {"name": "Incident system", "detail": active_incidents},
            {"name": "Related PRs", "detail": related_pr},
            {"name": "Previous discussions", "detail": previous_discussion},
        ],
        "related_work_item": work_item,
        "latest_update": latest_update,
        "active_incidents": active_incidents,
        "related_prs": related_pr,
        "previous_discussions": previous_discussion,
        "suggested_response": suggested_response,
        "related_messages": related_messages,
    }


def message_terms(text: str) -> set[str]:
    return {
        term.lower()
        for term in re.findall(r"[A-Za-z][A-Za-z0-9_-]{2,}", text)
        if term.lower() not in STOP_WORDS
    }


def message_references(text: str) -> set[str]:
    references = set(WORK_ITEM_REFERENCE.findall(text))
    references.update(PR_REFERENCE.findall(text))
    references.update(INCIDENT_REFERENCE.findall(text))
    return {reference.lower() for reference in references}


def find_related_messages(
    text: str,
    channel: str | None = None,
    thread_ts: str | None = None,
    exclude_message_id: str | None = None,
) -> list[dict[str, Any]]:
    """Retrieve likely related Slack messages from the locally synced Slack history."""
    terms = message_terms(text)
    references = message_references(text)
    with connection() as database:
        rows = database.execute(
            """
            SELECT id, channel, sender, text, classification, created_at, thread_ts
            FROM messages
            WHERE (? IS NULL OR id != ?)
            ORDER BY created_at DESC
            LIMIT 250
            """,
            (exclude_message_id, exclude_message_id),
        ).fetchall()

    matches: list[tuple[int, sqlite3.Row, set[str], set[str]]] = []
    for row in rows:
        candidate_terms = message_terms(row[3])
        overlap = terms & candidate_terms
        candidate_references = message_references(row[3])
        shared_references = references & candidate_references
        same_thread = bool(thread_ts and row[6] and row[6] == thread_ts)
        same_channel = bool(channel and row[1] == channel)
        if not overlap and not shared_references and not same_thread:
            continue
        score = len(overlap) * 3 + len(shared_references) * 8
        if same_thread:
            score += 12
        if same_channel:
            score += 2
        matches.append((score, row, overlap, shared_references))

    matches.sort(key=lambda match: (match[0], match[1][5]), reverse=True)
    related: list[dict[str, Any]] = []
    for score, row, overlap, shared_references in matches[:LLM_CONTEXT_MAX_RELATED]:
        relationship = "Same Slack thread" if thread_ts and row[6] == thread_ts else "Shared topic"
        if shared_references:
            relationship = "Shared reference: " + ", ".join(sorted(shared_references))
        related.append(
            {
                "id": row[0],
                "channel": row[1],
                "sender": row[2],
                "text": row[3][:400],
                "classification": row[4],
                "created_at": row[5],
                "relationship": relationship,
                "match_score": score,
            }
        )
    return related


def action_source_label(channel: str | None, thread_ts: str | None) -> str:
    if thread_ts:
        return f"Slack thread {thread_ts}"
    if channel:
        return f"Slack channel {channel}"
    return "Slack message"


def extract_owner(text: str) -> str | None:
    patterns = (
        r"\b([A-Z][a-z]{2,})\s+(?:can|will|should)\s+(?:own|handle|lead|take)\b",
        r"\bowner\s*(?:is|:)?\s*([A-Z][a-z]{2,})\b",
    )
    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            return match.group(1)
    return None


def extract_due(text: str) -> str | None:
    match = re.search(
        r"\b(?:by|before|until|due(?:\s+on)?|deadline(?:\s+is)?)\s+(?:(?:the|this|next)\s+)?"
        r"((?:today|tomorrow|tonight|eod|end of day|monday|tuesday|wednesday|thursday|friday|saturday|sunday)"
        r"(?:\s+\d{1,2}(?:st|nd|rd|th)?)?|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?)\b",
        text,
        re.I,
    )
    return match.group(1) if match else None


def clean_action_title(sentence: str) -> str:
    title = re.sub(r"^\s*(?:please|we|i|team)\s+", "", sentence, flags=re.I)
    title = re.sub(r"^(?:need|needs|must|should|have to|has to)\s+(?:to\s+)?", "", title, flags=re.I)
    title = re.sub(r"^(?:can|will|should)\s+own\s+", "Own ", title, flags=re.I)
    title = re.sub(r"^\s*(?:task|todo|to-do)\s*[:\-]?\s*", "", title, flags=re.I)
    return title.strip(" .\t\r\n")


def build_fallback_actions(
    text: str,
    channel: str | None,
    thread_ts: str | None,
    related_messages: list[dict[str, Any]],
    current_message_id: str | None = None,
) -> dict[str, Any]:
    """Extract obvious action signals locally when an LLM is unavailable."""
    message_parts = [
        {
            "id": current_message_id,
            "text": text,
        }
    ] + [
        {
            "id": related.get("id"),
            "text": str(related.get("text", "")),
        }
        for related in related_messages
    ]
    known_owner = extract_owner(" ".join(part["text"] for part in message_parts))
    default_source = action_source_label(channel, thread_ts)
    items: list[dict[str, Any]] = []
    action_terms = re.compile(r"\b(need|needs|must|should|please|todo|to-do|follow up|follow-up|own|handle|complete|deliver|validate|review)\b", re.I)
    risk_terms = re.compile(r"\b(risk|at risk|concern|blocked|blocking|dependency|may miss|might fail|failure)\b", re.I)
    decision_terms = re.compile(r"\b(decision|decide|agreed|approve|approved|choose|option|vote)\b", re.I)

    for part in message_parts:
        sentences = [sentence.strip() for sentence in re.split(r"(?:\n+|(?<=[.!?])\s+)", part["text"]) if sentence.strip()]
        for sentence in sentences:
            if risk_terms.search(sentence):
                action_type = "Risk"
            elif decision_terms.search(sentence) or DECISION_MADE_LANGUAGE.search(sentence):
                action_type = "Decision"
            elif re.search(r"\bfollow[- ]?up\b", sentence, re.I):
                action_type = "Follow-up"
            elif action_terms.search(sentence):
                action_type = "Task"
            else:
                continue
            title = clean_action_title(sentence)
            if len(title) < 4:
                continue
            source_ids = [part["id"]] if part["id"] else []
            items.append(
                {
                    "type": action_type,
                    "title": title,
                    "owner": extract_owner(sentence) or known_owner if action_type in {"Task", "Follow-up"} else None,
                    "due": extract_due(sentence),
                    "source": default_source,
                    "source_message_ids": source_ids,
                    "confidence": "medium",
                }
            )

    deduplicated: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for item in items:
        key = (item["type"], item["title"].lower())
        if key not in seen:
            deduplicated.append(item)
            seen.add(key)
    return {"agent": "mock", "status": "complete", "items": deduplicated}


def extract_participants(text: str) -> list[str]:
    names: list[str] = []
    patterns = (
        r"\b(?:participants?|attendees?)\s*[:\-]?\s+([^.!?]+)",
        r"\b(?:joined by|with)\s+([^.!?]+)",
        r"\b([A-Z][a-z]{2,})\s+(?:recommended|suggested|agreed|decided)\b",
    )
    for pattern in patterns:
        for match in re.finditer(pattern, text, re.I):
            value = match.group(1) if match.lastindex else match.group(0)
            for name in re.findall(r"\b[A-Z][a-z]{2,}\b", value):
                if name not in {"Decision", "Participants", "Attendees"} and name not in names:
                    names.append(name)
    return names


def build_fallback_decision_memory(
    text: str,
    channel: str | None,
    thread_ts: str | None,
    related_messages: list[dict[str, Any]],
    current_message_id: str | None = None,
    message_created_at: str | None = None,
) -> dict[str, Any]:
    """Capture obvious made decisions locally when the decision agent is unavailable."""
    message_parts = [{"id": current_message_id, "text": text}] + [
        {"id": related.get("id"), "text": str(related.get("text", ""))}
        for related in related_messages
    ]
    sentences = [
        (part, sentence.strip())
        for part in message_parts
        for sentence in re.split(r"(?:\n+|(?<=[.!?])\s+)", part["text"])
        if sentence.strip()
    ]
    made_decisions = [
        (part, sentence)
        for part, sentence in sentences
        if DECISION_MADE_LANGUAGE.search(sentence)
        and "?" not in sentence
        and not OPEN_DECISION_LANGUAGE.search(sentence)
    ]
    items: list[dict[str, Any]] = []
    source = action_source_label(channel, thread_ts)
    participants = extract_participants(" ".join(part["text"] for part in message_parts))
    rationale = next(
        (
            sentence.strip(" .")
            for _, sentence in sentences
            if re.search(r"\b(?:because|reason|disadvantages?|drawbacks?|trade[- ]?offs?|concerns?|cons?)\b", sentence, re.I)
        ),
        None,
    )

    for part, sentence in made_decisions:
        chosen = None
        alternative = None
        comparison = re.search(
            r"(?:let(?:'s| us)\s+(?:use|go with|choose|select)|go with|use|choose|select)\s+(.+?)\s+"
            r"(?:instead of|rather than|over)\s+(.+?)(?:[.!?]|$)",
            sentence,
            re.I,
        )
        if comparison:
            chosen = f"Use {comparison.group(1).strip()}"
            alternative = comparison.group(2).strip()
        else:
            decision_match = re.search(
                r"\b(?:decision\s*(?:is|:)|we\s+(?:decided|agreed)\s+(?:to\s+)?|(?:we\s+)?(?:picked|selected|chose)\s+)(.+?)(?:[.!?]|$)",
                sentence,
                re.I,
            )
            if decision_match:
                chosen = decision_match.group(1).strip()
        if not chosen:
            continue
        source_ids = [part["id"]] if part["id"] else []
        items.append(
            {
                "decision": chosen,
                "alternatives_considered": [alternative] if alternative else [],
                "participants": participants,
                "date": message_created_at or datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "rationale": rationale,
                "source": source,
                "source_message_ids": source_ids,
                "confidence": "medium",
            }
        )
    return {"agent": "mock", "status": "complete", "items": items}


def clean_string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item.strip() for item in value if isinstance(item, str) and item.strip()]


def call_llm_decision_memory_agent(
    text: str,
    related_messages: list[dict[str, Any]],
    source_context: dict[str, Any],
    current_message_id: str | None = None,
    message_created_at: str | None = None,
) -> list[dict[str, Any]] | None:
    evidence = {
        "current_slack_message": {
            "id": current_message_id,
            "text": text,
            "created_at": message_created_at,
        },
        "related_slack_messages": related_messages,
        "context_briefing": source_context.get("briefing", ""),
    }
    instructions = (
        "You are a Decision Memory Agent for Slack. Extract decisions that were actually made, not open questions or suggestions. "
        "Recognize statements such as 'Let's use A instead of B', 'we decided...', 'we agreed to...', 'selected A', or 'decision is A'. "
        "Combine fragments across the supplied Slack messages when they belong to the same discussion. Use only the supplied evidence. "
        "Do not invent participants, alternatives, dates, or reasons. If no decision was made, return {\"decisions\":[]}. "
        "Return only JSON with this shape: {\"decisions\":[{\"decision\":\"...\","
        "\"alternatives_considered\":[\"...\"],\"participants\":[\"...\"],\"date\":\"... or null\","
        "\"rationale\":\"... or null\",\"source_message_ids\":[\"...\"],"
        "\"confidence\":\"high|medium|low\"}]}"
    )
    parsed = call_llm_json_agent("Decision memory LLM", instructions, evidence, max_tokens=600)
    if not parsed or not isinstance(parsed.get("decisions"), list):
        return None
    valid_ids = {str(message.get("id")) for message in related_messages if message.get("id")}
    if current_message_id:
        valid_ids.add(current_message_id)
    decisions: list[dict[str, Any]] = []
    for item in parsed["decisions"]:
        if not isinstance(item, dict) or not isinstance(item.get("decision"), str):
            continue
        decision = item["decision"].strip()
        if not decision:
            continue
        source_ids = [str(message_id) for message_id in clean_string_list(item.get("source_message_ids")) if str(message_id) in valid_ids]
        participants = [
            participant
            for participant in clean_string_list(item.get("participants"))
            if not re.fullmatch(r"<?@?[UW][A-Z0-9]+>?", participant)
        ]
        date = item.get("date") if isinstance(item.get("date"), str) and item.get("date").strip() else None
        rationale = item.get("rationale") if isinstance(item.get("rationale"), str) and item.get("rationale").strip() else None
        decisions.append(
            {
                "decision": decision,
                "alternatives_considered": clean_string_list(item.get("alternatives_considered")),
                "participants": participants,
                "date": date,
                "rationale": rationale,
                "source_message_ids": source_ids,
                "confidence": item.get("confidence") if item.get("confidence") in {"high", "medium", "low"} else "medium",
            }
        )
    return decisions


def extract_decision_memory(
    text: str,
    channel: str | None,
    thread_ts: str | None,
    related_messages: list[dict[str, Any]],
    source_context: dict[str, Any],
    current_message_id: str | None = None,
    message_created_at: str | None = None,
    use_llm: bool = True,
) -> dict[str, Any]:
    fallback = build_fallback_decision_memory(
        text,
        channel,
        thread_ts,
        related_messages,
        current_message_id,
        message_created_at,
    )
    if not fallback["items"] or not use_llm:
        return fallback
    llm_decisions = call_llm_decision_memory_agent(
        text,
        related_messages,
        source_context,
        current_message_id,
        message_created_at,
    )
    if llm_decisions is None or (not llm_decisions and fallback["items"]):
        return fallback
    all_ids = [current_message_id] if current_message_id else []
    all_ids.extend(str(message.get("id")) for message in related_messages if message.get("id"))
    source = action_source_label(channel, thread_ts)
    for decision in llm_decisions:
        decision["source"] = source
        if not decision["date"]:
            decision["date"] = message_created_at or utc_now()
        if not decision["source_message_ids"]:
            decision["source_message_ids"] = all_ids[:]
    return {"agent": "llm", "status": "complete", "items": llm_decisions}


CONTEXT_AGENT_SCHEMA = {
    "type": "object",
    "properties": {
        "briefing": {"type": "string"},
        "suggested_response": {"type": "string"},
        "key_facts": {"type": "array", "items": {"type": "string"}},
        "open_questions": {"type": "array", "items": {"type": "string"}},
        "related_message_ids": {"type": "array", "items": {"type": "string"}},
        "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
    },
    "required": ["briefing", "suggested_response", "key_facts", "open_questions", "related_message_ids", "confidence"],
    "additionalProperties": False,
}


def chat_completion_text(payload: dict[str, Any]) -> str:
    choices = payload.get("choices", [])
    if not choices or not isinstance(choices[0], dict):
        return ""
    message = choices[0].get("message", {})
    content = message.get("content", "") if isinstance(message, dict) else ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            part.get("text", "") for part in content if isinstance(part, dict) and isinstance(part.get("text"), str)
        )
    return ""


def llm_chat_completions_url() -> str:
    base_url = LLM_BASE_URL.rstrip("/")
    if base_url.endswith("/chat/completions"):
        return base_url
    if base_url.endswith("/v1"):
        return f"{base_url}/chat/completions"
    return f"{base_url}/v1/chat/completions"


def mem0_endpoint(path: str) -> str:
    return f"{MEM0_BASE_URL.rstrip('/')}/{path.lstrip('/')}"


def mem0_status() -> dict[str, Any]:
    return {
        "provider": "mem0",
        "enabled": MEM0_ENABLED,
        "configured": bool(MEM0_API_KEY),
        "active": bool(MEM0_ENABLED and MEM0_API_KEY),
        "user_id": MEM0_USER_ID,
    }


@traceable(
    name="Mem0 API call",
    run_type="tool",
    process_inputs=trace_mem0_inputs,
    process_outputs=trace_llm_outputs,
)
def call_mem0_json(path: str, payload: dict[str, Any]) -> dict[str, Any] | None:
    if not (MEM0_ENABLED and MEM0_API_KEY):
        return None
    request = Request(
        mem0_endpoint(path),
        data=json.dumps(payload).encode(),
        headers={
            "Authorization": f"Token {MEM0_API_KEY}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=LLM_REQUEST_TIMEOUT_SECONDS) as response:
            result = json.loads(response.read())
        return result if isinstance(result, dict) else None
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f"Mem0 unavailable; using local decision memory: {error}")
        return None


def decision_memory_text(item: dict[str, Any]) -> str:
    lines = [f"Decision: {item.get('decision', '')}"]
    alternatives = item.get("alternatives_considered") or []
    participants = item.get("participants") or []
    if alternatives:
        lines.append("Alternatives considered: " + ", ".join(str(value) for value in alternatives))
    if participants:
        lines.append("Participants: " + ", ".join(str(value) for value in participants))
    if item.get("date"):
        lines.append(f"Date: {item['date']}")
    if item.get("rationale"):
        lines.append(f"Reason: {item['rationale']}")
    if item.get("source"):
        lines.append(f"Source: {item['source']}")
    return "\n".join(lines)


def store_decision_memories(
    decision_memory: dict[str, Any],
    channel: str | None,
    thread_ts: str | None,
    current_message_id: str | None,
    message_created_at: str | None,
) -> dict[str, Any]:
    items = decision_memory.get("items", []) if isinstance(decision_memory, dict) else []
    if not items:
        return {"provider": "mem0", "status": "no_decisions", "stored": False, "items": []}
    if not (MEM0_ENABLED and MEM0_API_KEY):
        return {
            "provider": "mem0",
            "status": "disabled",
            "stored": False,
            "items": [],
            "message": "Add MEM0_API_KEY and set MEM0_ENABLED=true to enable semantic memory.",
        }

    stored: list[dict[str, Any]] = []
    failures = 0
    for item in items:
        source_ids = [str(value) for value in item.get("source_message_ids", []) if value]
        metadata = {
            "memory_type": "decision",
            "source_message_id": str(current_message_id or ""),
            "source_message_ids": ",".join(source_ids),
            "channel": str(channel or ""),
            "thread_ts": str(thread_ts or ""),
            "decision_date": str(item.get("date") or message_created_at or ""),
            "participants": ", ".join(str(value) for value in item.get("participants", []) if value),
            "alternatives_considered": ", ".join(str(value) for value in item.get("alternatives_considered", []) if value),
            "confidence": str(item.get("confidence") or "medium"),
        }
        result = call_mem0_json(
            "/v3/memories/add/",
            {
                "messages": [{"role": "user", "content": decision_memory_text(item)}],
                "user_id": MEM0_USER_ID,
                "metadata": metadata,
            },
        )
        if not result:
            failures += 1
            continue
        memories = result.get("results", [])
        memory_ids = [str(memory.get("id")) for memory in memories if isinstance(memory, dict) and memory.get("id")]
        event_id = result.get("event_id")
        events = [memory.get("event") for memory in memories if isinstance(memory, dict) and memory.get("event")]
        pending = bool(event_id and not memory_ids)
        if pending:
            # Mem0 may acknowledge writes asynchronously with an event ID.
            # Treat that acknowledgement as accepted so sync does not retry it.
            memory_ids = [str(event_id)]
            events.append(str(result.get("status") or "PENDING"))
        stored.append(
            {
                "source_message_id": current_message_id,
                "memory_ids": memory_ids,
                "events": events,
                "pending": pending,
            }
        )
        if not memory_ids:
            failures += 1

    return {
        "provider": "mem0",
        "status": "complete" if not failures else ("partial" if stored else "unavailable"),
        "stored": bool(stored and not failures),
        "items": stored,
        "failed_items": failures,
    }


def ensure_mem0_decision_memory(
    decision_memory: dict[str, Any],
    channel: str | None,
    thread_ts: str | None,
    current_message_id: str | None,
    message_created_at: str | None,
) -> dict[str, Any]:
    previous = decision_memory.get("memory_store", {}) if isinstance(decision_memory, dict) else {}
    if previous.get("stored"):
        return decision_memory
    decision_memory["memory_store"] = store_decision_memories(
        decision_memory,
        channel,
        thread_ts,
        current_message_id,
        message_created_at,
    )
    return decision_memory


def normalize_mem0_results(payload: dict[str, Any]) -> list[dict[str, Any]]:
    matches: list[dict[str, Any]] = []
    for item in payload.get("results", []):
        if not isinstance(item, dict) or not isinstance(item.get("memory"), str):
            continue
        matches.append(
            {
                "id": str(item.get("id", "")),
                "memory": item["memory"],
                "metadata": item.get("metadata", {}) if isinstance(item.get("metadata"), dict) else {},
                "created_at": item.get("created_at"),
                "score": item.get("score"),
            }
        )
    return matches[:MEM0_MAX_RESULTS]


def local_decision_memory_search(query: str) -> list[dict[str, Any]]:
    ignored = STOP_WORDS | {"we", "did", "do", "what", "decide", "decision", "team", "memory"}
    query_terms = {term for term in re.findall(r"[a-z0-9]+", query.lower()) if len(term) > 2 and term not in ignored}
    with connection() as database:
        rows = database.execute(
            "SELECT id, channel, thread_ts, text, decision_memory_json, created_at FROM messages"
        ).fetchall()
    sources_by_id = {row[0]: row for row in rows}
    # Context enrichment repeats decisions in other message envelopes. Resolve
    # their evidence first so copies cannot inflate results or supply unrelated
    # search terms, timestamps, and source links.
    unique: dict[tuple[tuple[str, ...], str], tuple[sqlite3.Row, dict[str, Any], list[str]]] = {}
    for row in rows:
        try:
            decision_memory = json.loads(row[4] or "{}")
        except json.JSONDecodeError:
            continue
        for item in decision_memory.get("items", []) if isinstance(decision_memory, dict) else []:
            if not isinstance(item, dict) or not item.get("decision"):
                continue
            source_ids = clean_string_list(item.get("source_message_ids")) or [row[0]]
            key = (tuple(sorted(set(source_ids))), " ".join(re.findall(r"\w+", str(item["decision"]).casefold())))
            previous = unique.get(key)
            if previous is None or (row[0] in source_ids and previous[0][0] not in source_ids):
                unique[key] = (row, item, source_ids)

    matches: list[tuple[int, str, dict[str, Any]]] = []
    for key, (envelope, item, source_ids) in unique.items():
        source_rows = [sources_by_id[source_id] for source_id in source_ids if source_id in sources_by_id]
        original = source_rows[0] if source_rows else None
        source_id = original[0] if original else source_ids[0]
        searchable = " ".join(
            [
                str(item.get("decision", "")),
                " ".join(clean_string_list(item.get("alternatives_considered"))),
                " ".join(clean_string_list(item.get("participants"))),
                str(item.get("rationale") or ""),
                " ".join(source[3] for source in source_rows),
            ]
        ).lower()
        overlap = len(query_terms & set(re.findall(r"[a-z0-9]+", searchable)))
        if query_terms and not overlap:
            continue
        channel = original[1] if original else ""
        thread_ts = original[2] if original else ""
        created_at = item.get("date") or (original[5] if original else envelope[5])
        memory_item = {**item, "source": action_source_label(channel, thread_ts)}
        stable_id = hashlib.sha256(json.dumps(key).encode()).hexdigest()[:16]
        matches.append(
            (
                overlap,
                created_at,
                {
                    "id": f"local-{stable_id}",
                    "memory": decision_memory_text(memory_item),
                    "metadata": {
                        "memory_type": "decision",
                        "source_message_id": source_id,
                        "source_message_ids": source_ids,
                        "channel": channel,
                        "thread_ts": thread_ts or "",
                    },
                    "created_at": created_at,
                    "score": overlap,
                },
            )
        )
    matches.sort(key=lambda match: (match[0], match[1]), reverse=True)
    return [match[2] for match in matches[:MEM0_MAX_RESULTS]]


def call_llm_decision_memory_answer(query: str, matches: list[dict[str, Any]]) -> str | None:
    if not matches:
        return None
    instructions = (
        "You answer questions using only stored organizational decision memories. Do not invent facts. "
        "If the memories do not answer the question, say that no matching decision was found. "
        "Return only JSON with one key: answer (string). Keep the answer concise and include the decision, reason, date, and source when available."
    )
    parsed = call_llm_json_agent(
        "Decision memory answer LLM",
        instructions,
        {"question": query, "stored_decision_memories": matches},
        max_tokens=400,
    )
    if parsed and isinstance(parsed.get("answer"), str) and parsed["answer"].strip():
        return parsed["answer"].strip()
    return None


def search_decision_memories(query: str) -> dict[str, Any]:
    query = query.strip()
    if not query:
        raise ValueError("query is required")
    provider = "local"
    status = "disabled" if not (MEM0_ENABLED and MEM0_API_KEY) else "fallback"
    matches: list[dict[str, Any]] = []
    if MEM0_ENABLED and MEM0_API_KEY:
        result = call_mem0_json(
            "/v3/memories/search/",
            {
                "query": query,
                # Scope searches to this app's Mem0 user. Metadata filters vary
                # by Mem0 API version, and the dedicated user scope is sufficient
                # because this integration only stores decision memories here.
                "filters": {"user_id": MEM0_USER_ID},
                "top_k": MEM0_MAX_RESULTS,
                "threshold": 0.0,
            },
        )
        if result is not None:
            provider = "mem0"
            status = "complete"
            matches = normalize_mem0_results(result)
    if not matches:
        local_matches = local_decision_memory_search(query)
        if provider == "mem0" and not local_matches:
            status = "complete"
        elif provider != "mem0":
            matches = local_matches
        else:
            matches = local_matches
            status = "mem0_empty_local_fallback"
    matches = with_slack_identity_names(matches)
    answer = call_llm_decision_memory_answer(query, matches)
    if answer is None:
        answer = (
            "No matching stored decision was found."
            if not matches
            else "Stored decision memory: " + " ".join(match["memory"].splitlines()[0] for match in matches[:3])
        )
    return {
        "query": query,
        "provider": provider,
        "status": status,
        "matches": matches,
        "answer": answer,
        "mem0": mem0_status(),
    }


def sync_saved_decision_memories() -> dict[str, Any]:
    if not (MEM0_ENABLED and MEM0_API_KEY):
        return {"provider": "mem0", "status": "disabled", "synced": 0, "failed": 0, "mem0": mem0_status()}
    synced = 0
    failed = 0
    with connection() as database:
        rows = database.execute(
            "SELECT id, channel, thread_ts, decision_memory_json, created_at FROM messages WHERE decision_memory_json != '{}'"
        ).fetchall()
        for row in rows:
            try:
                decision_memory = json.loads(row[3] or "{}")
            except json.JSONDecodeError:
                continue
            if not isinstance(decision_memory, dict) or not decision_memory.get("items"):
                continue
            decision_memory = ensure_mem0_decision_memory(decision_memory, row[1], row[2], row[0], row[4])
            if decision_memory.get("memory_store", {}).get("stored"):
                synced += 1
            else:
                failed += 1
            database.execute(
                "UPDATE messages SET decision_memory_json = ? WHERE id = ?",
                (json.dumps(decision_memory), row[0]),
            )
        database.commit()
    return {"provider": "mem0", "status": "complete" if not failed else "partial", "synced": synced, "failed": failed, "mem0": mem0_status()}


@traceable(
    name="Nebius JSON agent",
    run_type="llm",
    process_inputs=trace_llm_inputs,
    process_outputs=trace_llm_outputs,
)
def call_llm_json_agent(
    agent_name: str,
    instructions: str,
    evidence: dict[str, Any],
    max_tokens: int = 800,
) -> dict[str, Any] | None:
    if not (LLM_API_KEY and LLM_BASE_URL and LLM_MODEL and LLM_CONTEXT_ENABLED):
        return None
    request_body = {
        "model": LLM_MODEL,
        "messages": [
            {"role": "system", "content": instructions},
            {"role": "user", "content": json.dumps(evidence)},
        ],
        "temperature": 0.1,
        "max_tokens": max_tokens,
        "response_format": {"type": "json_object"},
    }
    request = Request(
        llm_chat_completions_url(),
        data=json.dumps(request_body).encode(),
        headers={
            "Authorization": f"Bearer {LLM_API_KEY}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=LLM_REQUEST_TIMEOUT_SECONDS) as response:
            result = json.loads(response.read())
        parsed = json.loads(chat_completion_text(result))
        return parsed if isinstance(parsed, dict) else None
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f"{agent_name} unavailable; using fallback extraction: {error}")
        return None


def call_llm_context_agent(
    text: str,
    classification: str,
    related_messages: list[dict[str, Any]],
    source_context: dict[str, Any],
) -> dict[str, Any] | None:
    evidence = {
        "current_slack_message": {"text": text, "classification": classification},
        "related_slack_messages": related_messages,
        "mocked_system_findings": source_context.get("sources", []),
    }
    instructions = (
        "You are a Slack context enrichment agent. Synthesize the current Slack message with the related Slack messages and system findings. "
        "Use only the supplied evidence. Do not invent work items, incidents, owners, dates, PRs, or updates. "
        "If evidence is missing, say that it was not found. Keep the briefing concise, explain the relationship between messages, "
        "and draft a safe suggested response that does not claim unsupported facts. Return only JSON with these keys: "
        "briefing (string), suggested_response (string), key_facts (array of strings), open_questions (array of strings), "
        "related_message_ids (array of strings), and confidence (high, medium, or low)."
    )
    parsed = call_llm_json_agent("Context LLM", instructions, evidence)
    if not parsed:
        return None
    if not all(isinstance(parsed.get(field), str) for field in ("briefing", "suggested_response", "confidence")):
        return None
    if parsed["confidence"] not in {"high", "medium", "low"}:
        return None
    for field in ("key_facts", "open_questions", "related_message_ids"):
        if not isinstance(parsed.get(field), list) or not all(isinstance(item, str) for item in parsed[field]):
            return None
    return parsed


def call_llm_action_agent(
    text: str,
    related_messages: list[dict[str, Any]],
    source_context: dict[str, Any],
    current_message_id: str | None = None,
) -> list[dict[str, Any]] | None:
    evidence = {
        "current_slack_message": {"id": current_message_id, "text": text},
        "related_slack_messages": related_messages,
        "context_briefing": source_context.get("briefing", ""),
    }
    instructions = (
        "You are an Action Extraction Agent for Slack. Combine the current message with related Slack messages and extract only "
        "explicit or strongly implied tasks, follow-ups, risks, and decisions. Merge fragments that belong to the same action. "
        "Use only supplied evidence: do not invent an owner, due date, decision, or risk. Keep titles concise and actionable. "
        "Return only JSON with this shape: {\"actions\":[{\"type\":\"Task|Follow-up|Risk|Decision\","
        "\"title\":\"...\",\"owner\":\"name or null\",\"due\":\"due date or null\","
        "\"source_message_ids\":[\"message id\"],\"confidence\":\"high|medium|low\"}]}"
    )
    parsed = call_llm_json_agent("Action extraction LLM", instructions, evidence, max_tokens=600)
    if not parsed or not isinstance(parsed.get("actions"), list):
        return None
    valid_ids = {str(message.get("id")) for message in related_messages if message.get("id")}
    if current_message_id:
        valid_ids.add(current_message_id)
    actions: list[dict[str, Any]] = []
    for item in parsed["actions"]:
        if not isinstance(item, dict) or item.get("type") not in ACTION_TYPES or not isinstance(item.get("title"), str):
            continue
        title = item["title"].strip()
        if not title:
            continue
        source_ids = [str(message_id) for message_id in item.get("source_message_ids", []) if str(message_id) in valid_ids]
        owner = item.get("owner") if isinstance(item.get("owner"), str) and item.get("owner").strip() else None
        if owner and re.fullmatch(r"<?@?[UW][A-Z0-9]+>?", owner.strip()):
            owner = None
        actions.append(
            {
                "type": item["type"],
                "title": title,
                "owner": owner,
                "due": item.get("due") if isinstance(item.get("due"), str) and item.get("due").strip() else None,
                "source_message_ids": source_ids,
                "confidence": item.get("confidence") if item.get("confidence") in {"high", "medium", "low"} else "medium",
            }
        )
    return actions


def extract_actions(
    text: str,
    channel: str | None,
    thread_ts: str | None,
    related_messages: list[dict[str, Any]],
    source_context: dict[str, Any],
    current_message_id: str | None = None,
    use_llm: bool = True,
) -> dict[str, Any]:
    fallback = build_fallback_actions(text, channel, thread_ts, related_messages, current_message_id)
    if not use_llm:
        return fallback
    llm_actions = call_llm_action_agent(text, related_messages, source_context, current_message_id)
    if llm_actions is None:
        return fallback
    explicit_owners = {
        owner: str(message.get("id"))
        for message in related_messages
        if (owner := extract_owner(str(message.get("text", "")))) and message.get("id")
    }
    if len(explicit_owners) == 1:
        owner, owner_message_id = next(iter(explicit_owners.items()))
        for action in llm_actions:
            if action["type"] in {"Task", "Follow-up"} and not action["owner"]:
                action["owner"] = owner
                if owner_message_id not in action["source_message_ids"]:
                    action["source_message_ids"].append(owner_message_id)
    all_ids = [current_message_id] if current_message_id else []
    all_ids.extend(str(message.get("id")) for message in related_messages if message.get("id"))
    source = action_source_label(channel, thread_ts)
    for action in llm_actions:
        action["source"] = source
        if not action["source_message_ids"]:
            action["source_message_ids"] = all_ids[:]
    return {"agent": "llm", "status": "complete", "items": llm_actions}


def synthesize_context(
    text: str,
    classification: str,
    related_messages: list[dict[str, Any]],
) -> dict[str, Any]:
    """Build system findings and optionally synthesize them with Nebius."""
    context = build_mock_context(text, classification, related_messages)
    llm_result = call_llm_context_agent(text, classification, related_messages, context)
    if llm_result:
        related_ids = set(llm_result["related_message_ids"])
        context.update(
            {
                "agent": "llm",
                "briefing": llm_result["briefing"],
                "suggested_response": llm_result["suggested_response"],
                "key_facts": llm_result["key_facts"],
                "open_questions": llm_result["open_questions"],
                "related_message_ids": [message["id"] for message in related_messages if message["id"] in related_ids],
                "confidence": llm_result["confidence"],
            }
        )
    return context


def enrich_context(
    text: str,
    classification: str,
    channel: str | None = None,
    thread_ts: str | None = None,
    exclude_message_id: str | None = None,
    current_message_id: str | None = None,
    message_created_at: str | None = None,
) -> dict[str, Any]:
    related_messages = find_related_messages(text, channel, thread_ts, exclude_message_id)
    context = synthesize_context(text, classification, related_messages)
    context["action_extraction"] = extract_actions(
        text,
        channel,
        thread_ts,
        related_messages,
        context,
        current_message_id,
    )
    context["decision_memory"] = extract_decision_memory(
        text,
        channel,
        thread_ts,
        related_messages,
        context,
        current_message_id,
        message_created_at,
    )
    return context


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def prioritize_message(text: str, mention: bool = False) -> PriorityResult:
    normalized = " ".join(text.split())
    action_hits = len(ACTION_TERMS.findall(normalized))
    urgency_hits = len(URGENCY_TERMS.findall(normalized))
    low_value_hits = len(LOW_VALUE_TERMS.findall(normalized))
    score = min(100, action_hits * 18 + urgency_hits * 24 + (18 if mention else 0) + (8 if "?" in normalized else 0))

    classification = classify_message(normalized)

    if urgency_hits or score >= 60:
        priority = "high"
        suggested_action = "Review and assign an owner"
        reason = "The message signals urgency, a blocker, or an explicit action with a deadline."
    elif action_hits or score >= 25:
        priority = "medium"
        suggested_action = "Review today"
        reason = "The message appears actionable but does not signal an immediate incident."
    elif low_value_hits:
        priority = "low"
        score = max(score, 8)
        suggested_action = "Monitor"
        reason = "The message looks informational or social and has no clear action request."
    else:
        priority = "medium"
        score = max(score, 20)
        suggested_action = "Review for context"
        reason = "The message needs human context before it can be safely deprioritized."

    return PriorityResult(priority, classification, score, normalized[:140], reason, suggested_action)


@contextmanager
def connection() -> Iterator[sqlite3.Connection]:
    database = sqlite3.connect(DATABASE_PATH, timeout=30, check_same_thread=False)
    database.row_factory = sqlite3.Row
    database.execute("PRAGMA busy_timeout = 30000")
    try:
        with database:
            yield database
    finally:
        # SQLite's transaction context does not close its connection. Closing
        # explicitly prevents leaked handles and locked database files on Windows.
        database.close()


def initialize_database() -> None:
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with connection() as database:
        database.execute("CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        database.execute("""
            CREATE TABLE IF NOT EXISTS slack_identity_cache (
                namespace TEXT NOT NULL,
                kind TEXT NOT NULL,
                slack_id TEXT NOT NULL,
                display_name TEXT,
                expires_at REAL NOT NULL,
                PRIMARY KEY (namespace, kind, slack_id)
            )
        """)
        database.execute(
            """
            CREATE TABLE IF NOT EXISTS workflow_runs (
                run_id TEXT PRIMARY KEY,
                message_id TEXT NOT NULL,
                channel TEXT,
                status TEXT NOT NULL,
                started_at TEXT NOT NULL,
                completed_at TEXT,
                duration_ms INTEGER,
                classification TEXT,
                context_agent TEXT,
                action_agent TEXT,
                decision_agent TEXT,
                error TEXT
            )
            """
        )
        database.execute(
            "CREATE INDEX IF NOT EXISTS idx_workflow_runs_started_at ON workflow_runs(started_at DESC)"
        )
        database.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                external_id TEXT UNIQUE,
                channel TEXT NOT NULL,
                thread_ts TEXT,
                sender TEXT NOT NULL,
                text TEXT NOT NULL,
                priority TEXT NOT NULL,
                classification TEXT NOT NULL DEFAULT 'FYI',
                context_json TEXT NOT NULL DEFAULT '{}',
                actions_json TEXT NOT NULL DEFAULT '{}',
                decision_memory_json TEXT NOT NULL DEFAULT '{}',
                score INTEGER NOT NULL,
                summary TEXT NOT NULL,
                reason TEXT NOT NULL,
                suggested_action TEXT NOT NULL,
                decision TEXT,
                created_at TEXT NOT NULL,
                decided_at TEXT
            )
        """)
        columns = {row[1] for row in database.execute("PRAGMA table_info(messages)").fetchall()}
        if "classification" not in columns:
            database.execute("ALTER TABLE messages ADD COLUMN classification TEXT NOT NULL DEFAULT 'FYI'")
        if "context_json" not in columns:
            database.execute("ALTER TABLE messages ADD COLUMN context_json TEXT NOT NULL DEFAULT '{}'")
        if "thread_ts" not in columns:
            database.execute("ALTER TABLE messages ADD COLUMN thread_ts TEXT")
        if "actions_json" not in columns:
            database.execute("ALTER TABLE messages ADD COLUMN actions_json TEXT NOT NULL DEFAULT '{}'")
        if "decision_memory_json" not in columns:
            database.execute("ALTER TABLE messages ADD COLUMN decision_memory_json TEXT NOT NULL DEFAULT '{}'")
        database.commit()
        for row in database.execute(
            "SELECT id, text, classification, channel, thread_ts, context_json, actions_json, decision_memory_json, created_at FROM messages"
        ).fetchall():
            classification = classify_message(row[1])
            try:
                existing_context = json.loads(row[5] or "{}")
            except json.JSONDecodeError:
                existing_context = {}
            if not row[6] or row[6] == "{}":
                fallback_actions = build_fallback_actions(
                    row[1], row[3], row[4], existing_context.get("related_messages", []), row[0]
                )
                database.execute(
                    "UPDATE messages SET classification = ?, actions_json = ? WHERE id = ?",
                    (classification, json.dumps(fallback_actions), row[0]),
                )
            else:
                database.execute("UPDATE messages SET classification = ? WHERE id = ?", (classification, row[0]))
            if not row[7] or row[7] == "{}":
                fallback_decisions = build_fallback_decision_memory(
                    row[1],
                    row[3],
                    row[4],
                    existing_context.get("related_messages", []),
                    row[0],
                    row[8],
                )
                database.execute(
                    "UPDATE messages SET decision_memory_json = ? WHERE id = ?",
                    (json.dumps(fallback_decisions), row[0]),
                )
        database.commit()


_SLACK_IDENTITY_LOCK = RLock()
_SLACK_IDENTITY_EXECUTOR: ThreadPoolExecutor | None = None
_SLACK_IDENTITY_PENDING: set[tuple[str, str, str, str]] = set()
_SLACK_IDENTITY_BACKOFF: dict[tuple[str, str], float] = {}
SLACK_IDENTITY_TTL_SECONDS = 6 * 60 * 60
SLACK_IDENTITY_RETRY_SECONDS = 5 * 60
SLACK_IDENTITY_TIMEOUT_SECONDS = 3


def _slack_identity_rows(database_path: Path, namespace: str) -> dict[tuple[str, str], tuple[str | None, float]]:
    database = sqlite3.connect(database_path, timeout=3)
    try:
        return {
            (row[0], row[1]): (row[2], row[3])
            for row in database.execute(
                "SELECT kind, slack_id, display_name, expires_at FROM slack_identity_cache WHERE namespace = ?",
                (namespace,),
            )
        }
    finally:
        database.close()


def _fetch_slack_identity(database_path: Path, namespace: str, token: str, kind: str, slack_id: str) -> None:
    """Background-only lookup; failures retain any previously resolved name."""
    cache = _slack_identity_rows(database_path, namespace)
    existing = cache.get((kind, slack_id))
    now = time.time()
    if existing and existing[1] > now:
        return
    with _SLACK_IDENTITY_LOCK:
        if _SLACK_IDENTITY_BACKOFF.get((namespace, kind), 0) > now:
            return
    method, parameter = ("users.info", "user") if kind == "sender" else ("conversations.info", "channel")
    display_name = None
    retry_seconds = SLACK_IDENTITY_RETRY_SECONDS
    method_backoff = False
    authorization_error = False
    try:
        request = Request(
            f"https://slack.com/api/{method}?{parameter}={slack_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
        with urlopen(request, timeout=SLACK_IDENTITY_TIMEOUT_SECONDS) as response:
            result = json.loads(response.read())
        if result.get("ok"):
            identity = result.get("user" if kind == "sender" else "channel") or {}
            profile = (identity.get("profile") or {}) if kind == "sender" else {}
            candidates = (
                [profile.get("display_name"), profile.get("real_name"), identity.get("real_name"), identity.get("name")]
                if kind == "sender" else [identity.get("name")]
            )
            display_name = next((value.strip() for value in candidates if isinstance(value, str) and value.strip()), None)
        elif result.get("error") in {"missing_scope", "not_authed", "invalid_auth", "token_revoked", "account_inactive"}:
            retry_seconds = 60 * 60
            method_backoff = True
            authorization_error = True
        elif result.get("error") == "ratelimited":
            method_backoff = True
    except HTTPError as error:
        if error.code == 429:
            try:
                retry_seconds = max(SLACK_IDENTITY_RETRY_SECONDS, float(error.headers.get("Retry-After", "0")))
            except (TypeError, ValueError):
                pass
            method_backoff = True
    except Exception:  # Identity availability must never break message/review APIs.
        pass
    expires_at = time.time() + (SLACK_IDENTITY_TTL_SECONDS if display_name else retry_seconds)
    if method_backoff:
        with _SLACK_IDENTITY_LOCK:
            _SLACK_IDENTITY_BACKOFF[(namespace, kind)] = expires_at
    if authorization_error:
        # Reinstalling an app can change its scopes without changing its token.
        # A backend restart must recover immediately after that permission fix.
        expires_at = 0
    database = sqlite3.connect(database_path, timeout=3)
    try:
        with database:
            database.execute(
                "INSERT INTO slack_identity_cache (namespace, kind, slack_id, display_name, expires_at) "
                "VALUES (?, ?, ?, ?, ?) ON CONFLICT(namespace, kind, slack_id) DO UPDATE SET "
                "display_name = COALESCE(excluded.display_name, slack_identity_cache.display_name), "
                "expires_at = excluded.expires_at",
                (namespace, kind, slack_id, display_name, expires_at),
            )
    finally:
        database.close()


def _queue_slack_identity(database_path: Path, namespace: str, token: str, kind: str, slack_id: str) -> None:
    global _SLACK_IDENTITY_EXECUTOR
    key = (str(database_path), namespace, kind, slack_id)
    with _SLACK_IDENTITY_LOCK:
        if key in _SLACK_IDENTITY_PENDING or len(_SLACK_IDENTITY_PENDING) >= 128:
            return
        if _SLACK_IDENTITY_BACKOFF.get((namespace, kind), 0) > time.time():
            return
        if _SLACK_IDENTITY_EXECUTOR is None:
            _SLACK_IDENTITY_EXECUTOR = ThreadPoolExecutor(max_workers=2, thread_name_prefix="slack-names")
        _SLACK_IDENTITY_PENDING.add(key)

        def resolve() -> None:
            try:
                _fetch_slack_identity(database_path, namespace, token, kind, slack_id)
            except Exception:
                # A temporary local cache error is also safe to retry on a later read.
                pass
            finally:
                with _SLACK_IDENTITY_LOCK:
                    _SLACK_IDENTITY_PENDING.discard(key)

        _SLACK_IDENTITY_EXECUTOR.submit(resolve)


def with_slack_identity_names(payload: Any) -> Any:
    """Add display fields without changing routing IDs or waiting for Slack.

    Walk response dictionaries only, including related messages and memory
    metadata. Stored content and its original authors/channel IDs stay intact.
    Stale successful names remain visible while a background refresh runs.
    """
    identities: set[tuple[str, str]] = set()

    def copy_value(value: Any, demo: bool = False) -> Any:
        if isinstance(value, list):
            return [copy_value(item, demo) for item in value]
        if not isinstance(value, dict):
            return value
        demo = demo or str(value.get("external_id", "")).startswith("demo-")
        result = {key: copy_value(item, demo) for key, item in value.items()}
        for kind, pattern in (("sender", r"[UW][A-Z0-9]{8,}"), ("channel", r"[CGD][A-Z0-9]{8,}")):
            raw = value.get(kind)
            if isinstance(raw, str):
                result[kind + "_name"] = value.get(kind + "_name") or raw
                if not demo and re.fullmatch(pattern, raw):
                    identities.add((kind, raw))
        return result

    result = copy_value(payload)
    token = SLACK_BOT_TOKEN
    if not token or not identities:
        return result
    namespace = hashlib.sha256(token.encode()).hexdigest()[:24]
    try:
        cache = _slack_identity_rows(DATABASE_PATH, namespace)
    except sqlite3.Error:
        return result
    now = time.time()
    for kind, slack_id in sorted(identities):
        existing = cache.get((kind, slack_id))
        if not existing or existing[1] <= now:
            _queue_slack_identity(DATABASE_PATH, namespace, token, kind, slack_id)

    def apply_names(value: Any) -> None:
        if isinstance(value, list):
            for item in value:
                apply_names(item)
        elif isinstance(value, dict):
            for kind in ("sender", "channel"):
                raw = value.get(kind)
                cached = cache.get((kind, raw)) if isinstance(raw, str) else None
                if cached and cached[0]:
                    value[kind + "_name"] = cached[0]
            for item in value.values():
                apply_names(item)

    apply_names(result)
    return result


def record_workflow_start(run_id: str, message_id: str, channel: str | None) -> None:
    with connection() as database:
        database.execute(
            """
            INSERT INTO workflow_runs (run_id, message_id, channel, status, started_at)
            VALUES (?, ?, ?, 'running', ?)
            ON CONFLICT(run_id) DO UPDATE SET
                message_id = excluded.message_id,
                channel = excluded.channel,
                status = 'running',
                started_at = excluded.started_at,
                completed_at = NULL,
                duration_ms = NULL,
                classification = NULL,
                context_agent = NULL,
                action_agent = NULL,
                decision_agent = NULL,
                error = NULL
            """,
            (run_id, message_id, channel, utc_now()),
        )
        database.commit()


def record_workflow_finish(
    run_id: str,
    status: str,
    duration_ms: int,
    result: dict[str, Any] | None = None,
    error: str | None = None,
) -> None:
    result = result or {}
    priority = result.get("priority_result", {}) if isinstance(result, dict) else {}
    context = result.get("context", {}) if isinstance(result, dict) else {}
    actions = result.get("action_extraction", {}) if isinstance(result, dict) else {}
    decisions = result.get("decision_memory", {}) if isinstance(result, dict) else {}
    with connection() as database:
        database.execute(
            """
            UPDATE workflow_runs
            SET status = ?, completed_at = ?, duration_ms = ?, classification = ?,
                context_agent = ?, action_agent = ?, decision_agent = ?, error = ?
            WHERE run_id = ?
            """,
            (
                status,
                utc_now(),
                duration_ms,
                priority.get("classification"),
                context.get("agent"),
                actions.get("agent"),
                decisions.get("agent"),
                error,
                run_id,
            ),
        )
        database.commit()


def observability_summary() -> dict[str, Any]:
    with connection() as database:
        totals = database.execute(
            """
            SELECT COUNT(*),
                   SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END),
                   SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END),
                   AVG(CASE WHEN status = 'completed' THEN duration_ms END)
            FROM workflow_runs
            """
        ).fetchone()
        rows = database.execute(
            """
            SELECT run_id, message_id, channel, status, started_at, completed_at,
                   duration_ms, classification, context_agent, action_agent,
                   decision_agent, error
            FROM workflow_runs
            ORDER BY started_at DESC
            LIMIT 12
            """
        ).fetchall()
        classification_rows = database.execute(
            """
            SELECT classification, COUNT(*)
            FROM workflow_runs
            WHERE classification IS NOT NULL
            GROUP BY classification
            ORDER BY COUNT(*) DESC, classification
            """
        ).fetchall()
    return with_slack_identity_names({
        "workflow": langgraph_status(),
        "langsmith": langsmith_status(),
        "metrics": {
            "total_runs": int(totals[0] or 0),
            "completed_runs": int(totals[1] or 0),
            "failed_runs": int(totals[2] or 0),
            "running_runs": int((totals[0] or 0) - (totals[1] or 0) - (totals[2] or 0)),
            "average_duration_ms": round(float(totals[3] or 0), 1),
            "classifications": {str(row[0]): int(row[1]) for row in classification_rows},
        },
        "recent_runs": [
            {
                "run_id": row[0],
                "message_id": row[1],
                "channel": row[2],
                "status": row[3],
                "started_at": row[4],
                "completed_at": row[5],
                "duration_ms": row[6],
                "classification": row[7],
                "context_agent": row[8],
                "action_agent": row[9],
                "decision_agent": row[10],
                "error": row[11],
            }
            for row in rows
        ],
    })


_LANGGRAPH_GRAPH: Any | None = None
_LANGGRAPH_CHECKPOINTER: Any | None = None
_LANGGRAPH_CHECKPOINT_CONNECTION: sqlite3.Connection | None = None
_LANGGRAPH_EXIT_STACK = ExitStack()
_LANGGRAPH_LOCK = RLock()


def langgraph_status() -> dict[str, Any]:
    """Return safe workflow configuration without exposing connection details."""
    return {
        "engine": "langgraph",
        "checkpointer": LANGGRAPH_CHECKPOINTER,
        "checkpoint_path": str(LANGGRAPH_CHECKPOINT_PATH) if LANGGRAPH_CHECKPOINTER == "sqlite" else None,
        "postgres_configured": bool(LANGGRAPH_POSTGRES_URI) if LANGGRAPH_CHECKPOINTER == "postgres" else None,
    }


def get_langgraph_checkpointer() -> Any:
    """Create one process-wide durable checkpointer for the compiled graph."""
    global _LANGGRAPH_CHECKPOINTER, _LANGGRAPH_CHECKPOINT_CONNECTION
    with _LANGGRAPH_LOCK:
        if _LANGGRAPH_CHECKPOINTER is not None:
            return _LANGGRAPH_CHECKPOINTER
        if LANGGRAPH_CHECKPOINTER == "postgres":
            if not LANGGRAPH_POSTGRES_URI:
                raise RuntimeError(
                    "LANGGRAPH_POSTGRES_URI is required when LANGGRAPH_CHECKPOINTER=postgres"
                )
            try:
                from langgraph.checkpoint.postgres import PostgresSaver
            except ImportError as error:
                raise RuntimeError(
                    "Install langgraph-checkpoint-postgres and psycopg for the PostgreSQL checkpointer"
                ) from error
            _LANGGRAPH_CHECKPOINTER = _LANGGRAPH_EXIT_STACK.enter_context(
                PostgresSaver.from_conn_string(LANGGRAPH_POSTGRES_URI)
            )
            _LANGGRAPH_CHECKPOINTER.setup()
            return _LANGGRAPH_CHECKPOINTER
        if LANGGRAPH_CHECKPOINTER != "sqlite":
            raise RuntimeError("LANGGRAPH_CHECKPOINTER must be sqlite or postgres")
        try:
            from langgraph.checkpoint.sqlite import SqliteSaver
        except ImportError as error:
            raise RuntimeError(
                "Install langgraph-checkpoint-sqlite for the SQLite checkpointer"
            ) from error
        LANGGRAPH_CHECKPOINT_PATH.parent.mkdir(parents=True, exist_ok=True)
        _LANGGRAPH_CHECKPOINT_CONNECTION = sqlite3.connect(
            LANGGRAPH_CHECKPOINT_PATH,
            timeout=30,
            check_same_thread=False,
        )
        _LANGGRAPH_CHECKPOINTER = SqliteSaver(_LANGGRAPH_CHECKPOINT_CONNECTION)
        _LANGGRAPH_CHECKPOINTER.setup()
        return _LANGGRAPH_CHECKPOINTER


@traceable(
    name="Classify Slack message",
    process_inputs=trace_state_inputs,
    process_outputs=trace_node_outputs,
)
def workflow_classify_node(state: MessageWorkflowState) -> dict[str, Any]:
    result = prioritize_message(state["text"], bool(state.get("mention")))
    return {
        "priority_result": {
            "priority": result.priority,
            "classification": result.classification,
            "score": result.score,
            "summary": result.summary,
            "reason": result.reason,
            "suggested_action": result.suggested_action,
        }
    }


@traceable(
    name="Find related Slack messages",
    run_type="retriever",
    process_inputs=trace_state_inputs,
    process_outputs=trace_node_outputs,
)
def workflow_related_messages_node(state: MessageWorkflowState) -> dict[str, Any]:
    return {
        "related_messages": find_related_messages(
            state["text"],
            state.get("channel"),
            state.get("thread_ts"),
            state.get("message_id"),
        )
    }


@traceable(
    name="Context enrichment",
    process_inputs=trace_state_inputs,
    process_outputs=trace_node_outputs,
)
def workflow_context_node(state: MessageWorkflowState) -> dict[str, Any]:
    return {
        "context": synthesize_context(
            state["text"],
            state["priority_result"]["classification"],
            state.get("related_messages", []),
        )
    }


@traceable(
    name="Action extraction",
    process_inputs=trace_state_inputs,
    process_outputs=trace_node_outputs,
)
def workflow_action_node(state: MessageWorkflowState) -> dict[str, Any]:
    return {
        "action_extraction": extract_actions(
            state["text"],
            state.get("channel"),
            state.get("thread_ts"),
            state.get("related_messages", []),
            state.get("context", {}),
            state.get("message_id"),
        )
    }


@traceable(
    name="Decision memory extraction",
    process_inputs=trace_state_inputs,
    process_outputs=trace_node_outputs,
)
def workflow_decision_node(state: MessageWorkflowState) -> dict[str, Any]:
    return {
        "decision_memory": extract_decision_memory(
            state["text"],
            state.get("channel"),
            state.get("thread_ts"),
            state.get("related_messages", []),
            state.get("context", {}),
            state.get("message_id"),
            state.get("created_at"),
        )
    }


def persist_workflow_message(state: MessageWorkflowState) -> dict[str, Any]:
    """Persist graph output while preserving decisions on safe retries."""
    priority = state["priority_result"]
    context = state.get("context", {})
    action_extraction = state.get("action_extraction", {"agent": "mock", "status": "complete", "items": []})
    decision_memory = state.get("decision_memory", {"agent": "mock", "status": "complete", "items": []})
    message_id = state["message_id"]
    database_values = (
        state.get("external_id"),
        state.get("channel") or "demo",
        state.get("thread_ts"),
        state.get("sender") or "Slack user",
        state["text"],
        priority["priority"],
        priority["classification"],
        json.dumps(context),
        json.dumps(action_extraction),
        priority["score"],
        priority["summary"],
        priority["reason"],
        priority["suggested_action"],
        state["created_at"],
    )

    with connection() as database:
        existing = database.execute(
            "SELECT decision_memory_json FROM messages WHERE id = ?",
            (message_id,),
        ).fetchone()
        if existing is None:
            database.execute(
                """
                INSERT INTO messages (
                    id, external_id, channel, thread_ts, sender, text, priority,
                    classification, context_json, actions_json, decision_memory_json,
                    score, summary, reason, suggested_action, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?, ?, ?, ?)
                """,
                (message_id, *database_values),
            )
        else:
            try:
                previous_decision_memory = json.loads(existing[0] or "{}")
            except json.JSONDecodeError:
                previous_decision_memory = {}
            previous_store = previous_decision_memory.get("memory_store", {})
            if isinstance(previous_store, dict) and previous_store.get("stored"):
                decision_memory["memory_store"] = previous_store
            database.execute(
                """
                UPDATE messages
                SET external_id = COALESCE(?, external_id), channel = ?, thread_ts = ?,
                    sender = ?, text = ?, priority = ?, classification = ?,
                    context_json = ?, actions_json = ?, score = ?, summary = ?,
                    reason = ?, suggested_action = ?, created_at = ?
                WHERE id = ?
                """,
                (*database_values, message_id),
            )
        database.commit()

    decision_memory = ensure_mem0_decision_memory(
        decision_memory,
        state.get("channel"),
        state.get("thread_ts"),
        message_id,
        state.get("created_at"),
    )
    with connection() as database:
        database.execute(
            "UPDATE messages SET decision_memory_json = ? WHERE id = ?",
            (json.dumps(decision_memory), message_id),
        )
        database.commit()
    return {"message": get_message(message_id), "decision_memory": decision_memory}


@traceable(
    name="Persist workflow output",
    run_type="tool",
    process_inputs=trace_state_inputs,
    process_outputs=trace_node_outputs,
)
def workflow_persist_node(state: MessageWorkflowState) -> dict[str, Any]:
    return persist_workflow_message(state)


def get_message_workflow() -> Any:
    """Compile the processing graph once and reuse it for webhook and sync work."""
    global _LANGGRAPH_GRAPH
    with _LANGGRAPH_LOCK:
        if _LANGGRAPH_GRAPH is not None:
            return _LANGGRAPH_GRAPH
        builder = StateGraph(MessageWorkflowState)
        builder.add_node("classify", workflow_classify_node)
        builder.add_node("related_messages", workflow_related_messages_node)
        builder.add_node("context_enrichment", workflow_context_node)
        builder.add_node("action_extraction", workflow_action_node)
        builder.add_node("decision_memory", workflow_decision_node)
        builder.add_node("persist", workflow_persist_node)
        builder.add_edge(START, "classify")
        builder.add_edge("classify", "related_messages")
        builder.add_edge("related_messages", "context_enrichment")
        builder.add_edge("context_enrichment", "action_extraction")
        builder.add_edge("context_enrichment", "decision_memory")
        builder.add_edge("action_extraction", "persist")
        builder.add_edge("decision_memory", "persist")
        builder.add_edge("persist", END)
        _LANGGRAPH_GRAPH = builder.compile(checkpointer=get_langgraph_checkpointer())
        return _LANGGRAPH_GRAPH


def run_message_workflow(
    text: str,
    sender: str = "Mock Slack user",
    channel: str = "demo",
    external_id: str | None = None,
    mention: bool = False,
    thread_ts: str | None = None,
    message_id: str | None = None,
    created_at: str | None = None,
    run_id: str | None = None,
) -> dict[str, Any]:
    message_id = message_id or str(uuid.uuid4())
    created_at = created_at or utc_now()
    workflow_state: MessageWorkflowState = {
        "message_id": message_id,
        "run_id": run_id or message_id,
        "external_id": external_id,
        "sender": sender,
        "text": text,
        "channel": channel,
        "thread_ts": thread_ts,
        "mention": mention,
        "created_at": created_at,
    }
    workflow_run_id = workflow_state["run_id"]
    started = time.perf_counter()
    record_workflow_start(workflow_run_id, message_id, channel)
    try:
        result = get_message_workflow().invoke(
            workflow_state,
            {
                "configurable": {"thread_id": workflow_run_id},
                "run_name": "Slack message workflow",
                "tags": ["zaroori-baat", "slack", "message-workflow"],
                "metadata": {
                    "workflow_version": "1",
                    "message_id": message_id,
                    "channel": channel,
                },
            },
        )
    except Exception as error:  # noqa: BLE001
        record_workflow_finish(
            workflow_run_id,
            "failed",
            int((time.perf_counter() - started) * 1000),
            error=type(error).__name__,
        )
        raise
    record_workflow_finish(
        workflow_run_id,
        "completed",
        int((time.perf_counter() - started) * 1000),
        result,
    )
    return result["message"]


def create_message(
    text: str,
    sender: str = "Mock Slack user",
    channel: str = "demo",
    external_id: str | None = None,
    mention: bool = False,
    thread_ts: str | None = None,
) -> dict[str, Any]:
    if external_id:
        with connection() as database:
            existing = database.execute("SELECT id FROM messages WHERE external_id = ?", (external_id,)).fetchone()
        if existing:
            return get_message(existing[0])

    message_id = str(uuid.uuid4())
    created_at = utc_now()
    return run_message_workflow(
        text,
        sender,
        channel,
        external_id,
        mention,
        thread_ts,
        message_id,
        created_at,
    )


def message_from_row(row: sqlite3.Row) -> dict[str, Any]:
    message = dict(row)
    raw_context = message.pop("context_json", "{}")
    raw_actions = message.pop("actions_json", "{}")
    raw_decision_memory = message.pop("decision_memory_json", "{}")
    try:
        message["context"] = json.loads(raw_context or "{}")
    except json.JSONDecodeError:
        message["context"] = {}
    try:
        message["action_extraction"] = json.loads(raw_actions or "{}")
    except json.JSONDecodeError:
        message["action_extraction"] = {"agent": "mock", "status": "complete", "items": []}
    try:
        message["decision_memory"] = json.loads(raw_decision_memory or "{}")
    except json.JSONDecodeError:
        message["decision_memory"] = {"agent": "mock", "status": "complete", "items": []}
    return message


def get_message(message_id: str) -> dict[str, Any]:
    with connection() as database:
        row = database.execute("SELECT * FROM messages WHERE id = ?", (message_id,)).fetchone()
    if row is None:
        raise KeyError(message_id)
    return with_slack_identity_names(message_from_row(row))


def list_messages() -> list[dict[str, Any]]:
    with connection() as database:
        rows = database.execute("""
            SELECT * FROM messages
            ORDER BY CASE WHEN decision IS NULL THEN 0 ELSE 1 END,
                     CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
                     score DESC, created_at DESC
        """).fetchall()
    return with_slack_identity_names([message_from_row(row) for row in rows])


def refresh_message_context(message_id: str) -> dict[str, Any]:
    with connection() as database:
        row = database.execute(
            "SELECT text, channel, thread_ts, created_at, external_id, sender FROM messages WHERE id = ?",
            (message_id,),
        ).fetchone()
        if row is None:
            raise KeyError(message_id)
    return run_message_workflow(
        row[0],
        row[5],
        row[1],
        row[4],
        "<@" in row[0],
        row[2],
        message_id,
        row[3],
        f"refresh:{message_id}:{uuid.uuid4()}",
    )


def record_decision(message_id: str, decision: str) -> dict[str, Any]:
    if decision not in {"approved", "dismissed", "deferred", "escalated", "pending"}:
        raise ValueError("Invalid decision")
    stored_decision = None if decision == "pending" else decision
    decided_at = None if decision == "pending" else utc_now()
    with connection() as database:
        cursor = database.execute("UPDATE messages SET decision = ?, decided_at = ? WHERE id = ?", (stored_decision, decided_at, message_id))
        if cursor.rowcount == 0:
            raise KeyError(message_id)
        database.commit()
    return get_message(message_id)


def verify_slack_signature(body: bytes, timestamp: str | None, signature: str | None) -> bool:
    if not SLACK_SIGNING_SECRET:
        return True
    if not timestamp or not signature:
        return False
    base = f"v0:{timestamp}:".encode() + body
    expected = "v0=" + hmac.new(SLACK_SIGNING_SECRET.encode(), base, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


def ingest_slack_event(payload: dict[str, Any]) -> list[dict[str, Any]]:
    event = payload.get("event", {})
    if payload.get("type") != "event_callback" or event.get("type") not in {"message", "app_mention"} or event.get("subtype"):
        return []
    text = str(event.get("text", "")).strip()
    if not text:
        return []
    mention = "<@" in text or "<!channel>" in text or "<!here>" in text
    sender = str(event.get("user", "Slack user"))
    channel = str(event.get("channel", "Slack channel"))
    event_id = str(payload.get("event_id") or event.get("client_msg_id") or uuid.uuid4())
    return [create_message(text, sender, channel, event_id, mention, event.get("thread_ts"))]


def sync_slack_history() -> int:
    if not SLACK_BOT_TOKEN or not SLACK_CHANNEL_IDS:
        raise RuntimeError("SLACK_BOT_TOKEN and SLACK_CHANNEL_IDS are required for Sync Slack")
    count = 0
    for channel_id in SLACK_CHANNEL_IDS:
        request = Request(
            "https://slack.com/api/conversations.history?limit=50&channel=" + channel_id,
            headers={"Authorization": f"Bearer {SLACK_BOT_TOKEN}"},
        )
        with urlopen(request, timeout=15) as response:
            result = json.loads(response.read())
        if not result.get("ok"):
            raise RuntimeError(f"{channel_id}: {result.get('error', 'Slack history request failed')}")
        for message in result.get("messages", []):
            if message.get("subtype") or not message.get("text"):
                continue
            create_message(
                message["text"], message.get("user", "Slack user"), channel_id,
                message.get("client_msg_id") or f"history-{channel_id}-{message.get('ts')}",
                "<@" in message["text"],
                message.get("thread_ts"),
            )
            count += 1
    with connection() as database:
        database.execute(
            "INSERT INTO app_settings (key, value) VALUES ('slack_last_sync_at', ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (utc_now(),),
        )
        database.commit()
    return count


def system_status() -> dict[str, Any]:
    """UI integration status containing no credentials, IDs, or local paths."""
    with connection() as database:
        last_sync = database.execute(
            "SELECT value FROM app_settings WHERE key = 'slack_last_sync_at'"
        ).fetchone()
        has_demo = database.execute(
            "SELECT 1 FROM messages WHERE external_id LIKE 'demo-%' LIMIT 1"
        ).fetchone()
    memory = mem0_status()
    workflow = langgraph_status()
    return {
        "slack": {
            "configured": bool(SLACK_BOT_TOKEN and SLACK_CHANNEL_IDS),
            "channel_count": len(SLACK_CHANNEL_IDS),
            "last_sync_at": last_sync[0] if last_sync else None,
        },
        "context": {
            "enabled": bool(LLM_CONTEXT_ENABLED and LLM_API_KEY and LLM_MODEL),
            "external_sources": "mock",
        },
        "memory": {key: memory[key] for key in ("provider", "enabled", "configured", "active")},
        "workflow": {key: workflow[key] for key in ("engine", "checkpointer", "postgres_configured")},
        "demo": bool(has_demo),
    }


def seed_demo() -> None:
    with connection() as database:
        if database.execute("SELECT COUNT(*) FROM messages").fetchone()[0]:
            return
    create_message("Production is blocked. Please review the deployment failure and assign an owner today.", "Asha", "#platform", "demo-default-platform")
    create_message("Please review the procurement requirements before EOD.", "Amrish", "#product", "demo-default-product")
    create_message("FYI: team lunch is next Friday.", "Ravi", "#general", "demo-default-general")


class Handler(BaseHTTPRequestHandler):
    def send_json(self, payload: Any, status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_body(self) -> bytes:
        return self.rfile.read(int(self.headers.get("Content-Length", "0")))

    def do_GET(self) -> None:  # noqa: N802
        parsed_url = urlparse(self.path)
        path = parsed_url.path
        if path == "/health":
            self.send_json(
                {
                    "status": "ok",
                    "service": "zaroori-baat-slack",
                    "workflow": langgraph_status(),
                    "observability": langsmith_status(),
                }
            )
        elif path == "/api/workflow/status":
            self.send_json(langgraph_status())
        elif path == "/api/system/status":
            self.send_json(system_status())
        elif path == "/api/observability/status":
            self.send_json(langsmith_status())
        elif path == "/api/observability/summary":
            self.send_json(observability_summary())
        elif path == "/api/messages":
            self.send_json({"messages": list_messages()})
        elif re.fullmatch(r"/api/messages/[^/]+", path):
            try:
                self.send_json(get_message(unquote(path.rsplit("/", 1)[1])))
            except KeyError:
                self.send_json({"error": "Message not found"}, HTTPStatus.NOT_FOUND)
        elif path == "/api/decision-memory/status":
            self.send_json(mem0_status())
        elif path == "/api/decision-memory/search":
            query = parse_qs(parsed_url.query).get("q", [""])[0]
            if not query.strip():
                self.send_json({"error": "query is required"}, HTTPStatus.BAD_REQUEST)
            else:
                self.send_json(search_decision_memories(query))
        elif path == "/webhooks/slack":
            self.send_json({"error": "Use POST for Slack events"}, HTTPStatus.METHOD_NOT_ALLOWED)
        elif path in {"/", "/index.html"}:
            built_index = ROOT / "frontend" / "dist" / "index.html"
            self.serve_path(built_index if built_index.is_file() else ROOT / "index.html", "text/html; charset=utf-8")
        elif path in {"/legacy", "/legacy/", "/legacy/index.html"}:
            self.serve("index.html", "text/html; charset=utf-8")
        elif path.startswith("/assets/"):
            self.serve_asset(path)
        elif path == "/favicon.svg":
            self.serve_path(ROOT / "frontend" / "dist" / "favicon.svg", "image/svg+xml")
        elif path == "/styles.css":
            self.serve("styles.css", "text/css; charset=utf-8")
        elif path == "/app.js":
            self.serve("app.js", "text/javascript; charset=utf-8")
        else:
            self.send_json({"error": "Not found"}, HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        try:
            body = self.read_body()
            payload = json.loads(body or b"{}")
            if not isinstance(payload, dict):
                raise ValueError("JSON request body must be an object")
            if path == "/webhooks/slack":
                if not verify_slack_signature(body, self.headers.get("X-Slack-Request-Timestamp"), self.headers.get("X-Slack-Signature")):
                    self.send_json({"error": "Invalid Slack signature"}, HTTPStatus.FORBIDDEN)
                    return
                if payload.get("type") == "url_verification":
                    self.send_json({"challenge": payload.get("challenge")})
                    return
                ingested = ingest_slack_event(payload)
                self.send_json({"ok": True, "ingested": len(ingested)})
            elif path == "/api/messages":
                text = str(payload.get("text", "")).strip()
                if not text:
                    raise ValueError("text is required")
                self.send_json(create_message(text), HTTPStatus.CREATED)
            elif path == "/api/decision-memory/sync":
                self.send_json(sync_saved_decision_memories())
            elif path == "/api/slack/sync":
                self.send_json({"ok": True, "ingested": sync_slack_history()})
            elif path.startswith("/api/messages/") and path.endswith("/context"):
                message_id = path.split("/")[3]
                self.send_json(refresh_message_context(message_id))
            elif path.startswith("/api/messages/") and path.endswith("/decision"):
                message_id = path.split("/")[3]
                self.send_json(record_decision(message_id, str(payload.get("decision", ""))))
            else:
                self.send_json({"error": "Not found"}, HTTPStatus.NOT_FOUND)
        except (ValueError, json.JSONDecodeError) as error:
            self.send_json({"error": str(error)}, HTTPStatus.BAD_REQUEST)
        except KeyError:
            self.send_json({"error": "Message not found"}, HTTPStatus.NOT_FOUND)
        except RuntimeError as error:
            self.send_json({"error": str(error)}, HTTPStatus.SERVICE_UNAVAILABLE)
        except Exception as error:  # noqa: BLE001
            print(f"Request failed: {error}")
            self.send_json({"error": "Internal server error"}, HTTPStatus.INTERNAL_SERVER_ERROR)

    def serve(self, filename: str, content_type: str) -> None:
        self.serve_path(ROOT / filename, content_type)

    def serve_asset(self, request_path: str) -> None:
        asset_root = (ROOT / "frontend" / "dist" / "assets").resolve()
        relative_path = unquote(request_path[len("/assets/"):])
        # Backslashes and colons have path/stream semantics on Windows.
        if not relative_path or "\\" in relative_path or ":" in relative_path or "\x00" in relative_path:
            self.send_json({"error": "Not found"}, HTTPStatus.NOT_FOUND)
            return
        try:
            asset_path = (asset_root / relative_path).resolve()
            asset_path.relative_to(asset_root)
        except (ValueError, OSError):
            self.send_json({"error": "Not found"}, HTTPStatus.NOT_FOUND)
            return
        content_type = {
            ".js": "text/javascript; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".svg": "image/svg+xml",
        }.get(asset_path.suffix.lower()) or mimetypes.guess_type(str(asset_path))[0] or "application/octet-stream"
        self.serve_path(asset_path, content_type)

    def serve_path(self, file_path: Path, content_type: str) -> None:
        try:
            if not file_path.is_file():
                raise FileNotFoundError
            content = file_path.read_bytes()
        except (OSError, ValueError):
            self.send_json({"error": "Not found"}, HTTPStatus.NOT_FOUND)
            return
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(content)

    def log_message(self, format_string: str, *args: Any) -> None:
        print(f"{self.address_string()} - {format_string % args}")


def main() -> None:
    initialize_database()
    if SEED_DEMO:
        seed_demo()
    if SLACK_BOT_TOKEN:
        # Warm existing imports without reprocessing or changing their decisions.
        list_messages()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    server.daemon_threads = True
    print(f"Zaroori Baat Slack running at http://{HOST}:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
