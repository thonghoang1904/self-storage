@echo off
rem Mo backend va frontend trong 2 cua so rieng, roi mo trang web
chcp 65001 >nul
cd /d "%~dp0"
start "SafeKeep BACKEND - dung tat" cmd /k call "%~dp02-chay-backend.bat"
echo Cho backend khoi dong 20 giay...
timeout /t 20 >nul
start "SafeKeep FRONTEND - dung tat" cmd /k call "%~dp03-chay-frontend.bat"
timeout /t 15 >nul
start "" http://localhost:5173
