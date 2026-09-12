@echo off
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Follow LOCAL_DEVELOPMENT.md to create the Python environment first.
  pause
  exit /b 1
)
if not exist ".env.live.local" copy ".env.live.example" ".env.live.local" >nul
set "ZAROORI_BAAT_ENV_FILE=.env.live.local"
echo Live backend: http://127.0.0.1:8002
echo Add the bot token and channel IDs to .env.live.local before using Sync Slack.
echo Keep this window open. Press Ctrl+C to stop or restart after changing settings.
".venv\Scripts\python.exe" app.py
pause
