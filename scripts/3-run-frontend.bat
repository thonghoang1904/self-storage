@echo off
rem Step 3: run the React frontend at http://localhost:5173 (needs Node.js 20+)
chcp 65001 >nul
if not exist "%~dp0..\backend\SelfStorage.Api\SelfStorage.Api.csproj" (echo Run this file from the scripts folder of the project. & pause & exit /b 1)
cd /d "%~dp0..\frontend"
where node >nul 2>&1 || (echo Node.js not found. Install it from https://nodejs.org and run this file again. & pause & exit /b 1)
if not exist node_modules (
  echo Installing packages for the first time, this takes 1-2 minutes...
  call npm install > "%~dp03-run-frontend.log" 2>&1
)
echo Checking TypeScript...
call npx tsc -b >> "%~dp03-run-frontend.log" 2>&1 && echo No TypeScript errors. || echo TypeScript errors found, see 3-run-frontend.log
echo Frontend running at http://localhost:5173 - keep this window open.
powershell -NoProfile -ExecutionPolicy Bypass -Command "npm run dev -- --strictPort 2>&1 | Tee-Object -FilePath '%~dp03-run-frontend-dev.log'"
pause
