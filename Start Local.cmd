@echo off
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Python environment is missing. Follow LOCAL_DEVELOPMENT.md to set up the app.
  pause
  exit /b 1
)
if not exist "frontend\dist\index.html" (
  echo Building the frontend...
  pushd frontend
  call npm.cmd run build
  if errorlevel 1 (
    popd
    pause
    exit /b 1
  )
  popd
)
echo Open http://127.0.0.1:8001 in your browser.
echo Keep this window open while reviewing. Press Ctrl+C to stop.
".venv\Scripts\python.exe" app.py
pause
