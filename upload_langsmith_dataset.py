import json
import os
from pathlib import Path

import pandas as pd
from langsmith import Client

ROOT = Path(__file__).resolve().parent
CSV_PATH = ROOT / "Slack_Message_Intelligence_Agent_Golden_Dataset_v1.0.csv"


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


load_local_env()

df = pd.read_csv(
    CSV_PATH,
    encoding="utf-8-sig",
    keep_default_na=False,
)

assert len(df) == 50
assert df["Test_Id"].nunique() == 50


def parse_cell(column: str, value: str):
    """Keep JSON-labelled CSV fields structured when possible."""
    if not value:
        return None
    if column == "User_Input" or column.endswith("_JSON"):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return value
    return value


examples = []
metadata_columns = {
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
for _, row in df.iterrows():
    outputs = {
        column: parse_cell(column, row[column])
        for column in df.columns
        if column.startswith("Expected_")
    }
    metadata = {
        column: parse_cell(column, row[column])
        for column in df.columns
        if column in metadata_columns
    }
    examples.append(
        {
            "inputs": {
                "Test_Id": row["Test_Id"],
                "User_Input": parse_cell("User_Input", row["User_Input"]),
                "Input_Format": row["Input_Format"],
                "Execution_Mode": row["Execution_Mode"],
            },
            "outputs": outputs,
            "metadata": metadata,
        }
    )


client = Client()
dataset_name = "Slack_Message_Intelligence_Agent_Golden_Dataset_v1"
if client.has_dataset(dataset_name=dataset_name):
    dataset = next(client.list_datasets(dataset_name=dataset_name, limit=1))
    existing_examples = list(client.list_examples(dataset_id=dataset.id, limit=100))
else:
    dataset = client.create_dataset(
        dataset_name=dataset_name,
        description="Fifty labeled Slack Message Intelligence evaluation cases.",
    )
    existing_examples = []

existing_by_test_id = {
    str((example.metadata or {}).get("Test_Id")): example
    for example in existing_examples
    if isinstance(example.metadata, dict) and example.metadata.get("Test_Id")
}
updated = 0
created = 0
for example in examples:
    test_id = str(example["metadata"]["Test_Id"])
    existing = existing_by_test_id.get(test_id)
    if existing is None:
        client.create_examples(dataset_id=dataset.id, examples=[example])
        created += 1
    else:
        client.update_example(
            existing.id,
            inputs=example["inputs"],
            outputs=example["outputs"],
            metadata=example["metadata"],
            dataset_id=dataset.id,
        )
        updated += 1

if not examples:
    print(f"Dataset contains no source rows: {dataset.name} ({dataset.id})")
else:
    print(
        f"Dataset synchronized: {created} created, {updated} updated, "
        f"{len(existing_examples)} previously present: {dataset.name} ({dataset.id})"
    )
