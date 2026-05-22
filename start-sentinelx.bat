@echo off
title SentinelX AI SOC Platform - Desktop Launcher
echo =====================================================================
echo    SentinelX AI - Security Operations Center (Community Edition)
echo =====================================================================
echo.
echo [System Check] Checking Python installation...

python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python 3.9+ is not installed or not in your system PATH.
    echo Please download and install Python from https://www.python.org/
    pause
    exit /b 1
)

echo [System Check] Python detected.
echo.

:: Set up virtual environment if it doesn't exist at the root
if not exist venv (
    echo [1/3] Creating Python virtual environment (venv)...
    python -m venv venv
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to create virtual environment.
        pause
        exit /b 1
    )
)

:: Activate virtual environment
echo [2/3] Activating virtual environment...
call venv\Scripts\activate.bat

:: Install requirements
echo [3/3] Installing and updating dependencies...
pip install -r backend\requirements.txt
if %errorlevel% neq 0 (
    echo [ERROR] Dependency installation failed.
    pause
    exit /b 1
)

echo.
echo =====================================================================
echo    [+] SentinelX AI Backend Server is starting...
echo    [+] Platform URL: http://localhost:8000
echo    [+] Recruiter Demo User: demo / Demo123
echo    [+] Press Ctrl+C in this terminal window to stop the server.
echo =====================================================================
echo.

:: Open default browser to landing page
start http://localhost:8000

:: Run the FastAPI server via uvicorn from the root
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000

pause
