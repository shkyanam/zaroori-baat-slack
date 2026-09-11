# Zaroori Baat Slack

## Slack Signal Desk

Zaroori Baat Slack scans incoming Slack message events, scores actionability, and ranks the messages most likely to need a response, owner, or decision.

![Zaroori Baat Slack architecture](zaroori-baat-slack-architecture.svg)

### Run locally

```bash
cd /Users/shalinikyanam/Documents/Training/MasteringAgenticAI/SlackProject
python3 app.py
```

Open http://127.0.0.1:8001.

### Slack app setup

Create a Slack app at api.slack.com/apps and enable **Event Subscriptions**. Set the Request URL to:

```text
https://YOUR_PUBLIC_HOST/webhooks/slack
```

Subscribe to bot events such as `message.channels`, `message.groups`, or `message.im` according to the channels the bot is allowed to access. Set `SLACK_SIGNING_SECRET` in the environment before production use. The endpoint supports Slack URL verification and verifies signed requests when the secret is configured. Set `SLACK_CHANNEL_IDS` to a comma-separated list to scan multiple channels with one Sync Slack action.

### Add every new Slack channel

For each new channel that Zaroori Baat should scan:

1. Open the channel in Slack and invite the Zaroori Baat bot/app:

   ```text
   /invite @Zaroori Baat Slack
   ```

   Use the bot's actual Slack display name if it differs. The bot must be a member of private channels.
2. Copy the channel ID from the channel details. Use the ID, not the channel name.
3. Add the channel ID to `.env`, keeping existing channel IDs separated by commas:

   ```env
   SLACK_BOT_TOKEN=xoxb-your-token
   SLACK_CHANNEL_IDS=C012OLDCHANNEL,C012NEWCHANNEL
   SLACK_SIGNING_SECRET=your-signing-secret
   ```

4. Restart the local server so it reloads `.env`, then select **Sync Slack** in the app.

If a channel is not included in `SLACK_CHANNEL_IDS`, history sync will not scan it. If Slack returns `not_in_channel`, invite the bot to that channel and try again.

### Design boundary

This MVP processes events delivered to the Slack app. It does not scrape Slack's UI or pull private history without the required Slack scopes. The queue is connector-independent, so mock messages can be used for evaluation.

### Message classifications

Every message is assigned one classification: **FYI**, **Action Required**, **Question**, **Incident**, **Escalation**, **Approval Request**, or **Decision Needed**. The web UI provides a tab for each classification, with counts and filtered messages.

### Context enrichment

Messages received through the Slack webhook or **Sync Slack** are enriched before they appear in the queue. The enrichment agent uses each Slack message plus related messages from the locally synced Slack history as its input, checks mocked ADO, build history, the incident system, related PRs, and previous discussions, then presents the findings and a suggested response on the message card. Use **Refresh context** to rerun the enrichment.

To enable LLM synthesis with Nebius Token Factory, set `NEBIUS_CONTEXT_ENABLED=true`, `NEBIUS_API_KEY`, and `NEBIUS_MODEL` in the environment. The default base URL is `https://api.tokenfactory.nebius.com/v1`; set `NEBIUS_BASE_URL` to a different Nebius endpoint when needed. `LLM_*` equivalents are also supported. The default is disabled so Slack content is not sent externally until explicitly enabled. The app sends the current Slack message, locally related Slack messages, and mocked system findings to `/v1/chat/completions`, then validates the JSON response; keep the API key out of project files.

Example:

```bash
export NEBIUS_API_KEY='your-key'
export NEBIUS_MODEL='your-enabled-model'
export NEBIUS_CONTEXT_ENABLED=true
python3 app.py
```

### Action extraction

Each incoming Slack message is also processed by the Action Extraction Agent. It combines the message with related Slack history and extracts **Tasks**, **Follow-ups**, **Risks**, and **Decisions**. Each extracted item includes an owner and due date when explicitly present, plus its Slack thread or channel source. The action results are shown on the message card and are stored separately from the context briefing. If the LLM is unavailable, the app uses a deterministic fallback and does not invent missing owners or dates.

### Decision memory

The Decision Memory Agent records decisions that appear to have been made, including the chosen option, alternatives considered, participants, date, rationale, confidence, and source messages. It combines the current Slack message with related local Slack history, so a decision can be reconstructed when its context is spread across a thread. Open questions and suggestions are not stored as decisions. If the LLM is unavailable, a deterministic fallback captures only explicit decision language.

### Mem0 semantic memory

The app can sync extracted decisions to hosted Mem0 for semantic, cross-message retrieval. SQLite remains the local audit source. Add a Mem0 Platform API key to `.env`, then enable it:

```env
MEM0_ENABLED=true
MEM0_API_KEY=your-mem0-api-key
MEM0_BASE_URL=https://api.mem0.ai
MEM0_USER_ID=zaroori-baat-workspace
```

New decisions are written to Mem0 automatically. Use **Sync saved decisions** to backfill decisions already stored locally, and use **Ask what the team decided** to search them. If Mem0 is disabled or unavailable, the UI falls back to local SQLite decision memory. The integration uses Mem0's hosted add/search API; the Mem0 key is separate from the Nebius key.

### Priority model

- **High:** blocker, incident, deadline, urgent request, or explicit action with a near-term time.
- **Medium:** actionable request without an immediate deadline.
- **Low:** informational or social message without a clear action.

Human actions are recorded as `approved`, `deferred`, `dismissed`, or `escalated`.
