@echo off
cd /d "%~dp0"
where python >nul 2>&1
if errorlevel 1 (
  echo Python is required to run Badge Press.
  echo Install Python from https://www.python.org/downloads/ and try again.
  pause
  exit /b 1
)
python server.py --open
echo.
echo Badge Press stopped.
pause
