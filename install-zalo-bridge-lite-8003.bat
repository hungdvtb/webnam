@echo off
setlocal EnableExtensions

set "TASK_NAME=Webnam Zalo Bridge Lite 8003"
set "SCRIPT_DIR=%~dp0"
set "PS_SCRIPT=%SCRIPT_DIR%zalo-bridge-lite-8003.ps1"
set "RUNNER=%SCRIPT_DIR%zalo-bridge-lite-runner.vbs"
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

if not exist "%PS_SCRIPT%" (
    echo Khong thay file zalo-bridge-lite-8003.ps1.
    echo Hay de file .bat nay cung thu muc voi file .ps1 roi chay lai.
    exit /b 1
)

if defined DRY_RUN (
    echo [DRY RUN] se kiem tra script:
    echo powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS_SCRIPT%" -SelfTest
    echo [DRY RUN] se tao task:
    echo schtasks /Create /F /TN "%TASK_NAME%" /SC ONLOGON /TR "wscript.exe //B //Nologo ""%RUNNER%"""
    exit /b 0
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
echo Xong. Bridge lite se tu chay nen moi lan dang nhap Windows.
echo Tu gio vao web chinh roi bam Panel phai / gui tin nhu binh thuong.
echo.
pause
exit /b 0

:write_runner
(
    echo Option Explicit
    echo Dim shell, fso, scriptDir, psScript, command
    echo Set shell = CreateObject("WScript.Shell"^)
    echo Set fso = CreateObject("Scripting.FileSystemObject"^)
    echo scriptDir = fso.GetParentFolderName(WScript.ScriptFullName^)
    echo psScript = fso.BuildPath(scriptDir, "zalo-bridge-lite-8003.ps1"^)
    echo command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File " ^& Chr(34^) ^& psScript ^& Chr(34^)
    echo If fso.FileExists(psScript^) Then
    echo     shell.Run command, 0, False
    echo End If
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
