@echo off
cd /d "%~dp0"
py -3 publish_to_github.py
if errorlevel 1 (
  echo GitHub push failed. Please check the error above.
  pause
  exit /b 1
)
echo Done.
pause
