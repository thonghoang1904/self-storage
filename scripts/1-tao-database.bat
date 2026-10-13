@echo off
rem Buoc 1: tao database SelfStorageDB tren SQL Server localhost (chi tao database moi, khong dung database khac)
chcp 65001 >nul
if not exist "%~dp0..\backend\SelfStorage.Api\SelfStorage.Api.csproj" (echo Hay chay file nay trong thu muc scripts cua du an. & pause & exit /b 1)
cd /d "%~dp0.."
echo Dang tao database SelfStorageDB...
sqlcmd -S localhost -E -C -I -f 65001 -i "database\01_schema.sql" > "%~dp01-tao-database.log" 2>&1
sqlcmd -S localhost -E -C -Q "SET NOCOUNT ON; SELECT COUNT(*) AS SoBang FROM SelfStorageDB.INFORMATION_SCHEMA.TABLES" >> "%~dp01-tao-database.log" 2>&1
type "%~dp01-tao-database.log" | findstr /I "error SoBang -- [0-9]"
echo.
echo Xong. Ket qua day du o file 1-tao-database.log
pause
