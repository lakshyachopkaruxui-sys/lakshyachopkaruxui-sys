@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is needed to run the project. Install Node.js 24 LTS, then reopen this file.
  pause
  exit /b 1
)
if not exist "node_modules\vite\package.json" (
  echo Installing this project's dependencies...
  call npm ci
  if errorlevel 1 (
    echo Installation failed. Check the connection and the message above.
    pause
    exit /b 1
  )
)
echo Opening Tear. Keep this window open while previewing; press Ctrl+C to stop.
call npm run dev:http -- --host 127.0.0.1 --open
pause
