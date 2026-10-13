@echo off
rem Kiem tra cong cu can de chay SafeKeep (backend .NET + SQL Server + frontend React)
chcp 65001 >nul
set LOG=%~dp0kiem-tra-may.log
echo ==== %date% %time% ==== > "%LOG%"
echo [dotnet] >> "%LOG%"
where dotnet >> "%LOG%" 2>&1
dotnet --list-sdks >> "%LOG%" 2>&1
echo [node] >> "%LOG%"
where node >> "%LOG%" 2>&1
node -v >> "%LOG%" 2>&1
call npm -v >> "%LOG%" 2>&1
echo [git] >> "%LOG%"
git --version >> "%LOG%" 2>&1
echo [sqlcmd] >> "%LOG%"
where sqlcmd >> "%LOG%" 2>&1
echo [sql services] >> "%LOG%"
sc query state= all | findstr /I "SERVICE_NAME.*SQL" >> "%LOG%" 2>&1
powershell -NoProfile -Command "Get-Service *SQL* | Format-Table -AutoSize Name,Status,DisplayName | Out-String -Width 200" >> "%LOG%" 2>&1
echo [localdb] >> "%LOG%"
sqllocaldb info >> "%LOG%" 2>&1
echo [sqlcmd test] >> "%LOG%"
sqlcmd -S localhost -E -C -Q "SELECT @@SERVERNAME, @@VERSION; SELECT name FROM sys.databases" >> "%LOG%" 2>&1
sqlcmd -S .\SQLEXPRESS -E -C -Q "SELECT @@SERVERNAME; SELECT name FROM sys.databases" >> "%LOG%" 2>&1
echo [backend config] >> "%LOG%"
type "%~dp0..\backend\SelfStorage.Api\appsettings.json" >> "%LOG%" 2>&1
echo ==== XONG ==== >> "%LOG%"
echo Da kiem tra xong, ket qua o file kiem-tra-may.log. Cua so nay tu dong sau 5 giay.
timeout /t 5 >nul
