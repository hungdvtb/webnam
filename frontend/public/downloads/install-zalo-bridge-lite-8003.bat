@echo off
setlocal EnableExtensions

set "TASK_NAME=Webnam Zalo Bridge Lite 8003"
set "DOWNLOAD_URL=https://admin.gomdaithanh.com/downloads/zalo-bridge-lite-8003.ps1"
set "SOURCE_DIR=%~dp0"
set "SOURCE_PS=%SOURCE_DIR%zalo-bridge-lite-8003.ps1"
set "INSTALL_ROOT=D:\WebnamZaloBridge"
if not exist "D:\" set "INSTALL_ROOT=%LOCALAPPDATA%\WebnamZaloBridge"
set "PS_SCRIPT=%INSTALL_ROOT%\zalo-bridge-lite-8003.ps1"
set "RUNNER=%INSTALL_ROOT%\zalo-bridge-lite-runner.vbs"
set "DRY_RUN="

if /I "%~1"=="--dry-run" set "DRY_RUN=1"
if /I "%~1"=="--remove" goto remove_task
if /I "%~1"=="--uninstall" goto remove_task
if /I "%~1"=="/remove" goto remove_task
if /I "%~1"=="/uninstall" goto remove_task

echo.
echo ============================================
echo  Cai dat Webnam Zalo Bridge Lite cong 8003
echo ============================================
echo.
echo Thu muc cai dat: %INSTALL_ROOT%
echo.

if defined DRY_RUN (
    echo [DRY RUN] se tao thu muc "%INSTALL_ROOT%".
    echo [DRY RUN] se copy hoac tai "%PS_SCRIPT%".
    echo [DRY RUN] se kiem tra script bang PowerShell.
    echo [DRY RUN] se tao task:
    echo schtasks /Create /F /TN "%TASK_NAME%" /SC ONLOGON /TR "wscript.exe //B //Nologo ""%RUNNER%"""
    exit /b 0
)

if not exist "%INSTALL_ROOT%" mkdir "%INSTALL_ROOT%" >nul 2>nul
if errorlevel 1 (
    echo Khong tao duoc thu muc cai dat "%INSTALL_ROOT%".
    echo Hay thu chay file nay bang quyen Administrator.
    exit /b 1
)

if exist "%SOURCE_PS%" (
    copy /Y "%SOURCE_PS%" "%PS_SCRIPT%" >nul
) else (
    echo Dang tai file bridge tu web chinh...
    powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri '%DOWNLOAD_URL%' -OutFile '%PS_SCRIPT%'"
)

if errorlevel 1 (
    echo Khong tai/copy duoc file zalo-bridge-lite-8003.ps1.
    echo Kiem tra mang internet roi chay lai file cai dat.
    exit /b 1
)

if not exist "%PS_SCRIPT%" (
    echo Khong thay file bridge sau khi tai/copy: "%PS_SCRIPT%".
    exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS_SCRIPT%" -SelfTest
if errorlevel 1 (
    echo.
    echo Script bridge lite chua chay duoc tren may nay.
    echo Kiem tra PowerShell/Windows roi thu lai.
    exit /b 1
)

call :write_runner
if errorlevel 1 exit /b 1

set "TASK_COMMAND=wscript.exe //B //Nologo ""%RUNNER%"""
schtasks /Create /F /TN "%TASK_NAME%" /SC ONLOGON /TR "%TASK_COMMAND%" >nul
if errorlevel 1 (
    echo Khong tao duoc task tu dong chay cung Windows.
    echo Thu chay file nay bang quyen Administrator roi cai lai.
    exit /b 1
)

schtasks /Run /TN "%TASK_NAME%" >nul 2>nul
if errorlevel 1 (
    echo Da tao task, nhung chua chay ngay duoc. Dang bat bridge truc tiep...
    start "" wscript.exe //B //Nologo "%RUNNER%"
)

echo.
echo Xong. Bridge lite da duoc cai vao "%INSTALL_ROOT%" va se tu chay cung Windows.
echo Tu gio vao web chinh roi bam Panel phai / gui tin nhu binh thuong.
echo.
pause
exit /b 0

:write_runner
(
    echo Option Explicit
    echo Dim shell, psScript, command
    echo Set shell = CreateObject("WScript.Shell"^)
    echo psScript = "%PS_SCRIPT%"
    echo command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File " ^& Chr(34^) ^& psScript ^& Chr(34^)
    echo shell.Run command, 0, False
) > "%RUNNER%"

if errorlevel 1 (
    echo Khong tao duoc file runner: "%RUNNER%".
    exit /b 1
)

exit /b 0

:remove_task
echo.
echo Dang go cai dat Webnam Zalo Bridge Lite...
if defined DRY_RUN (
    echo [DRY RUN] se xoa task "%TASK_NAME%" va file "%RUNNER%".
    exit /b 0
)

schtasks /Delete /F /TN "%TASK_NAME%" >nul 2>nul
if exist "%RUNNER%" del /f /q "%RUNNER%" >nul 2>nul
echo Da go task tu dong chay cung Windows.
pause
exit /b 0
