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

The UI uses **Daybreak**, a shared design system with Inter interface text, Plus Jakarta Sans headings, a cool canvas, and apricot focus accents. [The design guide](frontend/DESIGN_SYSTEM.md) documents the palette, typography, spacing, and accessibility rules; [the tokens](frontend/src/tokens.css) are the source of truth for styling changes.

## Work on the frontend

Run the Python server, then in a second terminal:

```powershell
cd frontend
npm.cmd run dev
```

Open the Vite URL shown in that terminal. Vite proxies `/api` and `/health` to Python on port 8001. After changing the UI, run `npm.cmd run build` to update the version served directly by Python. Backend changes require a Python restart. Node is only needed for frontend development/building; the compiled UI runs with Python.

## Review journeys

The home screen now brings the highest-ranked actionable conversation forward, with two next-up cards and a quieter remaining queue. FYI messages are folded into a Quiet corner. Search and filters expand when needed. Selecting a conversation opens a guided **Understand → Prepare → Decide** flow; after saving a review, **Next conversation** brings forward the next pending item. Keyboard navigation and browser back/forward are supported.

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

The local work branch is `feat/mitesh-review-workspace`. Source code and `frontend/package-lock.json` can be reviewed and pushed to the team repository after feedback. `.env`, virtual environments, databases, build output, browser downloads, test artifacts, and runtime logs are ignored. The Context Resources folder remains outside the repository.
