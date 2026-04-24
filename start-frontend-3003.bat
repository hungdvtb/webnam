@echo off
setlocal
title Webnam Frontend Dev :3003

cd /d "%~dp0frontend"

set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=C:\Program Files\nodejs\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=node"

echo.
echo ============================================
echo  Webnam frontend dev dang chay tai:
echo  http://127.0.0.1:3003
echo ============================================
echo.
echo Script nay se tu khoi dong backend 8003 neu can.
echo Dang dung cua so nay neu ban con muon su dung frontend.
echo.

"%NODE_EXE%" ".\scripts\dev-with-backend.mjs" --host 127.0.0.1 --port 3003

echo.
echo Frontend da dung. Nhan phim bat ky de dong cua so.
pause >nul
