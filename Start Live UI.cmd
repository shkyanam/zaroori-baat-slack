@echo off
cd /d "%~dp0frontend"
if not exist "node_modules\vite\bin\vite.js" (
  echo Follow LOCAL_DEVELOPMENT.md to install frontend dependencies first.
  pause
  exit /b 1
)
if not exist ".env.live.local" copy ".env.live.example" ".env.live.local" >nul
echo Start Live Backend.cmd first. UI preview: http://127.0.0.1:5173
call npm.cmd run dev:live
pause
