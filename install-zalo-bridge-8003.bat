@echo off
setlocal EnableExtensions

set "TASK_NAME=Webnam Zalo Bridge 8003"
set "SCRIPT_DIR=%~dp0"
set "START_SCRIPT=%SCRIPT_DIR%start-backend-8003.bat"
set "RUNNER=%SCRIPT_DIR%zalo-bridge-runner.vbs"
set "DRY_RUN="

if /I "%~1"=="--dry-run" set "DRY_RUN=1"
if /I "%~1"=="--remove" goto remove_task
if /I "%~1"=="--uninstall" goto remove_task
if /I "%~1"=="/remove" goto remove_task
if /I "%~1"=="/uninstall" goto remove_task

echo.
echo ============================================
echo  Cai dat Webnam Zalo Bridge tai cong 8003
echo ============================================
echo.

if not exist "%START_SCRIPT%" (
    echo Khong thay file start-backend-8003.bat.
    echo Hay dat file nay trong dung thu muc webnam roi chay lai.
    exit /b 1
)

if not exist "%SCRIPT_DIR%backend\artisan" (
    echo Khong thay backend\artisan.
    echo May nay can co ca thu muc webnam, khong chi rieng file cai dat.
    exit /b 1
)

call :write_runner
if errorlevel 1 exit /b 1

set "TASK_COMMAND=wscript.exe //B //Nologo ""%RUNNER%"""

if defined DRY_RUN (
    echo [DRY RUN] se tao task:
    echo schtasks /Create /F /TN "%TASK_NAME%" /SC ONLOGON /TR "%TASK_COMMAND%"
    echo [DRY RUN] se chay task ngay sau khi tao.
    exit /b 0
)

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
echo Xong. Zalo Bridge se tu chay nen moi lan dang nhap Windows.
echo Tu gio vao web chinh roi bam Panel phai / gui tin nhu binh thuong.
echo.
pause
exit /b 0

:write_runner
if defined DRY_RUN (
    echo [DRY RUN] se tao file "%RUNNER%".
    exit /b 0
)

(
    echo Option Explicit
    echo Dim shell, fso, scriptDir, startScript
    echo Set shell = CreateObject("WScript.Shell"^)
    echo Set fso = CreateObject("Scripting.FileSystemObject"^)
    echo scriptDir = fso.GetParentFolderName(WScript.ScriptFullName^)
    echo shell.CurrentDirectory = scriptDir
    echo startScript = fso.BuildPath(scriptDir, "start-backend-8003.bat"^)
    echo If fso.FileExists(startScript^) Then
    echo     shell.Run Chr(34^) ^& startScript ^& Chr(34^), 0, False
    echo End If
) > "%RUNNER%"

if errorlevel 1 (
    echo Khong tao duoc file runner: "%RUNNER%".
    exit /b 1
)

exit /b 0

:remove_task
echo.
echo Dang go cai dat Webnam Zalo Bridge...
if defined DRY_RUN (
    echo [DRY RUN] se xoa task "%TASK_NAME%" va file "%RUNNER%".
    exit /b 0
)

schtasks /Delete /F /TN "%TASK_NAME%" >nul 2>nul
if exist "%RUNNER%" del /f /q "%RUNNER%" >nul 2>nul
echo Da go task tu dong chay cung Windows.
pause
exit /b 0
