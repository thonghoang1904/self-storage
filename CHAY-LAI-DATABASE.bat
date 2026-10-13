@echo off
rem Tao lai database SelfStorageDB tu dau, roi khoi dong lai backend de nap du lieu demo
chcp 65001 >nul
cd /d "%~dp0"
set LOG=%~dp0chay-lai-database.log
echo ==== %date% %time% ==== > "%LOG%"
echo [1] Tat backend dang chay (neu co)...
taskkill /IM SelfStorage.Api.exe /F >> "%LOG%" 2>&1
timeout /t 2 >nul
echo [2] Tao lai database SelfStorageDB...
sqlcmd -S localhost -E -C -I -f 65001 -i "database\01_schema.sql" >> "%LOG%" 2>&1
sqlcmd -S localhost -E -C -Q "SET NOCOUNT ON; SELECT COUNT(*) AS SoBang FROM SelfStorageDB.INFORMATION_SCHEMA.TABLES" >> "%LOG%" 2>&1
echo [3] Khoi dong lai backend (cua so moi) de nap tai khoan demo...
start "SafeKeep BACKEND - dung tat" cmd /k call "%~dp02-chay-backend.bat"
echo Cho backend nap du lieu 45 giay...
timeout /t 45 >nul
echo [4] Kiem tra du lieu demo... >> "%LOG%"
sqlcmd -S localhost -E -C -Q "SET NOCOUNT ON; SELECT Username FROM SelfStorageDB.dbo.Users; SELECT FacilityName FROM SelfStorageDB.dbo.Facilities; SELECT COUNT(*) AS SoKho FROM SelfStorageDB.dbo.StorageUnits" >> "%LOG%" 2>&1
echo ==== XONG ==== >> "%LOG%"
type "%LOG%" | findstr /V /C:"rows affected" /C:"Changed database"
echo.
echo Xong. Mo http://localhost:5173 va dang nhap customer1 / Demo@12345
pause
