@echo off
setlocal
where pwsh.exe >nul 2>nul
if errorlevel 1 (
  echo PowerShell 7 is required. Install it, then run this file again.
  pause
  exit /b 1
)
pwsh.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
set "BMS_EXIT=%ERRORLEVEL%"
echo.
if not "%BMS_EXIT%"=="0" echo Installation failed. Run Check-BMS-Retail-Local.cmd for details.
pause
exit /b %BMS_EXIT%
