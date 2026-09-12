"""Run the Slack Message Intelligence evaluators against the LangSmith dataset."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import time

from langsmith import evaluate


ROOT = Path(__file__).resolve().parent
DATASET_NAME = "Slack_Message_Intelligence_Agent_Golden_Dataset_v1"


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


def evaluation_target(inputs: dict) -> dict:
    """Return the stable, timed output contract expected by LangSmith."""
    from orchestrator import orchestrator

    test_id = inputs["Test_Id"]
    started_at = time.perf_counter()

    result = orchestrator.run(
        slack_event=inputs["User_Input"],
        test_id=test_id,
    )

    output = result.model_dump(mode="json")
    output["test_id"] = test_id
    output["evaluation_latency_seconds"] = round(
        time.perf_counter() - started_at, 3
    )
    return output


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--code-only",
        action="store_true",
        help="Run only EVAL-001..006 and EVAL-008; omit the optional LLM judge.",
    )
    parser.add_argument("--max-concurrency", type=int, default=1)
    args = parser.parse_args()

    load_local_env()
    from evaluators import ALL_EVALUATORS, CODE_EVALUATORS

    if not os.environ.get("LANGSMITH_API_KEY"):
        raise RuntimeError("Configure LANGSMITH_API_KEY before running the evaluation.")

    evaluators = CODE_EVALUATORS if args.code_only else ALL_EVALUATORS
    print(
        f"Running {len(evaluators)} evaluators against {DATASET_NAME} "
        f"(max_concurrency={args.max_concurrency})"
    )
    results = evaluate(
        evaluation_target,
        data=DATASET_NAME,
        evaluators=evaluators,
        metadata={
            "dataset_version": os.environ.get("SMI_DATASET_VERSION", "v1"),
            "model_provider": os.environ.get("SMI_MODEL_PROVIDER", "Nebius"),
            "prompt_version": os.environ.get("SMI_PROMPT_VERSION", "signal-context-v1"),
            "workflow_version": os.environ.get("SMI_WORKFLOW_VERSION", "workflow-v1"),
            "evaluator_version": os.environ.get("SMI_EVALUATOR_VERSION", "eval-v1"),
        },
        experiment_prefix="smi-eval",
        max_concurrency=max(1, args.max_concurrency),
        error_handling="log",
        blocking=True,
        upload_results=True,
    )
    print(f"Evaluation complete: {results}")


if __name__ == "__main__":
    main()
