@echo off
cd /d "%~dp0"
if not exist ".env" copy ".env.example" ".env"
python -m pip install -r requirements.txt
if errorlevel 1 pause & exit /b 1
python run.py
pause
