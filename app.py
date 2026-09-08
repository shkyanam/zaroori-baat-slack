from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import sqlite3
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).parent
DATABASE_PATH = ROOT / "zaroori_baat_v2.sqlite3"


def load_local_env() -> None:
    env_path = ROOT / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_local_env()
PORT = int(os.environ.get("ZAROORI_BAAT_V2_PORT", "8001"))
SLACK_SIGNING_SECRET = os.environ.get("SLACK_SIGNING_SECRET", "")
SLACK_BOT_TOKEN = os.environ.get("SLACK_BOT_TOKEN", "")
SLACK_CHANNEL_ID = os.environ.get("SLACK_CHANNEL_ID", "")
SLACK_CHANNEL_IDS = [
    channel_id.strip()
    for channel_id in os.environ.get("SLACK_CHANNEL_IDS", SLACK_CHANNEL_ID).split(",")
    if channel_id.strip()
]


@dataclass
class PriorityResult:
    priority: str
    score: int
    summary: str
    reason: str
    suggested_action: str


ACTION_TERMS = re.compile(r"\b(please|need|needs|review|approve|confirm|respond|reply|send|fix|blocker|follow up|follow-up|assign|action)\b", re.I)
URGENCY_TERMS = re.compile(r"\b(urgent|asap|today|tonight|eod|deadline|blocked|blocking|critical|production|incident|by \d)\b", re.I)
LOW_VALUE_TERMS = re.compile(r"\b(fyi|lunch|happy birthday|welcome|random|newsletter|announcement)\b", re.I)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def prioritize_message(text: str, mention: bool = False) -> PriorityResult:
    normalized = " ".join(text.split())
    action_hits = len(ACTION_TERMS.findall(normalized))
    urgency_hits = len(URGENCY_TERMS.findall(normalized))
    low_value_hits = len(LOW_VALUE_TERMS.findall(normalized))
    score = min(100, action_hits * 18 + urgency_hits * 24 + (18 if mention else 0) + (8 if "?" in normalized else 0))

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

    return PriorityResult(priority, score, normalized[:140], reason, suggested_action)


def connection() -> sqlite3.Connection:
    database = sqlite3.connect(DATABASE_PATH)
    database.row_factory = sqlite3.Row
    return database


def initialize_database() -> None:
    with connection() as database:
        database.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                external_id TEXT UNIQUE,
                channel TEXT NOT NULL,
                sender TEXT NOT NULL,
                text TEXT NOT NULL,
                priority TEXT NOT NULL,
                score INTEGER NOT NULL,
                summary TEXT NOT NULL,
                reason TEXT NOT NULL,
                suggested_action TEXT NOT NULL,
                decision TEXT,
                created_at TEXT NOT NULL,
                decided_at TEXT
            )
        """)
        database.commit()


def create_message(text: str, sender: str = "Mock Slack user", channel: str = "demo", external_id: str | None = None, mention: bool = False) -> dict[str, Any]:
    if external_id:
        with connection() as database:
            existing = database.execute("SELECT id FROM messages WHERE external_id = ?", (external_id,)).fetchone()
        if existing:
            return get_message(existing[0])

    result = prioritize_message(text, mention)
    message_id = str(uuid.uuid4())
    with connection() as database:
        database.execute("""
            INSERT INTO messages (id, external_id, channel, sender, text, priority, score, summary, reason, suggested_action, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (message_id, external_id, channel, sender, text, result.priority, result.score, result.summary, result.reason, result.suggested_action, utc_now()))
        database.commit()
    return get_message(message_id)


def get_message(message_id: str) -> dict[str, Any]:
    with connection() as database:
        row = database.execute("SELECT * FROM messages WHERE id = ?", (message_id,)).fetchone()
    if row is None:
        raise KeyError(message_id)
    return dict(row)


def list_messages() -> list[dict[str, Any]]:
    with connection() as database:
        rows = database.execute("""
            SELECT * FROM messages
            ORDER BY CASE WHEN decision IS NULL THEN 0 ELSE 1 END,
                     CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
                     score DESC, created_at DESC
        """).fetchall()
    return [dict(row) for row in rows]


def record_decision(message_id: str, decision: str) -> dict[str, Any]:
    if decision not in {"approved", "dismissed", "deferred", "escalated"}:
        raise ValueError("Invalid decision")
    with connection() as database:
        cursor = database.execute("UPDATE messages SET decision = ?, decided_at = ? WHERE id = ?", (decision, utc_now(), message_id))
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
    return [create_message(text, sender, channel, event_id, mention)]


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
            )
            count += 1
    return count


def seed_demo() -> None:
    with connection() as database:
        if database.execute("SELECT COUNT(*) FROM messages").fetchone()[0]:
            return
    create_message("Production is blocked. Please review the deployment failure and assign an owner today.", "Asha", "#platform")
    create_message("Please review the procurement requirements before EOD.", "Amrish", "#product")
    create_message("FYI: team lunch is next Friday.", "Ravi", "#general")


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
        path = urlparse(self.path).path
        if path == "/health":
            self.send_json({"status": "ok", "service": "zaroori-baat-v2"})
        elif path == "/api/messages":
            self.send_json({"messages": list_messages()})
        elif path == "/webhooks/slack":
            self.send_json({"error": "Use POST for Slack events"}, HTTPStatus.METHOD_NOT_ALLOWED)
        elif path in {"/", "/index.html"}:
            self.serve("index.html", "text/html; charset=utf-8")
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
            elif path == "/api/slack/sync":
                self.send_json({"ok": True, "ingested": sync_slack_history()})
            elif path.startswith("/api/messages/") and path.endswith("/decision"):
                message_id = path.split("/")[3]
                self.send_json(record_decision(message_id, str(payload.get("decision", ""))))
            else:
                self.send_json({"error": "Not found"}, HTTPStatus.NOT_FOUND)
        except (ValueError, json.JSONDecodeError) as error:
            self.send_json({"error": str(error)}, HTTPStatus.BAD_REQUEST)
        except KeyError:
            self.send_json({"error": "Message not found"}, HTTPStatus.NOT_FOUND)

    def serve(self, filename: str, content_type: str) -> None:
        content = (ROOT / filename).read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def log_message(self, format_string: str, *args: Any) -> None:
        print(f"{self.address_string()} - {format_string % args}")


def main() -> None:
    initialize_database()
    seed_demo()
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Zaroori Baat V2 running at http://127.0.0.1:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
