@echo off
rem Start backend and frontend in two windows, then open the site
chcp 65001 >nul
cd /d "%~dp0.."
start "SafeKeep BACKEND - keep open" cmd /k call "%~dp02-run-backend.bat"
echo Waiting 20 seconds for the backend to start...
timeout /t 20 >nul
start "SafeKeep FRONTEND - keep open" cmd /k call "%~dp03-run-frontend.bat"
timeout /t 15 >nul
start "" http://localhost:5173
