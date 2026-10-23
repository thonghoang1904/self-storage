@echo off
rem Recreate all SelfStorageDB tables, then restart the backend so it reloads the demo data
chcp 65001 >nul
cd /d "%~dp0.."
set LOG=%~dp0reset-database.log
echo ==== %date% %time% ==== > "%LOG%"
echo [1] Stopping the running backend (if any)...
taskkill /IM SelfStorage.Api.exe /F >> "%LOG%" 2>&1
timeout /t 2 >nul
echo [2] Recreating database SelfStorageDB...
rem setup_fresh.sql runs 01_schema.sql then every migration 02-09 in order
sqlcmd -S localhost -E -C -I -f 65001 -b -i "database\setup_fresh.sql" >> "%LOG%" 2>&1
sqlcmd -S localhost -E -C -Q "SET NOCOUNT ON; SELECT COUNT(*) AS TableCount FROM SelfStorageDB.INFORMATION_SCHEMA.TABLES" >> "%LOG%" 2>&1
echo [3] Restarting the backend in a new window to load demo accounts...
start "SafeKeep BACKEND - keep open" cmd /k call "%~dp02-run-backend.bat"
echo Waiting 45 seconds for the backend to load data...
timeout /t 45 >nul
echo [4] Checking demo data... >> "%LOG%"
sqlcmd -S localhost -E -C -Q "SET NOCOUNT ON; SELECT Username FROM SelfStorageDB.dbo.Users; SELECT FacilityName FROM SelfStorageDB.dbo.Facilities; SELECT COUNT(*) AS UnitCount FROM SelfStorageDB.dbo.StorageUnits" >> "%LOG%" 2>&1
echo ==== DONE ==== >> "%LOG%"
type "%LOG%" | findstr /V /C:"rows affected" /C:"Changed database"
echo.
echo Done. Open http://localhost:5173 and sign in as customer1 / Demo@12345
pause
