@echo off
rem Buoc 2: chay backend ASP.NET Core o http://localhost:5080 (can .NET 10 SDK)
chcp 65001 >nul
if not exist "%~dp0backend\SelfStorage.Api\SelfStorage.Api.csproj" (echo Hay chay file nay trong thu muc goc cua du an (noi co cac thu muc backend, database, frontend). & pause & exit /b 1)
cd /d "%~dp0backend\SelfStorage.Api"
where dotnet >nul 2>&1 || (echo Chua cai .NET 10 SDK. Tai o https://dotnet.microsoft.com/download/dotnet/10.0 roi chay lai file nay. & pause & exit /b 1)
set ASPNETCORE_ENVIRONMENT=Development
rem Cho phep chay tren .NET 11 neu may chua co .NET 10
set DOTNET_ROLL_FORWARD=Major
echo Backend dang khoi dong... Swagger: http://localhost:5080/swagger
echo Giu cua so nay mo trong luc dung web. Tat cua so = tat backend.
powershell -NoProfile -ExecutionPolicy Bypass -Command "dotnet run --launch-profile http 2>&1 | Tee-Object -FilePath '%~dp02-chay-backend.log'"
pause
