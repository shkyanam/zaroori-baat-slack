"""Add realistic local demo conversations without contacting external services.

Run from the repository: python scripts/seed_demo.py
Existing messages and review outcomes are preserved on repeated runs.
"""

from __future__ import annotations

import argparse
from contextlib import ExitStack
from datetime import datetime, timedelta, timezone
import os
from pathlib import Path
import sys
from unittest.mock import patch
import uuid


ROOT = Path(__file__).resolve().parents[1]

# These conversations are fictional. Stable external IDs make seeding additive.
MESSAGES = [
    {
        "key": "checkout-incident", "sender": "Rajesh Kumar", "channel": "#payments",
        "minutes_ago": 14, "mention": True, "thread": "checkout-latency",
        "text": "SEV-2 incident: checkout latency has crossed 4 seconds after the payments deploy. About 12% of requests are timing out. Please review the rollback plan before today. Owner: Rajesh. Customer support needs an update in 30 minutes.",
    },
    {
        "key": "checkout-evidence", "sender": "Shalini Kyanam", "channel": "#payments",
        "minutes_ago": 24, "thread": "checkout-latency",
        "text": "Checkout latency investigation: the connection pool is saturated on the payments service. Build #8424 introduced a lower pool limit. Rajesh will handle the configuration comparison and validate the previous setting before today.",
    },
    {
        "key": "launch-escalation", "sender": "Ambrish Tripathi", "channel": "#product",
        "minutes_ago": 38, "mention": True,
        "text": "Escalation for leadership: the onboarding launch is at risk because the identity vendor has not shared sandbox access. Mitesh should own the follow-up before today. Please send a revised launch recommendation by EOD.",
    },
    {
        "key": "release-approval", "sender": "Sneha Joseph", "channel": "#releases",
        "minutes_ago": 52,
        "text": "Approval needed for the September release checklist. All 42 acceptance checks passed in staging and the accessibility evidence is attached in the team discussion. Please approve the release window before today. Owner: Mitesh.",
    },
    {
        "key": "ui-review", "sender": "Ambrish Tripathi", "channel": "#design",
        "minutes_ago": 76, "mention": True, "thread": "inbox-review",
        "text": "<@Mitesh> Please review the new message detail layout before tomorrow. We need feedback on the evidence panel, owner visibility, and the defer journey. Mitesh will own the design walkthrough with the group.",
    },
    {
        "key": "review-draft", "sender": "Shalini Rao", "channel": "#design",
        "minutes_ago": 101, "thread": "inbox-review",
        "text": "The inbox prototype now places the original Slack message above generated context. Review controls stay visible while scrolling. Please validate the keyboard navigation before tomorrow. Owner: Sneha.",
    },
    {
        "key": "storage-choice", "sender": "Rajesh Kumar", "channel": "#engineering",
        "minutes_ago": 124,
        "text": "Decision needed for the pilot: choose SQLite or PostgreSQL for shared review state. SQLite keeps the local demo simple; PostgreSQL supports concurrent reviewers. Please share your recommendation before tomorrow.",
    },
    {
        "key": "analytics-question", "sender": "Ravi Varma", "channel": "#analytics",
        "minutes_ago": 165,
        "text": "What does the signal score represent in the weekly report? Is it urgency, confidence, or a combination of the ranking rules? I want to label the evaluation dashboard accurately.",
    },
    {
        "key": "evaluation-actions", "sender": "Sneha Joseph", "channel": "#quality",
        "minutes_ago": 210,
        "text": "Please complete the evaluation cases for message classification before tomorrow. Ravi will handle the confusion matrix. Sneha will own the adversarial examples and follow-up with the group by Friday.",
    },
    {
        "key": "permissions-question", "sender": "Shalini Kyanam", "channel": "#engineering",
        "minutes_ago": 272,
        "text": "Which Slack channels should be included in the pilot workspace? Can we start with product, engineering, and quality so the team can assess relevance with a smaller set of messages?",
    },
    {
        "key": "handoff-followup", "sender": "Ravi Varma", "channel": "#product",
        "minutes_ago": 335,
        "text": "Please follow up on the customer onboarding handoff before Friday. Ambrish will own the revised checklist and send the final copy to the internal project folder. The dependency on sample account data may affect the walkthrough.",
    },
    {
        "key": "demo-announcement", "sender": "Ambrish Tripathi", "channel": "#team-general",
        "minutes_ago": 402,
        "text": "FYI: the group demo walkthrough is on Friday afternoon. The agenda covers the inbox, action extraction, decision memory, and a look at the workflow traces. The recording will be available afterward.",
    },
    {
        "key": "research-fyi", "sender": "Shalini Rao", "channel": "#design",
        "minutes_ago": 610,
        "text": "FYI: the latest discovery notes are in the shared project folder. Three interviewees said they lose track of requests spread across channels. Two mentioned that clear source context would make summaries easier to trust.",
    },
    {
        "key": "digest-deferred", "sender": "Ambrish Tripathi", "channel": "#product",
        "minutes_ago": 850, "decision": "deferred",
        "text": "Please review the daily digest concept before Friday. This can wait until the main inbox journey is settled. Mitesh should own the layout exploration and follow-up with the group tomorrow.",
    },
    {
        "key": "onboarding-deferred", "sender": "Shalini Rao", "channel": "#design",
        "minutes_ago": 980, "decision": "deferred",
        "text": "Can we add a short onboarding tour for first-time reviewers? It would explain categories, ranking rationale, and how review outcomes are saved. I have a draft ready for our next design session.",
    },
    {
        "key": "storage-decided", "sender": "Rajesh Kumar", "channel": "#engineering",
        "minutes_ago": 1200, "decision": "approved", "thread": "pilot-storage",
        "text": "We decided to use SQLite for the local pilot. Let's use SQLite instead of PostgreSQL. The reason is that every teammate can run the demo without managing a database service. Participants: Rajesh, Shalini, Mitesh. We will revisit shared storage before hosting the team version.",
    },
    {
        "key": "review-decided", "sender": "Mitesh", "channel": "#design",
        "minutes_ago": 1430, "decision": "approved", "thread": "review-policy",
        "text": "We agreed to keep every suggested reply behind human review. Let's use explicit confirmation instead of automatic sending. The reason is that reviewers need to inspect the evidence and edit the response first. Participants: Mitesh, Ambrish, Sneha.",
    },
    {
        "key": "social-dismissed", "sender": "Ravi Varma", "channel": "#team-general",
        "minutes_ago": 1680, "decision": "dismissed",
        "text": "FYI: the team lunch photos are now in the social folder. Thanks everyone for a lovely afternoon!",
    },
]


def configure_offline() -> None:
    """Override inherited settings before app or tracing libraries are imported."""
    os.environ.update({
        "ZAROORI_BAAT_SKIP_ENV": "1",
        "LLM_CONTEXT_ENABLED": "false", "NEBIUS_CONTEXT_ENABLED": "false",
        "LLM_API_KEY": "", "NEBIUS_API_KEY": "", "OPENAI_API_KEY": "",
        "LLM_MODEL": "", "NEBIUS_MODEL": "",
        "MEM0_ENABLED": "false", "MEM0_API_KEY": "",
        "LANGSMITH_TRACING": "false", "LANGCHAIN_TRACING": "false",
        "LANGCHAIN_TRACING_V2": "false", "LANGSMITH_API_KEY": "", "LANGCHAIN_API_KEY": "",
        "SLACK_BOT_TOKEN": "", "SLACK_CHANNEL_IDS": "", "SLACK_CHANNEL_ID": "",
        "LANGGRAPH_CHECKPOINTER": "sqlite", "LANGGRAPH_POSTGRES_URI": "",
    })


def seed_workspace(database_path: Path | None = None, checkpoint_path: Path | None = None) -> dict[str, int]:
    configure_offline()
    if str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))
    # A final barrier prevents all outbound network, including tracing-library
    # background traffic, even if an integration starts ignoring its flags.
    with ExitStack() as stack:
        stack.enter_context(patch("socket.socket.connect", side_effect=RuntimeError("Demo seeding is offline")))
        stack.enter_context(patch("socket.create_connection", side_effect=RuntimeError("Demo seeding is offline")))
        import app

        if database_path is not None:
            app.DATABASE_PATH = database_path.resolve()
        if checkpoint_path is not None:
            app.LANGGRAPH_CHECKPOINT_PATH = checkpoint_path.resolve()
        app.initialize_database()
        now = datetime.now(timezone.utc)
        added = 0
        existing = 0
        # Oldest first gives newer conversation members prior context to retrieve.
        for sample in reversed(MESSAGES):
            external_id = "demo-ui-v1-" + sample["key"]
            with app.connection() as database:
                found = database.execute("SELECT id FROM messages WHERE external_id = ?", (external_id,)).fetchone()
            if found:
                existing += 1
                continue
            message_id = str(uuid.uuid5(uuid.NAMESPACE_URL, "zaroori-baat:" + external_id))
            created_at = (now - timedelta(minutes=sample["minutes_ago"])).isoformat(timespec="seconds")
            message = app.run_message_workflow(
                text=sample["text"], sender=sample["sender"], channel=sample["channel"],
                external_id=external_id, mention=bool(sample.get("mention")),
                thread_ts="demo-" + sample["thread"] if sample.get("thread") else None,
                message_id=message_id, created_at=created_at,
            )
            if sample.get("decision"):
                app.record_decision(message["id"], sample["decision"])
            added += 1
        if app._LANGGRAPH_CHECKPOINT_CONNECTION is not None:
            app._LANGGRAPH_CHECKPOINT_CONNECTION.close()
            app._LANGGRAPH_CHECKPOINT_CONNECTION = None
            app._LANGGRAPH_CHECKPOINTER = None
            app._LANGGRAPH_GRAPH = None
        return {"added": added, "already_present": existing, "total_demo_messages": len(MESSAGES)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, help="Optional alternate local SQLite database")
    parser.add_argument("--checkpoint", type=Path, help="Optional alternate local SQLite checkpoint file")
    arguments = parser.parse_args()
    result = seed_workspace(arguments.database, arguments.checkpoint)
    print(f"Offline demo ready: {result['added']} messages added, {result['already_present']} already present.")
    print("Existing messages and saved review outcomes were preserved. No external services were contacted.")


if __name__ == "__main__":
    main()
