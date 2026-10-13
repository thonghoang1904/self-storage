@echo off
rem Buoc 3: chay frontend React o http://localhost:5173 (can Node.js 20+)
chcp 65001 >nul
if not exist "%~dp0..\backend\SelfStorage.Api\SelfStorage.Api.csproj" (echo Hay chay file nay trong thu muc scripts cua du an. & pause & exit /b 1)
cd /d "%~dp0..\frontend"
where node >nul 2>&1 || (echo Chua cai Node.js. Cai file node-v24.21.0-x64.msi trong Downloads roi chay lai file nay. & pause & exit /b 1)
if not exist node_modules (
  echo Dang cai thu vien lan dau, mat 1-2 phut...
  call npm install > "%~dp03-chay-frontend.log" 2>&1
)
echo Kiem tra loi TypeScript...
call npx tsc -b >> "%~dp03-chay-frontend.log" 2>&1 && echo Khong co loi TypeScript. || echo Co loi TypeScript, xem file 3-chay-frontend.log
echo Frontend dang chay o http://localhost:5173 - giu cua so nay mo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "npm run dev -- --strictPort 2>&1 | Tee-Object -FilePath '%~dp03-chay-frontend-dev.log'"
pause
