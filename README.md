# Zaroori Baat Slack

## Review workspace

The React review workspace connects to the existing Python APIs and guides conversations through **Understand → Prepare → Decide**. It includes a priority inbox, extracted action items, decision memory, reviewed conversations, and system status. See [local setup and review journeys](LOCAL_DEVELOPMENT.md) for Windows instructions, the optional offline demo dataset, and browser tests. The [Daybreak design system](frontend/DESIGN_SYSTEM.md) documents the shared typography and visual tokens. Once built, the Python server serves the workspace at `/`; the original frontend remains at `/legacy`.

Zaroori Baat Slack scans incoming Slack message events, scores actionability, and ranks the messages most likely to need a response, owner, or decision.

![Zaroori Baat Slack architecture](zaroori-baat-slack-architecture.svg)

### Run locally

```bash
cd zaroori-baat-slack
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
npm --prefix frontend ci
npm --prefix frontend run build
python3 app.py
```

Open http://127.0.0.1:8001.

The `start_local.sh` convenience script starts the application and ngrok from
the project directory:

```bash
./start_local.sh
```

Use its other modes for the golden dataset:

```bash
./start_local.sh golden-smoke
./start_local.sh all
```

`golden-smoke` runs the guarded three-case test. `all` starts the live app,
ngrok, and the smoke test together, but never starts the 50-case evaluation
automatically.

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

### LangGraph workflow

Message processing runs through a LangGraph stateful workflow:

```text
classify → related messages → context enrichment
                              ├→ action extraction ─┐
                              └→ decision memory ───┴→ persist
```

The graph uses a durable checkpointer. Local development defaults to `SqliteSaver` and writes to the ignored `zaroori_baat_langgraph_checkpoints.sqlite3` file. Production deployments should use the PostgreSQL checkpointer:

```env
LANGGRAPH_CHECKPOINTER=postgres
LANGGRAPH_POSTGRES_URI=postgresql://user:password@host:5432/database?sslmode=require
ZAROORI_BAAT_SLACK_HOST=0.0.0.0
```

Keep the PostgreSQL URI in a deployment secret, not in source control. The `/health` and `/api/workflow/status` endpoints expose only safe workflow configuration.

Each Slack event carries an idempotent message ID through the graph. Database writes preserve existing decisions during retries, and Mem0 writes are skipped after a successful stored-memory marker is recorded.

### LangSmith observability

LangSmith tracing is opt-in. Configure it in `.env` or your deployment secret store:

```env
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=your-langsmith-api-key
LANGSMITH_PROJECT=zaroori-baat-slack
# Set this only for a non-US LangSmith deployment.
# LANGSMITH_ENDPOINT=https://eu.api.smith.langchain.com
LANGSMITH_CAPTURE_CONTENT=false
```

The LangGraph run and each workflow node are traced, including the custom Nebius and Mem0 HTTP calls. `LANGSMITH_CAPTURE_CONTENT=false` hides raw Slack text while retaining safe structured trace summaries; set it to `true` only when Slack content is approved for observability storage. Check configuration at `/api/observability/status`, then open the configured project in [LangSmith](https://smith.langchain.com/).

The main app also includes an **Observability** panel with local workflow totals, completion/failure counts, average duration, recent run status, and classification counts. These metrics are stored without Slack message text in `workflow_runs`, so the panel remains useful even when LangSmith tracing is disabled. Use **Refresh metrics** after processing a new message; LangSmith provides the detailed trace view when tracing is active.

For the Slack Message Intelligence golden dataset, synchronize the CSV mapping and verify the remote dataset with:

```bash
python upload_langsmith_dataset.py
python verify_langsmith_dataset.py
```

The evaluation-facing `orchestrator` in `orchestrator.py` accepts a structured `slack_event` and `test_id`, returns the same 21-key result contract for completed and failed cases, and adds `test_id`, dataset, model, prompt, workflow, and evaluator versions to LangSmith evaluation traces. Keep `SMI_MODEL_NAME` unset when the application should derive it from `NEBIUS_MODEL`.

Verify one end-to-end evaluation trace for the context-enrichment case:

```bash
python verify_langsmith_trace.py
```

This runs `SMI-GD-008`, locates the root trace named `smi-eval-SMI-GD-008`, and verifies the Signal Detection, Context Enrichment, Action Extraction, Decision Memory, and Router child runs. With `LANGSMITH_CAPTURE_CONTENT=false`, the check uses safe structured evidence and does not store Slack text. To inspect full briefing and response text for an approved test, temporarily set `LANGSMITH_CAPTURE_CONTENT=true` before running the check.

Run the deterministic evaluators (EVAL-001 through EVAL-006 and EVAL-008) with:

```bash
python run_langsmith_eval.py --code-only
```

Run the required three-case smoke test before considering a 50-case run:

```bash
python run_langsmith_smoke.py
```

It runs SMI-GD-008, SMI-GD-027, and SMI-GD-044, verifies the trace ID and
required agent child runs, and stops if an approval executes without human
review or prompt injection changes the deterministic signal. Keep
`LANGSMITH_CAPTURE_CONTENT=false` for this check.

Each evaluator reads `Applicable_Metric_IDs` from the example metadata. A
metric that is not listed returns `NOT_APPLICABLE`, not a zero score. The
case-aware safety checks cover the timeout case SMI-GD-042, duplicate webhook
case SMI-GD-043, and adversarial cases SMI-GD-044 through SMI-GD-050.

Run the optional EVAL-007 LLM judge together with the code evaluators with:

```bash
python run_langsmith_eval.py
```

The LLM judge receives only the expected and generated briefing/suggested-response text. It cannot override deterministic signal classification, priority, workflow, human-review, or autonomous-action results. `SMI_ESCALATION_PROBABILITY_TOLERANCE` defaults to `0.10`, and `SMI_LATENCY_SLO_SECONDS` defaults to `5.0`.

#### Test LangSmith tracing

After restarting the app with LangSmith configured, send these as three separate messages in the same thread in a monitored Slack channel:

```text
The report rollout is blocked on parity validation. We need it before Friday.
I can own the test plan and validate parity before Friday.
Let's use design pattern A instead of design pattern B. Pattern B has performance disadvantages.
```

Click **Sync Slack** (or **Refresh**) in the app, then click **Refresh metrics** in the Observability panel. Sync fetches only the latest `SLACK_SYNC_LIMIT` messages per configured channel (20 by default), uses the previous successful sync as the next history boundary, and processes fetched messages in the background. The UI remains responsive and refreshes as messages complete; a second Sync click while one is running is ignored. The panel should show a new completed workflow run. Open **Open LangSmith** and select the configured project to inspect the parent workflow and its nodes: Signal Detection, related-message retrieval, Context Enrichment, Action Extraction, Decision Memory, persistence, and Router. Nebius and Mem0 calls appear when those integrations are enabled.

### Design boundary

This application processes events delivered to the Slack app. It does not scrape Slack's UI or pull private history without the required Slack scopes. The queue is connector-independent, so mock messages can be used for evaluation.

### Message classifications

Every message is assigned one classification: **FYI**, **Action Required**, **Question**, **Incident**, **Escalation**, **Approval Request**, or **Decision Needed**. The web UI provides a tab for each classification, with counts and filtered messages.

### Context enrichment

Messages received through the Slack webhook or **Sync Slack** are acknowledged and placed in the local Inbox immediately, then enriched in the background. Live ingestion uses the deterministic fast path by default (`SLACK_FAST_PATH=true`), so classification and fallback context/action results appear within seconds without waiting for Nebius or Mem0. The enrichment agent uses each Slack message plus related messages from the locally synced Slack history as its input, checks mocked ADO, build history, the incident system, related PRs, and previous discussions, then updates the message card with the findings and a suggested response. Use **Refresh context** to run the optional full Nebius/Mem0 enrichment, or set `SLACK_FAST_PATH=false` and restart for full background enrichment.

To enable LLM synthesis with Nebius Token Factory, set `NEBIUS_CONTEXT_ENABLED=true`, `NEBIUS_API_KEY`, and `NEBIUS_MODEL` in the environment. The default base URL is `https://api.tokenfactory.nebius.com/v1`; set `NEBIUS_BASE_URL` to a different Nebius endpoint when needed. `LLM_*` equivalents are also supported. The default is disabled so Slack content is not sent externally until explicitly enabled. The app sends the current Slack message, locally related Slack messages, and mocked system findings to `/v1/chat/completions`, then validates the JSON response; keep the API key out of project files.

### Optional hybrid RAG

The application can add semantic retrieval to its existing local keyword and thread matching. When enabled, it sends message text to a configured OpenAI-compatible `/embeddings` endpoint, stores the returned vector in the local SQLite `message_embeddings` table, and merges cosine-similarity results with deterministic matches. It is opt-in and disabled by default.

```dotenv
RAG_ENABLED=true
RAG_EMBEDDING_MODEL=your-embedding-model
# Optional when different from the configured LLM provider
RAG_API_KEY=your-embedding-api-key
RAG_BASE_URL=https://your-openai-compatible-endpoint/v1
RAG_TOP_K=6
RAG_MIN_SIMILARITY=0.35
```

After restarting the app, index existing local Slack messages once:

```bash
curl -X POST http://127.0.0.1:8001/api/rag/reindex
```

Check progress at `http://127.0.0.1:8001/api/rag/status` or in `/api/system/status`. Live Slack ingestion stays fast because RAG is not queried on the default fast path; use **Refresh analysis** for hybrid retrieval, or set `RAG_ON_FAST_PATH=true` only if embedding latency is acceptable.

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
