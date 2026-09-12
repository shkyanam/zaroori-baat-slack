# Local review workspace

The React UI lives in `frontend/` and uses the existing Python JSON APIs. Python serves the compiled frontend at http://127.0.0.1:8001. The original UI remains available at `/legacy`. No remote deployment or Git push is needed.

## Start the app after setup

On Windows, double-click **Start Local.cmd**, then open http://127.0.0.1:8001. Keep its terminal open while using the app. If a server is already running on that port, use the existing browser URL rather than starting another copy.

Alternatively, from the repository:

```powershell
.\.venv\Scripts\python.exe app.py
```

## First-time setup

Use a supported Python 3.13 environment and a current Node.js LTS release (the local build was verified with Node 24).

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
cd frontend
npm.cmd ci
npm.cmd run build
cd ..
.\.venv\Scripts\python.exe scripts\seed_demo.py
.\.venv\Scripts\python.exe app.py
```

On macOS/Linux, use `.venv/bin/python` and `npm` in the equivalent commands.

The demo seed adds 18 fictional conversations covering all seven categories, related context, extracted work, decisions, and existing review outcomes. It is idempotent, preserves existing reviews, and blocks outbound network access while seeding. It does not require Slack, Nebius, Mem0, or LangSmith credentials. All sample external findings remain labeled in the UI.

Fonts are bundled locally with the frontend. The demo UI needs no external font/CDN requests.

The UI uses a **Slack-inspired workspace** with local Inter typography, aubergine navigation, white reading surfaces, green primary actions, and lilac selections. Slack source labels follow conversations through every page and review step. Channel shortcuts filter by the original channel ID while displaying its name; sync status reports recorded activity. [The design guide](frontend/DESIGN_SYSTEM.md) documents the palette, typography, spacing, and accessibility rules; [the tokens](frontend/src/tokens.css) are the source of truth for styling changes.

## Work on the frontend

Run the Python server, then in a second terminal:

```powershell
cd frontend
npm.cmd run dev
```

Open the Vite URL shown in that terminal. Vite proxies `/api` and `/health` to Python on port 8001. After changing the UI, run `npm.cmd run build` to update the version served directly by Python. Backend changes require a Python restart. Node is only needed for frontend development/building; the compiled UI runs with Python.

## Develop with real Slack messages

The Git repository contains the integration code. Slack access comes from the running Python backend's local configuration; a Slack channel URL alone does not authorize API access.

Use a separate local backend and database for real messages:

1. Copy `.env.live.example` to `.env.live.local` in the repository root. Fill in the existing Slack app's `SLACK_BOT_TOKEN` and the channel ID(s) in `SLACK_CHANNEL_IDS`. This local file is ignored by Git. The bot must be installed in that workspace and invited to the selected channels. Keep tokens out of chat and frontend variables.
2. Copy `frontend/.env.live.example` to `frontend/.env.live.local`. The default `ZAROORI_API_TARGET=http://127.0.0.1:8002` points at the separate local backend.
3. On Windows, open **Start Live Backend.cmd**, then **Start Live UI.cmd**. Use the two terminals to stop/restart each process with Ctrl+C. If those processes are already running, use their existing URLs.
4. Open http://127.0.0.1:5173 alongside the Slack channel. Select **Sync Slack** to import recent accessible messages, then review the UI. Source edits refresh immediately. The UI rereads the backend queue every 15 seconds while visible; that polling does not fetch Slack history itself. Select **Sync Slack** again to import newly posted messages unless Slack events are already reaching this backend.

Equivalent terminals from the repository root:

```powershell
$env:ZAROORI_BAAT_ENV_FILE = '.env.live.local'
.\.venv\Scripts\python.exe app.py
```

```powershell
cd frontend
npm.cmd run dev:live
```

The live example uses port 8002, `.runtime/live/messages.sqlite3`, a separate checkpoint file, and `ZAROORI_BAAT_SEED_DEMO=false`. It starts empty and preserves the demo database on port 8001. Reviews are saved to this local live database; they do not post messages to Slack. Draft edits remain in the browser tab. A restart is required after changing backend settings.

The minimal setup uses live Slack messages with the existing fallback analysis. Optional LLM, Mem0, and LangSmith configuration belongs in the backend's ignored local file. External build/incident/PR context remains sample data. History sync currently imports up to 50 recent messages per configured channel.

If the team later deploys the backend, point `ZAROORI_API_TARGET` at that app's HTTP(S) base URL and restart Vite. Reviews would then update that backend's shared queue. Keep automated mutation journeys on the isolated demo backend, not a shared live workspace. The preview uses Vite's [development proxy](https://vite.dev/config/server-options#server-proxy); credentials stay on the Python backend.

### Slack display names

The backend resolves sender and channel IDs using Slack metadata and returns additive `sender_name` and `channel_name` fields. Canonical `sender` and `channel` values remain unchanged for routing, threading, filtering, and compatibility. Related messages, memory-source metadata, and workflow activity can include the same display fields. The frontend uses names in labels and search while channel filters retain their original ID values.

User-name lookup requires the bot's [`users:read` scope](https://docs.slack.dev/reference/methods/users.info/). Channel-name lookup uses [`conversations.info`](https://docs.slack.dev/reference/methods/conversations.info/) and the read scope for the channel type. If Slack returns `missing_scope`, add the required scope under the Slack app's **OAuth & Permissions → Bot Token Scopes**, reinstall the app to the workspace, update the ignored local token if Slack changes it, and restart the backend. Keep credentials out of chat and source files.

Name lookups run in the background, including for messages already stored locally. Successful names are cached for six hours; failed requests back off instead of retrying on every UI poll. A cold response may initially show an ID, then show its name on the next refresh. Missing permissions do not block messages or reviews. A backend restart clears permission-error backoff so newly granted scopes can take effect immediately.

## Review journeys

The dashboard brings the highest-ranked actionable conversation forward, with compact totals, a priority breakdown, and two next-up previews. The remaining queue groups all seven message types, including FYI, with independent priority filters. Full messages open explicitly from previews. Search and advanced filters expand when needed. Selecting a conversation opens a guided **Understand → Prepare → Decide** flow; after saving a review, **Next conversation** brings forward the next pending item. Keyboard navigation and browser back/forward are supported.

1. **Inbox:** search and filter the queue, switch Needs review / Deferred / All messages, and inspect a conversation.
2. **Details:** inspect original text, rationale, sample evidence, related discussion, extracted work, and confidence information. Edit/copy a response draft. Draft edits are kept in the browser tab's session storage; they are not sent or saved to the server.
3. **Review:** approve, dismiss, or defer a message. Reload to verify persistence. Reopen it to return to Needs review.
4. **Action items:** browse unique extracted tasks, follow-ups, and risks, filter by type/owner, and open their source messages.
5. **Decision memory:** browse extracted decisions, inspect rationale/alternatives, search stored decisions, and follow source links.
6. **Reviewed:** inspect the latest saved outcome and review timestamp. The current backend stores the latest review, not an immutable history of every change.
7. **System:** inspect integration configuration and workflow metrics, and switch comfortable/compact density.

Approving records a **message-level review**. It does not send Slack replies, create external tasks, or execute a queued action. Defer has no timer or automatic reminder. Extracted work is read-only. Slack sync and hosted memory require the corresponding server configuration described in README.md. A configured integration is not proof of a successful live connection.

The workspace's Mitesh profile is a local display label, not an authenticated account or personalized access filter. Treat this local app as the team's shared review queue.

## Validation

Backend checks isolate their database and never contact external services:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests/backend -v
```

Build and browser journeys (start the Python server and seed demo data first):

```powershell
cd frontend
npm.cmd run build
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path (Get-Location) '..\.cache\ms-playwright'
npx.cmd playwright install chromium
npm.cmd run test:e2e
```

Browser tests use the demo UI-review message and restore its original review state. Do not run them while someone is actively reviewing that same fixture. Screenshots/traces for failures are saved under `frontend/test-results/` and are ignored by Git.

## Git and local files

The Slack workspace updates are on `feat/live-slack-preview`. Source code and `frontend/package-lock.json` belong in the team repository. `.env` and local credential files, virtual environments, databases, build output, browser downloads, test artifacts, and runtime logs are ignored. The Context Resources folder remains outside the repository.
