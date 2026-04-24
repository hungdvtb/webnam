@echo off
setlocal
title Webnam Backend API :8003

cd /d "%~dp0backend"

set "PHP_EXE=C:\xampp\htdocs\webnam\php84\php.exe"
if not exist "%PHP_EXE%" set "PHP_EXE=C:\xampp\php\php.exe"
if not exist "%PHP_EXE%" set "PHP_EXE=php"
if not exist ".tmp-appdata" mkdir ".tmp-appdata" >nul 2>nul
set "APPDATA=%CD%\.tmp-appdata"

"%PHP_EXE%" artisan db:seed --class=LocalAdminAccessSeeder --force
if errorlevel 1 (
echo.
echo Khong the sua tai khoan admin local.
exit /b 1
)

echo.
echo ============================================
echo  Webnam backend API dang chay tai:
echo  http://127.0.0.1:8003
echo ============================================
echo.
echo Dang dung cua so nay neu ban con muon su dung frontend.
echo.

"%PHP_EXE%" -S 127.0.0.1:8003 -t public public\index.php

echo.
echo Backend da dung. Nhan phim bat ky de dong cua so.
pause >nul
