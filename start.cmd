@echo off
chcp 65001 >nul
cd /d "%~dp0"
title ChatGPT-Astra Fake API (uses Nailong)
echo.
echo   Starting fake ChatGPT-Astra API. Every call returns a laughing Nailong.
echo   Base URL for OpenAI SDK: http://127.0.0.1:8787/v1
echo   Press Ctrl+C to stop.
echo.
python server.py %*
echo.
echo Server exited. Press any key to close.
pause >nul
