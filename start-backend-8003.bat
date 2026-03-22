@echo off
setlocal
title Webnam Backend API :8003

cd /d "%~dp0backend"

set "PHP_EXE=C:\xampp\php\php.exe"
if not exist "%PHP_EXE%" set "PHP_EXE=php"

echo.
echo ============================================
echo  Webnam backend API dang chay tai:
echo  http://127.0.0.1:8003
echo ============================================
echo.
echo Dang dung cua so nay neu ban con muon su dung frontend.
echo.

"%PHP_EXE%" -S 127.0.0.1:8003 -t public vendor\laravel\framework\src\Illuminate\Foundation\resources\server.php

echo.
echo Backend da dung. Nhan phim bat ky de dong cua so.
pause >nul
