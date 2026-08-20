@echo off
chcp 65001 >nul
title MomentCut
cd /d "%~dp0"
echo.
echo   🎬 MomentCut - умный монтаж интересных моментов
echo.
echo   Запуск сервера: http://127.0.0.1:8000
echo   Для остановки нажмите Ctrl+C
echo.
".venv\Scripts\python.exe" -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
pause
