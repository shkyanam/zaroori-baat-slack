"""Run SMI-GD-008 and verify its LangSmith trace tree.

The default trace configuration keeps Slack text hidden. In that mode this
script verifies the root metadata, child-agent names, statuses, and safe
structured evidence. Set LANGSMITH_CAPTURE_CONTENT=true when full briefing,
question, and task text must be inspected in LangSmith for an approved test.
"""

from __future__ import annotations

import argparse
from datetime import datetime
import json
import os
from pathlib import Path
import time
from typing import Any, Iterable

import pandas as pd
from langsmith import Client


ROOT = Path(__file__).resolve().parent
DATASET_NAME = "Slack_Message_Intelligence_Agent_Golden_Dataset_v1"
DEFAULT_TEST_ID = "SMI-GD-008"
DEFAULT_TIMEOUT_SECONDS = 60
DEFAULT_POLL_SECONDS = 2


def load_local_env() -> None:
    env_path = ROOT / ".env"
    if not env_path.is_file():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def parse_json(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return value


def load_case(test_id: str) -> dict[str, Any]:
    frame = pd.read_csv(
        ROOT / "Slack_Message_Intelligence_Agent_Golden_Dataset_v1.0.csv",
        encoding="utf-8-sig",
        keep_default_na=False,
    )
    matches = frame[frame["Test_Id"] == test_id]
    if matches.empty:
        raise ValueError(f"Dataset case not found: {test_id}")
    row = matches.iloc[0]
    event = parse_json(row["User_Input"])
    if not isinstance(event, dict):
        raise ValueError(f"User_Input for {test_id} is not a JSON object")
    return event


def run_metadata(run: Any) -> dict[str, Any]:
    direct = getattr(run, "metadata", None)
    if isinstance(direct, dict):
        return direct
    extra = getattr(run, "extra", None)
    if isinstance(extra, dict) and isinstance(extra.get("metadata"), dict):
        return extra["metadata"]
    return {}


def run_payload(run: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {}
    for field in ("inputs", "outputs", "extra"):
        value = getattr(run, field, None)
        if value is not None:
            payload[field] = value
    return payload


def child_runs(run: Any) -> list[Any]:
    found: list[Any] = []
    seen: set[str] = set()

    def visit(current: Any) -> None:
        current_id = str(getattr(current, "id", ""))
        if current_id and current_id in seen:
            return
        if current_id:
            seen.add(current_id)
        for child in getattr(current, "child_runs", None) or []:
            found.append(child)
            visit(child)

    visit(run)
    return found


def run_started_at(run: Any) -> float:
    value = getattr(run, "start_time", None)
    if isinstance(value, datetime):
        return value.timestamp()
    return 0.0


def find_root(client: Client, project: str, test_id: str, timeout: int) -> Any:
    expected_name = f"smi-eval-{test_id}"
    deadline = time.monotonic() + timeout
    while time.monotonic() <= deadline:
        candidates = list(client.list_runs(project_name=project, is_root=True, limit=100))
        matching = [
            run
            for run in candidates
            if getattr(run, "name", "") == expected_name
            or run_metadata(run).get("test_id") == test_id
        ]
        if matching:
            matching.sort(key=run_started_at, reverse=True)
            return client.read_run(matching[0].id, load_child_runs=True)
        time.sleep(DEFAULT_POLL_SECONDS)
    raise TimeoutError(f"No LangSmith root trace found for {test_id} in project {project!r}")


def find_child(runs: Iterable[Any], names: tuple[str, ...]) -> Any | None:
    for run in runs:
        name = str(getattr(run, "name", ""))
        if any(alias.lower() in name.lower() for alias in names):
            return run
    return None


def text_for_run(run: Any) -> str:
    return json.dumps(run_payload(run), ensure_ascii=False, default=str)


def has_any(run: Any | None, terms: tuple[str, ...]) -> bool:
    return bool(run and any(term.lower() in text_for_run(run).lower() for term in terms))


def has_item_evidence(run: Any | None, fields: tuple[str, ...]) -> bool:
    """Accept an empty collection while requiring fields when items exist."""
    if not run:
        return False
    text = text_for_run(run).lower()
    if '"items_count": 0' in text:
        return True
    return any(field.lower() in text for field in fields)


def verify_trace(root_run: Any, test_id: str) -> dict[str, bool]:
    metadata = run_metadata(root_run)
    children = child_runs(root_run)
    signal_run = find_child(children, ("Signal Detection Agent", "Classify Slack message"))
    context_run = find_child(children, ("Context Enrichment Agent", "Context enrichment"))
    action_run = find_child(children, ("Action Extraction Agent", "Action extraction"))
    decision_run = find_child(children, ("Decision Memory Agent", "Decision memory"))
    router_run = find_child(children, ("Router",))

    start = getattr(root_run, "start_time", None)
    end = getattr(root_run, "end_time", None)
    latency_present = isinstance(start, datetime) and isinstance(end, datetime) and end >= start
    root_status = str(getattr(root_run, "status", "")).lower() in {"success", "completed"}
    checks = {
        "root_test_id": metadata.get("test_id") == test_id,
        "root_versions_model": all(
            metadata.get(field)
            for field in (
                "dataset_version",
                "model_provider",
                "model_name",
                "prompt_version",
                "workflow_version",
            )
        ),
        "root_workflow_status": root_status,
        "root_latency": latency_present,
        "root_error_data": hasattr(root_run, "error"),
        "signal_detection_child": signal_run is not None,
        "signal_evidence": has_any(signal_run, ("classification", "primary_type"))
        and has_any(signal_run, ("priority",))
        and has_any(signal_run, ("owner", "deadline", "confidence")),
        "context_enrichment_child": context_run is not None,
        "context_evidence": has_any(context_run, ("related_message_ids", "related_messages"))
        and has_any(context_run, ("source_names", "sources", "briefing_present", "briefing"))
        and has_any(context_run, ("open_questions", "open_questions_count")),
        "action_extraction_child": action_run is not None,
        "action_evidence": has_item_evidence(action_run, ("owner", "deadline", "due", "source_message_id", "item_fields")),
        "decision_memory_child": decision_run is not None,
        "decision_evidence": has_item_evidence(decision_run, ("decision", "alternatives", "participants", "supersession")),
        "router_child": router_run is not None,
        "router_evidence": has_any(router_run, ("autonomous_action",))
        and has_any(router_run, ("human_review",))
        and has_any(router_run, ("workflow_status", "terminal_state")),
    }
    return checks


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--test-id", default=DEFAULT_TEST_ID)
    parser.add_argument("--timeout", type=int, default=int(os.environ.get("SMI_TRACE_VERIFY_TIMEOUT_SECONDS", DEFAULT_TIMEOUT_SECONDS)))
    args = parser.parse_args()

    load_local_env()
    from orchestrator import orchestrator
    import app

    if not app.LANGSMITH_TRACING or not app.LANGSMITH_API_KEY:
        raise RuntimeError("Enable LANGSMITH_TRACING and configure LANGSMITH_API_KEY before running this check.")

    event = load_case(args.test_id)
    result = orchestrator.run(slack_event=event, test_id=args.test_id)
    print(f"Local orchestrator result: {result.workflow_status} ({args.test_id})")

    client = Client()
    root = find_root(client, app.LANGSMITH_PROJECT, args.test_id, args.timeout)
    checks = verify_trace(root, args.test_id)
    for name, passed in checks.items():
        print(f"{name}: {'PASS' if passed else 'FAIL'}")
    print(f"Root trace: {root.id} | {root.name} | children={len(child_runs(root))}")
    if not all(checks.values()):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
