#!/bin/bash
# Python セットアップ確認スクリプト

echo "=== Python Installation Check ==="
echo ""

# Python バージョン確認
if command -v python &> /dev/null; then
    echo "✓ Python found:"
    python --version
    PYTHON_CMD="python"
elif command -v python3 &> /dev/null; then
    echo "✓ Python3 found:"
    python3 --version
    PYTHON_CMD="python3"
else
    echo "✗ Python not found in PATH"
    echo ""
    echo "Please install Python 3.12+ from:"
    echo "https://www.python.org/downloads/"
    echo ""
    echo "Make sure to check 'Add Python to PATH' during installation!"
    exit 1
fi

echo ""
echo "=== Creating Virtual Environment ==="
$PYTHON_CMD -m venv .venv

echo ""
echo "=== Activating Virtual Environment ==="
source .venv/Scripts/activate

echo ""
echo "=== Upgrading pip ==="
python -m pip install --upgrade pip

echo ""
echo "=== Installing Dependencies ==="
pip install -r requirements.txt

echo ""
echo "=== Setup Complete! ==="
echo ""
echo "To activate the virtual environment in the future:"
echo "  source .venv/Scripts/activate"
echo ""
echo "To run tests:"
echo "  pytest tests/pipelines/test_toggl.py -v"
