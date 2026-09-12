"""Verify the uploaded Slack Message Intelligence LangSmith dataset."""

from __future__ import annotations

import os
from pathlib import Path

import pandas as pd
from langsmith import Client


ROOT = Path(__file__).resolve().parent
DATASET_NAME = "Slack_Message_Intelligence_Agent_Golden_Dataset_v1"
CSV_PATH = ROOT / "Slack_Message_Intelligence_Agent_Golden_Dataset_v1.0.csv"
METADATA_COLUMNS = {
    "Test_Id",
    "Test_Category",
    "Scenario",
    "Target_Intent",
    "Input_Format",
    "Execution_Mode",
    "Applicable_Metric_IDs",
    "Priority",
    "Notes",
    "Label_Quality_Check",
}


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


def main() -> None:
    load_local_env()
    frame = pd.read_csv(CSV_PATH, encoding="utf-8-sig", keep_default_na=False)
    expected_ids = {f"SMI-GD-{number:03d}" for number in range(1, 51)}
    expected_outputs = {column for column in frame.columns if column.startswith("Expected_")}
    client = Client()
    dataset = next(client.list_datasets(dataset_name=DATASET_NAME, limit=1), None)
    if dataset is None:
        raise RuntimeError(f"Dataset not found: {DATASET_NAME}")
    examples = list(client.list_examples(dataset_id=dataset.id, limit=100))
    ids = [str((example.metadata or {}).get("Test_Id")) for example in examples]
    structured_inputs = all(isinstance((example.inputs or {}).get("User_Input"), dict) for example in examples)
    input_ids = all(bool((example.inputs or {}).get("Test_Id")) for example in examples)
    metadata_ids = all(bool((example.metadata or {}).get("Test_Id")) for example in examples)
    outputs_complete = all(expected_outputs.issubset(set((example.outputs or {}).keys())) for example in examples)
    metadata_complete = all(METADATA_COLUMNS.issubset(set((example.metadata or {}).keys())) for example in examples)
    unicode_present = any(
        any(character in str((example.inputs or {}).get("User_Input")) for character in "‘’“”—–")
        for example in examples
    )
    checks = {
        "exactly_50_examples": len(examples) == 50,
        "50_unique_test_ids": len(set(ids)) == 50,
        "test_id_range": set(ids) == expected_ids,
        "structured_user_input": structured_inputs,
        "test_id_in_inputs": input_ids,
        "test_id_in_metadata": metadata_ids,
        "expected_outputs_present": outputs_complete,
        "metadata_fields_present": metadata_complete,
        "unicode_punctuation_present": unicode_present,
    }
    for name, passed in checks.items():
        print(f"{name}: {'PASS' if passed else 'FAIL'}")
    if not all(checks.values()):
        raise SystemExit(1)
    print(f"Verified dataset: {DATASET_NAME} ({dataset.id})")


if __name__ == "__main__":
    main()
