@echo off
rem Step 1: create the SelfStorageDB database on SQL Server localhost (other databases are not touched)
chcp 65001 >nul
if not exist "%~dp0..\backend\SelfStorage.Api\SelfStorage.Api.csproj" (echo Run this file from the scripts folder of the project. & pause & exit /b 1)
cd /d "%~dp0.."
echo Creating database SelfStorageDB...
sqlcmd -S localhost -E -C -I -f 65001 -i "database\01_schema.sql" > "%~dp01-create-database.log" 2>&1
rem Migrations added after 01_schema.sql (billing, payment concurrency, support checklists)
sqlcmd -S localhost -E -C -I -f 65001 -d SelfStorageDB -i "database\02_billing_reservation_links.sql" >> "%~dp01-create-database.log" 2>&1
sqlcmd -S localhost -E -C -I -f 65001 -d SelfStorageDB -i "database\03_payment_concurrency.sql" >> "%~dp01-create-database.log" 2>&1
sqlcmd -S localhost -E -C -I -f 65001 -d SelfStorageDB -i "database\04_support_checklists.sql" >> "%~dp01-create-database.log" 2>&1
sqlcmd -S localhost -E -C -Q "SET NOCOUNT ON; SELECT COUNT(*) AS TableCount FROM SelfStorageDB.INFORMATION_SCHEMA.TABLES" >> "%~dp01-create-database.log" 2>&1
type "%~dp01-create-database.log" | findstr /I "error TableCount -- [0-9]"
echo.
echo Done. Full output in 1-create-database.log
pause
