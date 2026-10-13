@echo off
rem Step 2: run the ASP.NET Core backend at http://localhost:5080 (needs .NET SDK 10 or newer)
chcp 65001 >nul
if not exist "%~dp0..\backend\SelfStorage.Api\SelfStorage.Api.csproj" (echo Run this file from the scripts folder of the project. & pause & exit /b 1)
cd /d "%~dp0..\backend\SelfStorage.Api"
where dotnet >nul 2>&1 || (echo .NET SDK not found. Install it from https://dotnet.microsoft.com/download/dotnet/10.0 and run this file again. & pause & exit /b 1)
set ASPNETCORE_ENVIRONMENT=Development
rem Allow running on .NET 11 when .NET 10 is not installed
set DOTNET_ROLL_FORWARD=Major
echo Starting backend... Swagger: http://localhost:5080/swagger
echo Keep this window open while using the site. Closing it stops the backend.
powershell -NoProfile -ExecutionPolicy Bypass -Command "dotnet run --launch-profile http 2>&1 | Tee-Object -FilePath '%~dp02-run-backend.log'"
pause
