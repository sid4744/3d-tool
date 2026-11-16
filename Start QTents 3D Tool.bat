@echo off
title QTents 3D Tool
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
    echo Node.js was not found. Install it from https://nodejs.org and try again.
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo First run: installing dependencies, this may take a few minutes...
    call npm install --legacy-peer-deps
    if errorlevel 1 (
        echo.
        echo Install failed. See the messages above.
        pause
        exit /b 1
    )
)

echo.
echo Starting QTents 3D Tool on http://localhost:5173
echo Keep this window open while you use the app. Close it to stop.
echo.

start "" /b cmd /c "timeout /t 4 /nobreak >nul & start "" http://localhost:5173"

call npm run dev

echo.
echo The app has stopped.
pause
