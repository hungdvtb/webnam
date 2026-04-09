@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0seo-batch.ps1" -ConfigPath "%~dp0seo-batch.config.json" %*
exit /b %errorlevel%
