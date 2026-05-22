#!/bin/bash

# SentinelX AI SOC Platform - Desktop Launcher (macOS/Linux)
echo "====================================================================="
echo "   SentinelX AI - Security Operations Center (Community Edition)"
echo "====================================================================="
echo ""

# Check for python3
if ! command -v python3 &> /dev/null
then
    echo "[ERROR] Python 3 is not installed or not in your system PATH."
    echo "Please install Python 3.9+ using your package manager."
    exit 1
fi

echo "[System Check] Python3 detected."
echo ""

# Move to the script's directory (project root)
cd "$(dirname "$0")" || exit 1

# Set up virtual env if it doesn't exist at the root
if [ ! -d "venv" ]; then
    echo "[1/3] Creating Python virtual environment (venv)..."
    python3 -m venv venv
    if [ $? -ne 0 ]; then
        echo "[ERROR] Failed to create virtual environment."
        exit 1
    fi
fi

# Activate virtual environment
echo "[2/3] Activating virtual environment..."
source venv/bin/activate

# Install requirements
echo "[3/3] Installing and updating dependencies..."
pip install --upgrade pip
pip install -r backend/requirements.txt
if [ $? -ne 0 ]; then
    echo "[ERROR] Dependency installation failed."
    exit 1
fi

echo ""
echo "====================================================================="
echo "   [+] SentinelX AI Backend Server is starting..."
echo "   [+] Platform URL: http://localhost:8000"
echo "   [+] Recruiter Demo User: demo / Demo123"
echo "   [+] Press Ctrl+C in this terminal window to stop the server."
echo "====================================================================="
echo ""

# Try opening default browser depending on OS
if command -v xdg-open &> /dev/null; then
    xdg-open http://localhost:8000 &
elif command -v open &> /dev/null; then
    open http://localhost:8000 &
else
    echo "[INFO] Please navigate to http://localhost:8000 in your browser."
fi

# Run the FastAPI server from the root
python3 -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
