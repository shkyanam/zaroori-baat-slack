# Zaroori Baat Slack API Reference

This document describes the HTTP API exposed by `app.py`, with emphasis on the
classification and priority values emitted for Slack messages.

## Base URL

```text
http://127.0.0.1:8001
```

## Classification and priority fields

Message-producing endpoints return `classification` and `priority` as separate
top-level fields. The API does not currently return a literal `tags` array.
Consumers that need tags can use `classification` as the classification tag and
`priority` as the priority tag.

Example:

```json
{
  "classification": "Incident",
  "priority": "high",
  "score": 66,
  "reason": "The message signals urgency, a blocker, or an explicit action with a deadline.",
  "suggested_action": "Review and assign an owner"
}
```

### Classification tags

Every message receives exactly one of these values:

| Classification tag | Meaning | Typical signals |
| --- | --- | --- |
| `FYI` | Informational or social message with no clear action | `fyi`, announcement, lunch, welcome |
| `Action Required` | A person needs to perform or coordinate work | please, need, review, respond, fix, assign, deadline |
| `Question` | A question or request for information | question mark or an interrogative opening such as what, why, how, when, or who |
| `Incident` | A production, reliability, or failure-related issue | incident, outage, production, blocked, failure, bug, error, rollback |
| `Escalation` | A matter raised to leadership or management | escalate, leadership, manager, executive |
| `Approval Request` | A decision-maker is asked to approve or authorize something | approve, approval, sign-off, authorize, permission |
| `Decision Needed` | A decision is open or a decision language is present | decision, decide, choose, select, recommendation, vote |

When multiple signals are present, classification is selected in this order:

```text
Approval Request → Escalation → Incident → Decision Needed → Question → Action Required → FYI
```

### Priority tags

Every message receives one of these values:

| Priority tag | Meaning | Assignment rule |
| --- | --- | --- |
| `high` | Immediate attention is likely needed | Any urgency signal, or score `>= 60` |
| `medium` | Review is needed, but there is no immediate urgency | Any action signal, or score `>= 25`; otherwise the default priority |
| `low` | Informational or social content | Low-value signal and no earlier high/medium rule matched |

The score is capped at 100 and is calculated from message signals:

```text
score = min(100,
  action_hits * 18
  + urgency_hits * 24
  + 18 if the message mentions the bot/user
  + 8 if the message contains '?'
)
```

Urgency signals include terms such as `urgent`, `ASAP`, `today`, `EOD`,
`deadline`, `blocked`, `critical`, `production`, and `incident`.

## Message endpoints

### `GET /api/messages`

Returns all stored messages. Messages are ordered with pending reviews first,
then by priority and score.

Response:

```json
{
  "messages": [
    {
      "id": "uuid",
      "external_id": "slack-event-id",
      "channel": "C0123456789",
      "thread_ts": "1730000000.000100",
      "sender": "U0123456789",
      "text": "Production is blocked. Please review the deployment failure today.",
      "priority": "high",
      "classification": "Incident",
      "score": 66,
      "summary": "Production is blocked. Please review the deployment failure today.",
      "reason": "The message signals urgency, a blocker, or an explicit action with a deadline.",
      "suggested_action": "Review and assign an owner",
      "decision": null,
      "decided_at": null,
      "created_at": "2026-09-12T10:00:00+00:00",
      "context": {},
      "action_extraction": {},
      "decision_memory": {}
    }
  ]
}
```

### `POST /api/messages`

Creates and processes a message through the workflow. This is useful for local
API testing without Slack.

Request:

```json
{
  "text": "Please review the deployment plan by Friday."
}
```

Response: `201 Created` with the resulting message object, including
`classification`, `priority`, `score`, `reason`, and `suggested_action`.

### `GET /api/messages/{id}`

Returns one processed message. Returns `404` when the message ID is unknown.

### `POST /api/messages/{id}/context`

Runs the workflow again for an existing message and refreshes its context,
actions, decision memory, classification, and priority. Existing review state is
preserved.

### `POST /api/messages/{id}/decision`

Stores the message-level review outcome.

Request:

```json
{
  "decision": "approved"
}
```

Allowed decisions:

```text
approved | dismissed | deferred | escalated | pending
```

Use `pending` to reopen a previously reviewed message. Invalid decisions return
`400 Bad Request`.

## Slack ingestion endpoints

### `POST /webhooks/slack`

Receives Slack Events API payloads. It accepts `message` and `app_mention`
events, ignores empty messages and Slack message subtypes, processes the message,
and returns:

```json
{
  "ok": true,
  "ingested": 1
}
```

During Slack URL verification it returns the challenge:

```json
{
  "challenge": "challenge-from-slack"
}
```

Set `SLACK_SIGNING_SECRET` so incoming requests are authenticated. Invalid
signatures return `403 Forbidden`.

### `POST /api/slack/sync`

Reads history from the channels configured in `SLACK_CHANNEL_IDS` using the
`SLACK_BOT_TOKEN`, processes each message, and returns:

```json
{
  "ok": true,
  "ingested": 12
}
```

This endpoint requires both `SLACK_BOT_TOKEN` and `SLACK_CHANNEL_IDS`.

## Status and observability endpoints

| Method and path | Purpose |
| --- | --- |
| `GET /health` | Basic health, workflow, and observability status |
| `GET /api/system/status` | Slack configuration, context, memory, workflow, and demo status |
| `GET /api/workflow/status` | LangGraph engine and checkpointer status |
| `GET /api/observability/status` | Safe LangSmith configuration status |
| `GET /api/observability/summary` | Workflow totals, failures, durations, recent runs, and classification counts |
| `GET /api/decision-memory/status` | Mem0/local decision-memory status |
| `GET /api/decision-memory/search?q={query}` | Search stored decision memory |
| `POST /api/decision-memory/sync` | Sync locally saved decisions to Mem0 when enabled |

The observability summary exposes classification counts in this shape:

```json
{
  "metrics": {
    "total_runs": 18,
    "completed_runs": 18,
    "failed_runs": 0,
    "average_duration_ms": 12.4,
    "classifications": {
      "FYI": 3,
      "Action Required": 5,
      "Incident": 2
    }
  }
}
```

## cURL examples

Create a message and inspect its emitted tags:

```bash
curl -s -X POST http://127.0.0.1:8001/api/messages \
  -H 'Content-Type: application/json' \
  -d '{"text":"Production is blocked. Please assign an owner today."}'
```

List messages and filter them by classification or priority locally:

```bash
curl -s http://127.0.0.1:8001/api/messages
```

Check the workflow classification totals:

```bash
curl -s http://127.0.0.1:8001/api/observability/summary
```

## Important behavior

- Classification and priority are deterministic by default and do not require
  an external LLM.
- `classification` describes the type of message; `priority` describes how
  urgently it should be reviewed. They are independent values.
- Review decisions are message-level state, not an immutable review history.
- The application does not automatically send Slack replies or create external
  tasks from these endpoints.
- Keep Slack, LangSmith, Nebius, and Mem0 credentials in environment variables,
  never in source-controlled files.
